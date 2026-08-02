// ── Supabase REST / Storage (no SDK) ──
const API     = 'https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1';
const STORAGE = 'https://mpvsbeghuueffkjdemcr.supabase.co/storage/v1';
const KEY     = 'sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5';
const BUCKET  = 'recipe-images';
const H       = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

const PWD_HASH    = '9c2e571eb60385be3ced6e5d4bd7d34837f5219d693e679cd324d5e12b83c4eb';
const SESSION_KEY = 'hh_auth';

// ── PURE LOGIC START ──
// 这一段不碰 DOM、不碰网络，可以被 node 单独 eval 出来跑断言。
// 修改时请保持这个性质——它是这个仓库里唯一能自动验证的部分。

// 归一化查找键：去首尾空格、小写、去掉所有空白字符
function normKey(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, '');
}

// vocab 行数组 → Map<normKey, canonical>。canonical 自身和每个别名都建索引。
function buildAliasMap(vocab) {
  const m = new Map();
  for (const v of vocab) {
    m.set(normKey(v.canonical), v.canonical);
    for (const a of (v.aliases || [])) m.set(normKey(a), v.canonical);
  }
  return m;
}

// 一个词 → canonical。词表里查不到就返回 trim 后的原词（新食材）。
function toCanonical(text, aliasMap) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return '';
  return aliasMap.get(normKey(t)) || t;
}

// vocab 行数组 → Set<canonical>，只含 staple = true 的常备调料
function stapleSet(vocab) {
  return new Set(vocab.filter(v => v.staple).map(v => v.canonical));
}

// 分桶匹配。have 是 canonical 数组，staples 是 Set<canonical>。
// 返回 [{recipe, missing, needCount}]，按「缺得少 → 用料少 → 新的在前」排序。
// missing 超过 maxMissing（默认 3）的食谱直接剔除，不展示。
function matchRecipes(have, recipes, staples, maxMissing) {
  const cap = maxMissing == null ? 3 : maxMissing;
  const haveSet = new Set(have);
  const out = [];
  for (const r of recipes) {
    const need = (r.ingredient_keys || []).filter(k => !staples.has(k));
    const missing = need.filter(k => !haveSet.has(k));
    if (missing.length > cap) continue;
    out.push({ recipe: r, missing: missing, needCount: need.length });
  }
  out.sort((a, b) =>
    (a.missing.length - b.missing.length) ||
    (a.needCount - b.needCount) ||
    (b.recipe.id - a.recipe.id)
  );
  return out;
}

// 搜索。返回 {byName, byIngredient}，同一道菜只出现在一组里（菜名优先）。
function searchRecipes(q, recipes, aliasMap) {
  const raw = String(q == null ? '' : q).trim();
  if (!raw) return { byName: [], byIngredient: [] };
  const nq = normKey(raw);
  const canon = toCanonical(raw, aliasMap);
  const byName = [], byIngredient = [];
  for (const r of recipes) {
    if (normKey(r.name).includes(nq)) { byName.push(r); continue; }
    const keyHit = (r.ingredient_keys || []).some(k => k === canon || normKey(k).includes(nq));
    const rawHit = (r.ingredients || []).some(i => normKey(i.name).includes(nq));
    if (keyHit || rawHit) byIngredient.push(r);
  }
  return { byName: byName, byIngredient: byIngredient };
}
// ── PURE LOGIC END ──

// ── 工具 ──
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function $(id) { return document.getElementById(id); }
function setSync(state) { $('sync-dot').className = 'sync-dot ' + state; }

// ── 密码门（与其余三页共用 PWD_HASH / SESSION_KEY） ──
async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function unlock() {
  const inp = $('lock-input'), err = $('lock-error');
  if (!inp.value) { err.textContent = '请输入密码'; return; }
  if (await sha256(inp.value) === PWD_HASH) {
    sessionStorage.setItem(SESSION_KEY, '1');
    enterApp();
  } else {
    err.textContent = '密码错误，请重试';
    inp.classList.add('error');
    inp.value = '';
    setTimeout(() => inp.classList.remove('error'), 400);
  }
}
function enterApp() {
  $('lock-screen').classList.add('hidden');
  $('app').classList.add('visible');
  $('lock-error').textContent = '';
  initApp();
}
function lockApp() {
  sessionStorage.removeItem(SESSION_KEY);
  $('lock-screen').classList.remove('hidden');
  $('app').classList.remove('visible');
  $('lock-input').value = '';
  $('lock-error').textContent = '';
}

