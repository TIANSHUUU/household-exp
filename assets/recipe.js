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
function renderDetail() { $('view').innerHTML = '<div class="empty">详情页占位</div>'; }
function renderEditor() { $('view').innerHTML = '<div class="empty">编辑页占位</div>'; }
function renderIdea()   { $('view').innerHTML = '<div class="empty">灵感页占位</div>'; }
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