// ── 灯箱 ──
function openLightbox(url) {
  $('lightbox-img').src = url;
  $('lightbox').classList.remove('hidden');
}
function closeLightbox() {
  $('lightbox').classList.add('hidden');
  $('lightbox-img').src = '';
}

// ── 路由 ──
// #/            列表    #/r/<id>   详情
// #/new         新建    #/edit/<id> 编辑    #/idea 灵感
function currentRoute() {
  const h = (location.hash || '#/').replace(/^#/, '');
  const m = h.match(/^\/r\/(\d+)$/);       if (m) return { view: 'detail', id: Number(m[1]) };
  const e = h.match(/^\/edit\/(\d+)$/);    if (e) return { view: 'editor', id: Number(e[1]) };
  if (h === '/new')  return { view: 'editor', id: null };
  if (h === '/idea') return { view: 'idea' };
  return { view: 'list' };
}
function render() {
  const r = currentRoute();
  if (r.view === 'detail') return renderDetail(r.id);
  if (r.view === 'editor') return renderEditor(r.id);
  if (r.view === 'idea')   return renderIdea();
  return renderList();
}
window.addEventListener('hashchange', render);

// ── DB 层 ──
async function vocabGetAll() {
  const r = await fetch(`${API}/ingredient_vocab?select=*&order=canonical.asc`, { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function vocabInsert(rows) {
  if (!rows.length) return [];
  const r = await fetch(`${API}/ingredient_vocab`, {
    method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function recipeGetAll() {
  const r = await fetch(`${API}/recipes?select=*&order=id.desc`, { headers: H });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function recipeInsert(rec) {
  const r = await fetch(`${API}/recipes`, {
    method: 'POST', headers: { ...H, 'Prefer': 'return=representation' },
    body: JSON.stringify([rec]),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json())[0];
}
async function recipeUpdate(id, patch) {
  const r = await fetch(`${API}/recipes?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json())[0];
}
async function recipeDelete(id) {
  const r = await fetch(`${API}/recipes?id=eq.${id}`, { method: 'DELETE', headers: H });
  if (!r.ok) throw new Error(await r.text());
}

// ── 图片 ──
// 上传前在浏览器压到长边 1600px 的 JPEG，省流量也让页面加载快。
async function shrinkImage(file, maxEdge, quality) {
  const cap = maxEdge || 1600, q = quality == null ? 0.85 : quality;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return await new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
}

function randomName() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
}

// 返回公开可读的 URL
async function uploadImage(folder, file) {
  const blob = await shrinkImage(file);
  const path = `recipes/${folder}/${randomName()}`;
  const r = await fetch(`${STORAGE}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!r.ok) throw new Error(await r.text());
  return `${STORAGE}/object/public/${BUCKET}/${path}`;
}

// 从公开 URL 反推路径并删除。删不掉只记日志，不阻断主流程——
// 孤儿图片比删不掉食谱好。
async function deleteImage(url) {
  const marker = `/object/public/${BUCKET}/`;
  const i = String(url || '').indexOf(marker);
  if (i < 0) return;
  const path = url.slice(i + marker.length);
  try {
    await fetch(`${STORAGE}/object/${BUCKET}/${path}`, {
      method: 'DELETE', headers: { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY },
    });
  } catch (e) { console.warn('删除图片失败（已忽略）', path, e); }
}

// ── 内存状态 ──
let vocab = [], recipes = [], aliasMap = new Map(), staples = new Set();
let loaded = false;
let listQuery = '', listTag = '';   // 列表页搜索词 / 选中标签
let ideaHave = [];                  // 灵感页已选食材（canonical）

function reindex() {
  aliasMap = buildAliasMap(vocab);
  staples  = stapleSet(vocab);
}

async function loadAll() {
  const [v, rs] = await Promise.all([vocabGetAll(), recipeGetAll()]);
  vocab = v; recipes = rs;
  reindex();
}

// 数据签名——只有内容真的变了才重渲染，避免轮询把输入框刷掉
function dataSig() {
  return recipes.map(r => r.id + ':' + (r.name || '') + ':' + (r.image_urls || []).length
    + ':' + (r.ingredient_keys || []).join(',') + ':' + (r.steps || []).length).join('|')
    + '#' + vocab.length;
}

// ── 视图（后续任务逐个替换） ──
function allTags() {
  const s = new Set();
  for (const r of recipes) for (const t of (r.tags || [])) s.add(t);
  return Array.from(s).sort();
}

function cardHtml(r, num) {
  const img = r.cover_url
    ? `<img src="${escHtml(r.cover_url)}" alt="${escHtml(r.name)}" loading="lazy">`
    : '<div class="noimg">🍽</div>';
  const tags = (r.tags || []).join(' · ');
  return `<a class="card" href="#/r/${r.id}">
    <div class="card-img">${img}</div>
    <div class="card-meta">
      <span class="card-num">№ ${String(num).padStart(2, '0')}</span>
      ${tags ? `<span class="card-tags">${escHtml(tags)}</span>` : ''}
    </div>
    <h2>${escHtml(r.name)}</h2>
  </a>`;
}

function gridHtml(list, startNum) {
  return '<div class="grid">' +
    list.map((r, i) => cardHtml(r, startNum + i)).join('') + '</div>';
}

function renderList() {
  const tags = allTags();
  const tagbar = tags.length ? '<div class="tagbar">' +
    `<button class="tag-chip${listTag ? '' : ' on'}" onclick="pickTag('')">全部</button>` +
    tags.map(t => `<button class="tag-chip${listTag === t ? ' on' : ''}" onclick="pickTag('${escHtml(t)}')">${escHtml(t)}</button>`).join('') +
    '</div>' : '';

  const toolbar = `<div class="toolbar">
      <div class="search-box">
        <input id="q" type="text" placeholder="搜索菜名或食材…" value="${escHtml(listQuery)}"
               oninput="onSearchInput(this.value)" autocomplete="off">
        <div class="suggest hidden" id="q-suggest"></div>
      </div>
      <a class="btn btn-ghost" href="#/idea">🧊 冰箱里有什么</a>
      <a class="btn btn-accent" href="#/new">+ 新食谱</a>
    </div>`;

  let body;
  if (!recipes.length) {
    body = '<div class="empty">还没有食谱。<br>点右上角「+ 新食谱」记下第一道菜吧。</div>';
  } else if (listQuery.trim()) {
    const { byName, byIngredient } = searchRecipes(listQuery, filteredByTag(), aliasMap);
    if (!byName.length && !byIngredient.length) {
      body = `<div class="empty">没有找到含「${escHtml(listQuery)}」的食谱。</div>`;
    } else {
      body = '';
      if (byName.length) body += `<div class="group-title">菜名含此词 (${byName.length})</div>` + gridHtml(byName, 1);
      if (byIngredient.length) body += `<div class="group-title">食材含此词 (${byIngredient.length})</div>` + gridHtml(byIngredient, 1);
    }
  } else {
    const list = filteredByTag();
    body = list.length ? gridHtml(list, 1) : `<div class="empty">没有标签为「${escHtml(listTag)}」的食谱。</div>`;
  }

  $('view').innerHTML = toolbar + tagbar + body;
}

function filteredByTag() {
  if (!listTag) return recipes;
  return recipes.filter(r => (r.tags || []).includes(listTag));
}

function pickTag(t) { listTag = t; renderList(); }

function onSearchInput(v) {
  listQuery = v;
  const box = $('q-suggest');
  const nv = normKey(v);
  if (!nv) { box.classList.add('hidden'); renderListKeepFocus(); return; }
  const pool = new Set();
  for (const r of recipes) if (normKey(r.name).includes(nv)) pool.add(r.name);
  for (const w of vocab) {
    if (normKey(w.canonical).includes(nv)) pool.add(w.canonical);
    for (const a of (w.aliases || [])) if (normKey(a).includes(nv)) pool.add(w.canonical);
  }
  const items = Array.from(pool).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); renderListKeepFocus(); return; }
  box.innerHTML = items.map(t => `<div onmousedown="applySuggest('${escHtml(t)}')">${escHtml(t)}</div>`).join('');
  box.classList.remove('hidden');
  renderListKeepFocus(true);
}

// 重渲染列表但保住输入框的焦点和光标位置（搜索是边打边筛的）
function renderListKeepFocus(keepSuggest) {
  const el = $('q');
  const pos = el ? el.selectionStart : null;
  const sug = keepSuggest ? $('q-suggest').innerHTML : '';
  renderList();
  const el2 = $('q');
  if (el2) {
    el2.focus();
    if (pos != null) el2.setSelectionRange(pos, pos);
  }
  if (sug) { $('q-suggest').innerHTML = sug; $('q-suggest').classList.remove('hidden'); }
}

function applySuggest(t) {
  listQuery = t;
  $('q-suggest').classList.add('hidden');
  renderList();
}
function renderDetail(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) { $('view').innerHTML = '<div class="empty">找不到这道菜。<a href="#/">回到列表</a></div>'; return; }

  const cover = r.cover_url
    ? `<div class="detail-cover"><img src="${escHtml(r.cover_url)}" alt="${escHtml(r.name)}"></div>` : '';
  const tags = (r.tags || []).join(' · ');

  const ings = (r.ingredients || []).length
    ? '<ul class="ing-list">' + r.ingredients.map(i =>
        `<li><span>${escHtml(i.name)}</span><span class="amt">${escHtml(i.amount || '')}</span></li>`).join('') + '</ul>'
    : '<div class="hint">还没记食材。</div>';

  const steps = (r.steps || []).length
    ? '<ol class="step-list">' + r.steps.map(s => `<li>${escHtml(s)}</li>`).join('') + '</ol>'
    : '<div class="hint">还没记步骤。</div>';

  const gallery = (r.image_urls || []).length
    ? `<div class="section-title">成品图</div><div class="thumbs">` +
      r.image_urls.map(u => `<img src="${escHtml(u)}" alt="" loading="lazy" onclick="openLightbox('${escHtml(u)}')">`).join('') +
      '</div>' : '';

  $('view').innerHTML = `<article class="detail">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="#/">← 回到列表</a>
    ${cover}
    <h1>${escHtml(r.name)}</h1>
    ${tags ? `<div class="detail-tags">${escHtml(tags)}</div>` : ''}
    <div class="section-title">食材</div>${ings}
    <div class="section-title">步骤</div>${steps}
    ${gallery}
    <div class="detail-actions">
      <a class="btn btn-ghost" href="#/edit/${r.id}">✎ 编辑</a>
      <button class="btn btn-danger" onclick="askDelete(${r.id})">删除</button>
    </div>
  </article>`;
}

async function askDelete(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`确定删除「${r.name}」？这一步不可撤销。`)) return;
  setSync('busy');
  try {
    await recipeDelete(id);
    // 图片删除失败不阻断——食谱已经没了，留几张孤儿图无所谓
    const urls = (r.cover_url ? [r.cover_url] : []).concat(r.image_urls || []);
    await Promise.all(urls.map(deleteImage));
    recipes = recipes.filter(x => x.id !== id);
    setSync('ok');
    location.hash = '#/';
    render();
  } catch (e) {
    setSync('err');
    alert('删除失败：' + e.message);
  }
}
// 编辑中的草稿。renderEditor 会重建它，之后所有输入改的都是这个对象。
let draft = null;

function blankDraft() {
  return { id: null, name: '', tags: [], cover_url: '', image_urls: [],
           ingredients: [{ name: '', amount: '' }], steps: '' };
}

function renderEditor(id) {
  if (id == null) {
    draft = blankDraft();
  } else {
    const r = recipes.find(x => x.id === id);
    if (!r) { $('view').innerHTML = '<div class="empty">找不到这道菜。<a href="#/">回到列表</a></div>'; return; }
    draft = {
      id: r.id, name: r.name, tags: (r.tags || []).slice(),
      cover_url: r.cover_url || '', image_urls: (r.image_urls || []).slice(),
      ingredients: (r.ingredients || []).length ? r.ingredients.map(i => ({ name: i.name, amount: i.amount || '' }))
                                                : [{ name: '', amount: '' }],
      steps: (r.steps || []).join('\n'),
    };
  }
  paintEditor();
}

function paintEditor() {
  const known = allTags();
  const tagChips = known.map(t =>
    `<button type="button" class="tag-chip${draft.tags.includes(t) ? ' on' : ''}" onclick="toggleDraftTag('${escHtml(t)}')">${escHtml(t)}</button>`
  ).join('');
  const extra = draft.tags.filter(t => !known.includes(t)).map(t =>
    `<button type="button" class="tag-chip on" onclick="toggleDraftTag('${escHtml(t)}')">${escHtml(t)}</button>`
  ).join('');

  const cover = draft.cover_url
    ? `<div class="img-thumb"><img src="${escHtml(draft.cover_url)}" alt=""><button type="button" onclick="removeCover()">×</button></div>`
    : '';
  const gallery = draft.image_urls.map((u, i) =>
    `<div class="img-thumb"><img src="${escHtml(u)}" alt=""><button type="button" onclick="removeGalleryImg(${i})">×</button></div>`
  ).join('');

  const ingRows = draft.ingredients.map((ing, i) => {
    const isNew = ing.name.trim() && !aliasMap.has(normKey(ing.name));
    return `<div class="ing-row">
      <div class="ing-name">
        <input type="text" placeholder="食材名" value="${escHtml(ing.name)}"
               autocomplete="off"
               oninput="setIng(${i},'name',this.value);ingSuggest(${i},this.value)"
               onfocus="ingSuggest(${i},this.value)"
               onblur="setTimeout(()=>hideIngSuggest(${i}),150)">
        ${isNew ? '<span class="new-flag">新</span>' : ''}
        <div class="suggest hidden" id="ing-sug-${i}"></div>
      </div>
      <input class="ing-amt" type="text" placeholder="用量" value="${escHtml(ing.amount)}"
             oninput="setIng(${i},'amount',this.value)">
      <button type="button" class="rm" onclick="removeIng(${i})" title="删掉这行">×</button>
    </div>`;
  }).join('');

  $('view').innerHTML = `<form class="form" onsubmit="return saveDraft(event)">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="${draft.id ? '#/r/' + draft.id : '#/'}">← 取消</a>

    <div class="field">
      <label>菜名</label>
      <input type="text" id="f-name" value="${escHtml(draft.name)}" oninput="draft.name=this.value" required>
    </div>

    <div class="field">
      <label>分类标签</label>
      <div class="tagbar">${tagChips}${extra}</div>
      <input type="text" id="f-newtag" placeholder="输入新标签后按回车"
             onkeydown="if(event.key==='Enter'){event.preventDefault();addDraftTag(this.value);this.value='';}">
    </div>

    <div class="field">
      <label>封面图</label>
      <div class="imgs-row">
        ${cover}
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">
          ${draft.cover_url ? '换一张' : '+ 上传'}
          <input type="file" accept="image/*" hidden onchange="pickCover(this)">
        </label>
      </div>
    </div>

    <div class="field">
      <label>成品图（可多张）</label>
      <div class="imgs-row">
        ${gallery}
        <label class="btn btn-ghost btn-sm" style="cursor:pointer">
          + 添加
          <input type="file" accept="image/*" multiple hidden onchange="pickGallery(this)">
        </label>
      </div>
    </div>

    <div class="field">
      <label>食材</label>
      ${ingRows}
      <button type="button" class="btn btn-ghost btn-sm" onclick="addIng()">+ 加一行</button>
      <div class="hint">打字时会从食材词表补全。词表里没有的会标「新」，保存时自动加进词表。</div>
    </div>

    <div class="field">
      <label>步骤</label>
      <textarea id="f-steps" placeholder="一行一步" oninput="draft.steps=this.value">${escHtml(draft.steps)}</textarea>
      <div class="hint">一行一步，保存时按行拆开。空行会被忽略。</div>
    </div>

    <div class="form-actions">
      <button type="submit" class="btn btn-accent" id="save-btn">保存</button>
      <a class="btn btn-ghost" href="${draft.id ? '#/r/' + draft.id : '#/'}">取消</a>
    </div>
  </form>`;
}

// ── 草稿操作 ──
function toggleDraftTag(t) {
  const i = draft.tags.indexOf(t);
  if (i >= 0) draft.tags.splice(i, 1); else draft.tags.push(t);
  paintEditor();
}
function addDraftTag(t) {
  const v = String(t || '').trim();
  if (v && !draft.tags.includes(v)) draft.tags.push(v);
  paintEditor();
}
function setIng(i, field, v) { draft.ingredients[i][field] = v; }
function addIng() { draft.ingredients.push({ name: '', amount: '' }); paintEditor(); }
function removeIng(i) {
  draft.ingredients.splice(i, 1);
  if (!draft.ingredients.length) draft.ingredients.push({ name: '', amount: '' });
  paintEditor();
}
function removeCover() { draft.cover_url = ''; paintEditor(); }
function removeGalleryImg(i) { draft.image_urls.splice(i, 1); paintEditor(); }

async function pickCover(input) {
  if (!input.files.length) return;
  setSync('busy');
  try {
    draft.cover_url = await uploadImage(draft.id || 'new', input.files[0]);
    setSync('ok');
  } catch (e) { setSync('err'); alert('上传失败：' + e.message); }
  paintEditor();
}
async function pickGallery(input) {
  if (!input.files.length) return;
  setSync('busy');
  try {
    for (const f of Array.from(input.files)) {
      draft.image_urls.push(await uploadImage(draft.id || 'new', f));
    }
    setSync('ok');
  } catch (e) { setSync('err'); alert('上传失败：' + e.message); }
  paintEditor();
}

// ── 食材自动补全 ──
function ingSuggest(i, v) {
  const box = $('ing-sug-' + i);
  if (!box) return;
  const nv = normKey(v);
  if (!nv) { box.classList.add('hidden'); return; }
  const pool = new Set();
  for (const w of vocab) {
    if (normKey(w.canonical).includes(nv)) pool.add(w.canonical);
    for (const a of (w.aliases || [])) if (normKey(a).includes(nv)) pool.add(w.canonical);
  }
  const items = Array.from(pool).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); return; }
  box.innerHTML = items.map(t => `<div onmousedown="applyIngSuggest(${i},'${escHtml(t)}')">${escHtml(t)}</div>`).join('');
  box.classList.remove('hidden');
}
function hideIngSuggest(i) { const b = $('ing-sug-' + i); if (b) b.classList.add('hidden'); }
function applyIngSuggest(i, t) { draft.ingredients[i].name = t; paintEditor(); }

// ── 保存 ──
async function saveDraft(ev) {
  ev.preventDefault();
  const name = draft.name.trim();
  if (!name) { alert('菜名不能为空'); return false; }

  const ings = draft.ingredients
    .map(i => ({ name: i.name.trim(), amount: (i.amount || '').trim() }))
    .filter(i => i.name);
  const keys = Array.from(new Set(ings.map(i => toCanonical(i.name, aliasMap)))).filter(Boolean);
  const steps = draft.steps.split('\n').map(s => s.trim()).filter(Boolean);

  // 词表里没有的食材，以自身为 canonical 新建一行
  const unknown = keys.filter(k => !aliasMap.has(normKey(k)));

  $('save-btn').disabled = true;
  setSync('busy');
  try {
    if (unknown.length) {
      const added = await vocabInsert(unknown.map(k => ({ canonical: k, aliases: [], staple: false })));
      vocab = vocab.concat(added);
      reindex();
    }
    const payload = {
      name: name, tags: draft.tags, cover_url: draft.cover_url || null,
      image_urls: draft.image_urls, ingredients: ings,
      ingredient_keys: keys, steps: steps,
    };
    let saved;
    if (draft.id) {
      saved = await recipeUpdate(draft.id, payload);
      const i = recipes.findIndex(r => r.id === draft.id);
      if (i >= 0) recipes[i] = saved;
    } else {
      saved = await recipeInsert(payload);
      recipes.unshift(saved);
    }
    setSync('ok');
    location.hash = '#/r/' + saved.id;
    render();
  } catch (e) {
    setSync('err');
    alert('保存失败：' + e.message);
    $('save-btn').disabled = false;
  }
  return false;
}
function renderIdea() {
  const chips = ideaHave.map((k, i) =>
    `<span class="chip">${escHtml(k)}<button type="button" onclick="removeHave(${i})">×</button></span>`).join('');

  let body = '';
  if (!ideaHave.length) {
    body = '<div class="empty">在上面输入你手头有的食材，<br>一样一样加进来，下面会算出你现在能做什么。<br><br>盐、油、酱油这类常备调料默认当你有，不用输。</div>';
  } else {
    const res = matchRecipes(ideaHave, recipes, staples);
    if (!res.length) {
      body = '<div class="empty">这些食材凑不出库里任何一道菜（差 4 样以上的没有列出）。<br>再加几样试试？</div>';
    } else {
      const buckets = new Map();
      for (const it of res) {
        const n = it.missing.length;
        if (!buckets.has(n)) buckets.set(n, []);
        buckets.get(n).push(it);
      }
      for (const n of Array.from(buckets.keys()).sort((a, b) => a - b)) {
        const list = buckets.get(n);
        const title = n === 0 ? `现在就能做 (${list.length})` : `再买 ${n} 样就能做 (${list.length})`;
        body += `<div class="bucket-title ${n === 0 ? 'bucket-0' : 'bucket-n'}">${title}</div>`;
        body += '<ul class="bucket-list">' + list.map(it =>
          `<li>
             <a href="#/r/${it.recipe.id}">${escHtml(it.recipe.name)}</a>
             <span class="miss">${n === 0 ? '食材齐了' : '+ ' + it.missing.map(escHtml).join(' + ')}</span>
           </li>`).join('') + '</ul>';
      }
    }
  }

  $('view').innerHTML = `<div class="detail">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="#/">← 回到列表</a>
    <h1 style="margin:14px 0 18px">冰箱里有什么</h1>
    <div class="chip-input" onclick="document.getElementById('have-input').focus()">
      ${chips}
      <input id="have-input" type="text" placeholder="${ideaHave.length ? '继续加…' : '输入一样食材，回车加入'}"
             autocomplete="off"
             oninput="haveSuggest(this.value)"
             onkeydown="onHaveKey(event, this)">
      <div class="suggest hidden" id="have-suggest"></div>
    </div>
    ${body}
  </div>`;

  const el = $('have-input');
  if (el) el.focus();
}

function addHave(text) {
  const k = toCanonical(text, aliasMap);
  if (k && !ideaHave.includes(k)) ideaHave.push(k);
  renderIdea();
}
function removeHave(i) { ideaHave.splice(i, 1); renderIdea(); }

function onHaveKey(ev, el) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    if (el.value.trim()) { addHave(el.value); el.value = ''; }
  } else if (ev.key === 'Backspace' && !el.value && ideaHave.length) {
    ideaHave.pop(); renderIdea();
  }
}

function haveSuggest(v) {
  const box = $('have-suggest');
  if (!box) return;
  const nv = normKey(v);
  if (!nv) { box.classList.add('hidden'); return; }
  const pool = new Set();
  for (const w of vocab) {
    if (normKey(w.canonical).includes(nv)) pool.add(w.canonical);
    for (const a of (w.aliases || [])) if (normKey(a).includes(nv)) pool.add(w.canonical);
  }
  const items = Array.from(pool).filter(t => !ideaHave.includes(t)).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); return; }
  box.innerHTML = items.map(t => `<div onmousedown="addHave('${escHtml(t)}')">${escHtml(t)}</div>`).join('');
  box.classList.remove('hidden');
}
async function initApp() {
  if (loaded) { render(); return; }
  $('view').innerHTML = '<div class="loading-wrap"><div class="spinner"></div><div>正在加载食谱…</div></div>';
  setSync('busy');
  try {
    await loadAll();
    loaded = true;
    setSync('ok');
    render();
  } catch (e) {
    setSync('err');
    $('view').innerHTML = '<div class="empty">加载失败：' + escHtml(e.message) + '</div>';
  }
}

// ── 启动 ──
// 必须放在文件最末：上面用 let 声明的 vocab / recipes / loaded 在求值到那一行之前
// 处于暂时性死区，提前调用 initApp() 会在 `if (loaded)` 上抛 ReferenceError。
if (sessionStorage.getItem(SESSION_KEY) === '1') {
  enterApp();
} else {
  $('lock-input').focus();
}
