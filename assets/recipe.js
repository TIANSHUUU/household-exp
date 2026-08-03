// ── Supabase REST / Storage (no SDK) ──
const API     = 'https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1';
const STORAGE = 'https://mpvsbeghuueffkjdemcr.supabase.co/storage/v1';
const BUCKET  = 'recipe-images';
// KEY 和 H() 来自 assets/auth.js（必须先加载）

const FN_URL  = 'https://mpvsbeghuueffkjdemcr.supabase.co/functions/v1/kitchen-ai';

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

// 取某个字段的当前语言版本，为空则回退到另一版。
// 回退而不是留空，是为了让只填了一种语言的食谱在两种模式下都能正常显示——
// 翻译是渐进的，不该是食谱能不能看的前提。
function pickField(recipe, field, lang) {
  const other = lang === 'en' ? 'zh' : 'en';
  const a = recipe[field + '_' + lang], b = recipe[field + '_' + other];
  const has = v => v != null && (typeof v === 'string' ? v.trim() !== '' : v.length > 0);
  return has(a) ? a : (has(b) ? b : (typeof a === 'string' ? '' : []));
}

// 食材建议在编辑器里显示成哪个词。
// tab 是**当前编辑的页签**，不是界面语言——决定文字往哪一版里写的是页签。
// 在 EN 页签插入 canonical 会把中文写进 ingredients_en，英文版食谱就会
// 显示「盐」。保存时 toCanonical 会把英文别名映射回中文 canonical，
// 所以显示成英文不影响 ingredient_keys。
// 没有英文别名的（比如「豆瓣酱」只有拼音别名）就退回 canonical——
// 显示中文总好过显示不出来。
function ingLabel(entry, tab) {
  if (tab !== 'en') return entry.canonical;
  const en = (entry.aliases || []).find(a => !/[一-鿿]/.test(a));
  return en || entry.canonical;
}

// 搜索。返回 {byName, byIngredient}，同一道菜只出现在一组里（菜名优先）。
function searchRecipes(q, recipes, aliasMap) {
  const raw = String(q == null ? '' : q).trim();
  if (!raw) return { byName: [], byIngredient: [] };
  const nq = normKey(raw);
  const canon = toCanonical(raw, aliasMap);
  const byName = [], byIngredient = [];
  for (const r of recipes) {
    // 两种语言的菜名都搜——中文界面下搜 "pancake" 也该找得到
    if (normKey(r.name_zh).includes(nq) || normKey(r.name_en).includes(nq)) { byName.push(r); continue; }
    const keyHit = (r.ingredient_keys || []).some(k => k === canon || normKey(k).includes(nq));
    const rawHit = [].concat(r.ingredients_zh || [], r.ingredients_en || [])
      .some(i => normKey(i.name).includes(nq));
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

// ── 界面语言 ──
// 用 localStorage 而不是 sessionStorage：语言偏好该跨会话保持，登录态不该。
const LANG_KEY = 'recipe_lang';
let lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';

const I18N = {
  zh: {
    appTitle: '家庭食谱', navExpense: '💰 开支', navShopping: '🛒 购物',
    navActivity: '📅 日程', navLock: '锁定', langBtn: 'EN',
    lockSub: '请输入密码以继续', lockBtn: '进入',
    lockNeedPw: '请输入密码', lockWrongPw: '登录失败，请检查密码和网络',
    lockSigningIn: '登录中…',
    loading: '正在加载食谱…', loadFailed: '加载失败：{0}',
    searchPh: '搜索菜名或食材…', fridgeBtn: '🧊 冰箱里有什么', newBtn: '+ 新食谱',
    tagAll: '全部', groupByName: '菜名含此词 ({0})', groupByIng: '食材含此词 ({0})',
    emptyNoRecipes: '还没有食谱。<br>点右上角「+ 新食谱」记下第一道菜吧。',
    emptyNoSearch: '没有找到含「{0}」的食谱。', emptyNoTag: '没有标签为「{0}」的食谱。',
    backToList: '← 回到列表', secIngredients: '食材', secSteps: '步骤', secGallery: '成品图',
    noIngredients: '还没记食材。', noSteps: '还没记步骤。',
    editBtn: '✎ 编辑', deleteBtn: '删除',
    notFound: '找不到这道菜。', backLink: '回到列表',
    cancel: '取消', fName: '菜名', fTags: '分类标签', newTagPh: '输入新标签后按回车',
    fCover: '封面图', upload: '+ 上传', replace: '换一张',
    fGallery: '成品图（可多张）', addImg: '+ 添加',
    fIngredients: '食材', ingNamePh: '食材名', ingAmtPh: '用量', addRow: '+ 加一行',
    ingHint: '打字时会从食材词表补全。词表里没有的会标「新」，保存时自动加进词表。',
    newFlag: '新', rmRow: '删掉这行',
    fSteps: '步骤', stepsPh: '一行一步',
    stepsHint: '一行一步，保存时按行拆开。空行会被忽略。',
    save: '保存', nameRequired: '菜名不能为空',
    saveFailed: '保存失败：{0}', uploadFailed: '上传失败：{0}', deleteFailed: '删除失败：{0}',
    confirmDelete: '确定删除「{0}」？这一步不可撤销。',
    ideaTitle: '冰箱里有什么',
    ideaEmpty: '在上面输入你手头有的食材，<br>一样一样加进来，下面会算出你现在能做什么。<br><br>盐、油、酱油这类常备调料默认当你有，不用输。',
    ideaNoMatch: '这些食材凑不出库里任何一道菜（差 4 样以上的没有列出）。<br>再加几样试试？',
    bucketNow: '现在就能做 ({0})', bucketBuy: '再买 {0} 样就能做 ({1})',
    allSet: '食材齐了', chipPhFirst: '输入一样食材，回车加入', chipPhMore: '继续加…',
    copyBtn: '📋 复制给 Claude 提问', copied: '✓ 已复制',
    copyHint: '把食谱库和手头食材拼成一段 prompt 复制走，粘到 claude.ai 里问创意建议。用的是你自己的订阅额度，不花 API 钱。',
    copyFailed: '复制失败，请手动复制：',
    translateToEn: '🌐 翻译到英文', translateToZh: '🌐 翻译到中文', translating: '翻译中…',
    tabHint: '两种语言各存一份。只填一边也能用——另一边为空时会自动回退显示已填的那版。',
    sharedNote: '以下内容中英共用',
    translateFailed: '翻译失败：{0}',
    translateEmpty: '当前页签是空的，没有可翻译的内容。',
    err_rate_limited: '今天的翻译次数用完了（每天 20 次）。明天再来，或者手填另一个页签。',
    err_unauthorized: '登录已过期，请重新登录',
    err_unknown_action: '服务端不认识这个请求',
    err_provider_error: '翻译服务出错了，稍后再试',
  },
  en: {
    appTitle: 'Our Recipes', navExpense: '💰 Expenses', navShopping: '🛒 Shopping',
    navActivity: '📅 Schedule', navLock: 'Lock', langBtn: '中文',
    lockSub: 'Enter the password to continue', lockBtn: 'Enter',
    lockNeedPw: 'Password required', lockWrongPw: 'Sign-in failed — check the password and your connection',
    lockSigningIn: 'Signing in…',
    loading: 'Loading recipes…', loadFailed: 'Could not load: {0}',
    searchPh: 'Search a dish or ingredient…', fridgeBtn: '🧊 What\'s in the fridge', newBtn: '+ New recipe',
    tagAll: 'All', groupByName: 'Name matches ({0})', groupByIng: 'Ingredient matches ({0})',
    emptyNoRecipes: 'No recipes yet.<br>Hit “+ New recipe” to write down your first one.',
    emptyNoSearch: 'Nothing found for “{0}”.', emptyNoTag: 'No recipes tagged “{0}”.',
    backToList: '← Back to list', secIngredients: 'Ingredients', secSteps: 'Steps', secGallery: 'Photos',
    noIngredients: 'No ingredients recorded yet.', noSteps: 'No steps recorded yet.',
    editBtn: '✎ Edit', deleteBtn: 'Delete',
    notFound: 'This dish no longer exists.', backLink: 'Back to list',
    cancel: 'Cancel', fName: 'Dish name', fTags: 'Tags', newTagPh: 'Type a new tag, press Enter',
    fCover: 'Cover photo', upload: '+ Upload', replace: 'Replace',
    fGallery: 'More photos (optional)', addImg: '+ Add',
    fIngredients: 'Ingredients', ingNamePh: 'Ingredient', ingAmtPh: 'Amount', addRow: '+ Add a row',
    ingHint: 'Autocompletes from the shared ingredient list. Anything new is marked “new” and added on save.',
    newFlag: 'new', rmRow: 'Remove this row',
    fSteps: 'Steps', stepsPh: 'One step per line',
    stepsHint: 'One step per line — split on save. Blank lines are ignored.',
    save: 'Save', nameRequired: 'The dish needs a name',
    saveFailed: 'Could not save: {0}', uploadFailed: 'Upload failed: {0}', deleteFailed: 'Could not delete: {0}',
    confirmDelete: 'Delete “{0}”? This cannot be undone.',
    ideaTitle: 'What\'s in the fridge',
    ideaEmpty: 'Add what you have on hand, one ingredient at a time.<br>We\'ll work out what you can cook right now.<br><br>Salt, oil, soy sauce and the like are assumed — no need to list them.',
    ideaNoMatch: 'Nothing in the collection matches (anything needing 4+ extra items is hidden).<br>Try adding a few more?',
    bucketNow: 'Ready to cook ({0})', bucketBuy: 'Buy {0} more and you can cook ({1})',
    allSet: 'all set', chipPhFirst: 'Type an ingredient, press Enter', chipPhMore: 'Keep adding…',
    copyBtn: '📋 Copy a prompt for Claude', copied: '✓ Copied',
    copyHint: 'Copies your recipe collection plus what you have on hand as a ready-made prompt. Paste it into claude.ai — it uses your own subscription, not paid API credits.',
    copyFailed: 'Copy failed — here is the text:',
    translateToEn: '🌐 Translate to English', translateToZh: '🌐 Translate to Chinese', translating: 'Translating…',
    tabHint: 'Each language is stored separately. Filling in just one is fine — the other falls back to it when empty.',
    sharedNote: 'Shared across both languages',
    translateFailed: 'Translation failed: {0}',
    translateEmpty: 'This tab is empty — nothing to translate.',
    err_rate_limited: 'Out of translations for today (20/day). Try tomorrow, or fill the other tab by hand.',
    err_unauthorized: 'Session expired — please sign in again',
    err_unknown_action: 'The server did not recognise this request',
    err_provider_error: 'The translation service errored — try again shortly',
  },
};

// {0} {1} 占位符替换。缺 key 时回退中文再回退 key 本身，绝不显示空白。
function t(k) {
  const s = I18N[lang][k] != null ? I18N[lang][k] : (I18N.zh[k] != null ? I18N.zh[k] : k);
  const args = Array.prototype.slice.call(arguments, 1);
  return args.length ? String(s).replace(/\{(\d)\}/g, (m, i) => args[i] != null ? args[i] : m) : s;
}

function setLang(l) {
  lang = l;
  localStorage.setItem(LANG_KEY, l);
  document.documentElement.lang = l === 'en' ? 'en' : 'zh-CN';
  paintChrome();
  render();
}
function toggleLang() { setLang(lang === 'en' ? 'zh' : 'en'); }

// 取食谱字段的当前语言版本（薄封装，回退逻辑在 pickField 里，可被 node 验证）
function pick(r, field) { return pickField(r, field, lang); }

// 标签翻译：中文 canonical → 当前语言显示名。没有翻译就原样显示。
function tagLabel(zh) {
  if (lang !== 'en') return zh;
  const hit = tagI18n.find(x => x.zh === zh);
  return hit ? hit.en : zh;
}

// 顶栏和密码门是写在 HTML 里的静态文案，切语言时要手动刷
function paintChrome() {
  const set = (id, txt) => { const e = $(id); if (e) e.textContent = txt; };
  set('lock-title', t('appTitle'));
  set('lock-sub', t('lockSub'));
  set('lock-btn', t('lockBtn'));
  set('nav-expense', t('navExpense'));
  set('nav-shopping', t('navShopping'));
  set('nav-activity', t('navActivity'));
  set('nav-lock', t('navLock'));
  set('lang-btn', t('langBtn'));
  const h1 = $('app-title');
  if (h1) h1.childNodes[0].nodeValue = t('appTitle');
  const li = $('lock-input');
  if (li) li.placeholder = lang === 'en' ? 'password' : '••••••••';
  document.title = t('appTitle');
}

// ── 密码门（登录态由 assets/auth.js 统一管，四页共用） ──
let signingIn = false;
async function unlock() {
  const inp = $('lock-input'), err = $('lock-error'), btn = $('lock-btn');
  if (signingIn) return;                       // 登录要走网络，连点会发多个请求
  if (!inp.value) { err.textContent = t('lockNeedPw'); return; }
  signingIn = true;
  err.textContent = '';
  if (btn) { btn.disabled = true; btn.textContent = t('lockSigningIn'); }
  const ok = await signIn(inp.value);
  signingIn = false;
  if (btn) { btn.disabled = false; btn.textContent = t('lockBtn'); }
  if (ok) {
    inp.value = '';
    enterApp();
  } else {
    err.textContent = t('lockWrongPw');
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
  signOut();
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
  const r = await fetch(`${API}/ingredient_vocab?select=*&order=canonical.asc`, { headers: await H() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function vocabInsert(rows) {
  if (!rows.length) return [];
  const r = await fetch(`${API}/ingredient_vocab`, {
    method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function recipeGetAll() {
  const r = await fetch(`${API}/recipes?select=*&order=id.desc`, { headers: await H() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function tagI18nGetAll() {
  const r = await fetch(`${API}/tag_i18n?select=zh,en`, { headers: await H() });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function tagI18nInsert(rows) {
  if (!rows.length) return [];
  const r = await fetch(`${API}/tag_i18n`, {
    method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function recipeInsert(rec) {
  const r = await fetch(`${API}/recipes`, {
    method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' },
    body: JSON.stringify([rec]),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json())[0];
}
async function recipeUpdate(id, patch) {
  const r = await fetch(`${API}/recipes?id=eq.${id}`, {
    method: 'PATCH', headers: { ...await H(), 'Prefer': 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(await r.text());
  return (await r.json())[0];
}
async function recipeDelete(id) {
  const r = await fetch(`${API}/recipes?id=eq.${id}`, { method: 'DELETE', headers: await H() });
  if (!r.ok) throw new Error(await r.text());
}

// ── 图片 ──
// 超过这个大小才压缩。手机照片基本都在这以下，原样上传能保住 iPhone HDR 照片的
// gain map（APP2/MPF 段）和 ICC profile —— canvas 一定会把它们丢掉，没有例外，
// 丢了之后照片在 HDR 屏上只剩压平的 SDR 基础层，看起来发灰。
// 卡片图有 loading="lazy"，所以原图带来的流量代价可控。
const SHRINK_OVER_BYTES = 4 * 1024 * 1024;

// 压到长边 1600px 的 JPEG。只对超大文件用——见上面 SHRINK_OVER_BYTES 的说明。
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

function randomName(type) {
  const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[type] || 'jpg';
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '.' + ext;
}

// 返回公开可读的 URL。小图原样传（保住 HDR/色彩），大图才压。
async function uploadImage(folder, file) {
  const blob = file.size > SHRINK_OVER_BYTES ? await shrinkImage(file) : file;
  const path = `recipes/${folder}/${randomName(blob.type)}`;
  const r = await fetch(`${STORAGE}/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...await H(), 'Content-Type': blob.type || 'image/jpeg' },
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
      method: 'DELETE', headers: await H(),
    });
  } catch (e) { console.warn('删除图片失败（已忽略）', path, e); }
}

// ── 内存状态 ──
let vocab = [], recipes = [], aliasMap = new Map(), staples = new Set();
let tagI18n = [];                   // [{zh, en}] 标签翻译表
let loaded = false;
let listQuery = '', listTag = '';   // 列表页搜索词 / 选中标签
let ideaHave = [];                  // 灵感页已选食材（canonical）

function reindex() {
  aliasMap = buildAliasMap(vocab);
  staples  = stapleSet(vocab);
}

async function loadAll() {
  const [v, rs, ti] = await Promise.all([vocabGetAll(), recipeGetAll(), tagI18nGetAll()]);
  vocab = v; recipes = rs; tagI18n = ti;
  reindex();
}

// 数据签名——只有内容真的变了才重渲染，避免轮询把输入框刷掉
function dataSig() {
  return recipes.map(r => [r.id, r.name_zh || '', r.name_en || '',
    (r.image_urls || []).length, (r.ingredient_keys || []).join(','),
    (r.steps_zh || []).length, (r.steps_en || []).length].join(':')).join('|')
    + '#' + vocab.length + '#' + tagI18n.length;
}

// ── 视图 ──
function allTags() {
  const s = new Set();
  for (const r of recipes) for (const tg of (r.tags || [])) s.add(tg);
  return Array.from(s).sort();
}

function cardHtml(r, num) {
  const name = pick(r, 'name');
  const img = r.cover_url
    ? `<img src="${escHtml(r.cover_url)}" alt="${escHtml(name)}" loading="lazy">`
    : '<div class="noimg">🍽</div>';
  const tags = (r.tags || []).map(tagLabel).join(' · ');
  return `<a class="card" href="#/r/${r.id}">
    <div class="card-img">${img}</div>
    <div class="card-meta">
      <span class="card-num">№ ${String(num).padStart(2, '0')}</span>
      ${tags ? `<span class="card-tags">${escHtml(tags)}</span>` : ''}
    </div>
    <h2>${escHtml(name)}</h2>
  </a>`;
}

function gridHtml(list, startNum) {
  return '<div class="grid">' +
    list.map((r, i) => cardHtml(r, startNum + i)).join('') + '</div>';
}

function renderList() {
  const tags = allTags();
  const tagbar = tags.length ? '<div class="tagbar">' +
    `<button class="tag-chip${listTag ? '' : ' on'}" onclick="pickTag('')">${escHtml(t('tagAll'))}</button>` +
    tags.map(tg => `<button class="tag-chip${listTag === tg ? ' on' : ''}" onclick="pickTag('${escHtml(tg)}')">${escHtml(tagLabel(tg))}</button>`).join('') +
    '</div>' : '';

  const toolbar = `<div class="toolbar">
      <div class="search-box">
        <input id="q" type="text" placeholder="${escHtml(t('searchPh'))}" value="${escHtml(listQuery)}"
               oninput="onSearchInput(this.value)" autocomplete="off">
        <div class="suggest hidden" id="q-suggest"></div>
      </div>
      <a class="btn btn-ghost" href="#/idea">${escHtml(t('fridgeBtn'))}</a>
      <a class="btn btn-accent" href="#/new">${escHtml(t('newBtn'))}</a>
    </div>`;

  let body;
  if (!recipes.length) {
    body = `<div class="empty">${t('emptyNoRecipes')}</div>`;
  } else if (listQuery.trim()) {
    const { byName, byIngredient } = searchRecipes(listQuery, filteredByTag(), aliasMap);
    if (!byName.length && !byIngredient.length) {
      body = `<div class="empty">${escHtml(t('emptyNoSearch', listQuery))}</div>`;
    } else {
      body = '';
      if (byName.length) body += `<div class="group-title">${escHtml(t('groupByName', byName.length))}</div>` + gridHtml(byName, 1);
      if (byIngredient.length) body += `<div class="group-title">${escHtml(t('groupByIng', byIngredient.length))}</div>` + gridHtml(byIngredient, 1);
    }
  } else {
    const list = filteredByTag();
    body = list.length ? gridHtml(list, 1) : `<div class="empty">${escHtml(t('emptyNoTag', tagLabel(listTag)))}</div>`;
  }

  $('view').innerHTML = toolbar + tagbar + body;
}

function filteredByTag() {
  if (!listTag) return recipes;
  return recipes.filter(r => (r.tags || []).includes(listTag));
}

function pickTag(tg) { listTag = tg; renderList(); }

function onSearchInput(v) {
  listQuery = v;
  const box = $('q-suggest');
  const nv = normKey(v);
  if (!nv) { box.classList.add('hidden'); renderListKeepFocus(); return; }
  const pool = new Set();
  for (const r of recipes) {
    for (const n of [r.name_zh, r.name_en]) if (n && normKey(n).includes(nv)) pool.add(n);
  }
  for (const w of vocab) {
    if (normKey(w.canonical).includes(nv)) pool.add(w.canonical);
    for (const a of (w.aliases || [])) if (normKey(a).includes(nv)) pool.add(w.canonical);
  }
  const items = Array.from(pool).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); renderListKeepFocus(); return; }
  box.innerHTML = items.map(x => `<div onmousedown="applySuggest('${escHtml(x)}')">${escHtml(x)}</div>`).join('');
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

function applySuggest(x) {
  listQuery = x;
  $('q-suggest').classList.add('hidden');
  renderList();
}

function renderDetail(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) { $('view').innerHTML = `<div class="empty">${escHtml(t('notFound'))} <a href="#/">${escHtml(t('backLink'))}</a></div>`; return; }

  const name = pick(r, 'name');
  const cover = r.cover_url
    ? `<div class="detail-cover"><img src="${escHtml(r.cover_url)}" alt="${escHtml(name)}"></div>` : '';
  const tags = (r.tags || []).map(tagLabel).join(' · ');

  const ingList = pick(r, 'ingredients');
  const ings = ingList.length
    ? '<ul class="ing-list">' + ingList.map(i =>
        `<li><span>${escHtml(i.name)}</span><span class="amt">${escHtml(i.amount || '')}</span></li>`).join('') + '</ul>'
    : `<div class="hint">${escHtml(t('noIngredients'))}</div>`;

  const stepList = pick(r, 'steps');
  const steps = stepList.length
    ? '<ol class="step-list">' + stepList.map(s => `<li>${escHtml(s)}</li>`).join('') + '</ol>'
    : `<div class="hint">${escHtml(t('noSteps'))}</div>`;

  const gallery = (r.image_urls || []).length
    ? `<div class="section-title">${escHtml(t('secGallery'))}</div><div class="thumbs">` +
      r.image_urls.map(u => `<img src="${escHtml(u)}" alt="" loading="lazy" onclick="openLightbox('${escHtml(u)}')">`).join('') +
      '</div>' : '';

  $('view').innerHTML = `<article class="detail">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="#/">${escHtml(t('backToList'))}</a>
    ${cover}
    <h1>${escHtml(name)}</h1>
    ${tags ? `<div class="detail-tags">${escHtml(tags)}</div>` : ''}
    <div class="section-title">${escHtml(t('secIngredients'))}</div>${ings}
    <div class="section-title">${escHtml(t('secSteps'))}</div>${steps}
    ${gallery}
    <div class="detail-actions">
      <a class="btn btn-ghost" href="#/edit/${r.id}">${escHtml(t('editBtn'))}</a>
      <button class="btn btn-danger" onclick="askDelete(${r.id})">${escHtml(t('deleteBtn'))}</button>
    </div>
  </article>`;
}

async function askDelete(id) {
  const r = recipes.find(x => x.id === id);
  if (!r) return;
  if (!confirm(t('confirmDelete', pick(r, 'name')))) return;
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
    alert(t('deleteFailed', e.message));
  }
}

async function initApp() {
  if (loaded) { render(); return; }
  $('view').innerHTML = `<div class="loading-wrap"><div class="spinner"></div><div>${escHtml(t('loading'))}</div></div>`;
  setSync('busy');
  try {
    await loadAll();
    loaded = true;
    lastSig = dataSig();
    setSync('ok');
    render();
  } catch (e) {
    setSync('err');
    $('view').innerHTML = `<div class="empty">${escHtml(t('loadFailed', e.message))}</div>`;
  }
}

// ── 编辑器 ──
// draft 的中英两版各存一份 name/ingredients/steps；tags 和图片是共享的，不分语言。
let draft = null;

function blankSide() { return { name: '', ingredients: [{ name: '', amount: '' }], steps: '' }; }
function blankDraft() {
  return { id: null, tags: [], cover_url: '', image_urls: [],
           zh: blankSide(), en: blankSide(), tab: lang === 'en' ? 'en' : 'zh' };
}
function sideFrom(r, l) {
  const ings = r['ingredients_' + l] || [];
  return {
    name: r['name_' + l] || '',
    ingredients: ings.length ? ings.map(i => ({ name: i.name, amount: i.amount || '' }))
                             : [{ name: '', amount: '' }],
    steps: (r['steps_' + l] || []).join('\n'),
  };
}
function side() { return draft[draft.tab]; }

function renderEditor(id) {
  if (id == null) {
    draft = blankDraft();
  } else {
    const r = recipes.find(x => x.id === id);
    if (!r) { $('view').innerHTML = `<div class="empty">${escHtml(t('notFound'))} <a href="#/">${escHtml(t('backLink'))}</a></div>`; return; }
    draft = { id: r.id, tags: (r.tags || []).slice(),
              cover_url: r.cover_url || '', image_urls: (r.image_urls || []).slice(),
              zh: sideFrom(r, 'zh'), en: sideFrom(r, 'en'), tab: lang === 'en' ? 'en' : 'zh' };
  }
  paintEditor();
}

function switchTab(tb) { draft.tab = tb; paintEditor(); }

function paintEditor() {
  const s = side();
  const other = draft.tab === 'zh' ? 'en' : 'zh';
  const known = allTags();
  const tagChips = known.map(tg =>
    `<button type="button" class="tag-chip${draft.tags.includes(tg) ? ' on' : ''}" onclick="toggleDraftTag('${escHtml(tg)}')">${escHtml(tagLabel(tg))}</button>`
  ).join('');
  const extra = draft.tags.filter(tg => !known.includes(tg)).map(tg =>
    `<button type="button" class="tag-chip on" onclick="toggleDraftTag('${escHtml(tg)}')">${escHtml(tagLabel(tg))}</button>`
  ).join('');

  const cover = draft.cover_url
    ? `<div class="img-thumb"><img src="${escHtml(draft.cover_url)}" alt=""><button type="button" onclick="removeCover()">×</button></div>`
    : '';
  const gallery = draft.image_urls.map((u, i) =>
    `<div class="img-thumb"><img src="${escHtml(u)}" alt=""><button type="button" onclick="removeGalleryImg(${i})">×</button></div>`
  ).join('');

  const ingRows = s.ingredients.map((ing, i) => {
    const isNew = ing.name.trim() && !aliasMap.has(normKey(ing.name));
    return `<div class="ing-row">
      <div class="ing-name">
        <input type="text" placeholder="${escHtml(t('ingNamePh'))}" value="${escHtml(ing.name)}"
               autocomplete="off"
               oninput="setIng(${i},'name',this.value);ingSuggest(${i},this.value)"
               onfocus="ingSuggest(${i},this.value)"
               onblur="setTimeout(()=>hideIngSuggest(${i}),150)">
        ${isNew ? `<span class="new-flag">${escHtml(t('newFlag'))}</span>` : ''}
        <div class="suggest hidden" id="ing-sug-${i}"></div>
      </div>
      <input class="ing-amt" type="text" placeholder="${escHtml(t('ingAmtPh'))}" value="${escHtml(ing.amount)}"
             oninput="setIng(${i},'amount',this.value)">
      <button type="button" class="rm" onclick="removeIng(${i})" title="${escHtml(t('rmRow'))}">×</button>
    </div>`;
  }).join('');

  const tabBar = `<div class="lang-tabs">
      <button type="button" class="lang-tab${draft.tab === 'zh' ? ' on' : ''}" onclick="switchTab('zh')">中文</button>
      <button type="button" class="lang-tab${draft.tab === 'en' ? ' on' : ''}" onclick="switchTab('en')">EN</button>
      <button type="button" class="btn btn-ghost btn-sm translate-btn" id="tr-btn" onclick="translateDraft()">
        ${escHtml(t(other === 'en' ? 'translateToEn' : 'translateToZh'))}
      </button>
    </div>`;

  $('view').innerHTML = `<form class="form" onsubmit="return saveDraft(event)">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="${draft.id ? '#/r/' + draft.id : '#/'}">← ${escHtml(t('cancel'))}</a>

    ${tabBar}
    <div class="hint" style="margin:-8px 0 18px">${escHtml(t('tabHint'))}</div>

    <div class="field">
      <label>${escHtml(t('fName'))}</label>
      <input type="text" id="f-name" value="${escHtml(s.name)}" oninput="side().name=this.value">
    </div>

    <div class="field">
      <label>${escHtml(t('fIngredients'))}</label>
      ${ingRows}
      <button type="button" class="btn btn-ghost btn-sm" onclick="addIng()">${escHtml(t('addRow'))}</button>
      <div class="hint">${escHtml(t('ingHint'))}</div>
    </div>

    <div class="field">
      <label>${escHtml(t('fSteps'))}</label>
      <textarea id="f-steps" placeholder="${escHtml(t('stepsPh'))}" oninput="side().steps=this.value">${escHtml(s.steps)}</textarea>
      <div class="hint">${escHtml(t('stepsHint'))}</div>
    </div>

    <div class="shared-block">
      <div class="shared-label">${escHtml(t('sharedNote'))}</div>

      <div class="field">
        <label>${escHtml(t('fTags'))}</label>
        <div class="tagbar">${tagChips}${extra}</div>
        <input type="text" id="f-newtag" placeholder="${escHtml(t('newTagPh'))}"
               onkeydown="if(event.key==='Enter'){event.preventDefault();addDraftTag(this.value);this.value='';}">
      </div>

      <div class="field">
        <label>${escHtml(t('fCover'))}</label>
        <div class="imgs-row">
          ${cover}
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            ${escHtml(draft.cover_url ? t('replace') : t('upload'))}
            <input type="file" accept="image/*" hidden onchange="pickCover(this)">
          </label>
        </div>
      </div>

      <div class="field">
        <label>${escHtml(t('fGallery'))}</label>
        <div class="imgs-row">
          ${gallery}
          <label class="btn btn-ghost btn-sm" style="cursor:pointer">
            ${escHtml(t('addImg'))}
            <input type="file" accept="image/*" multiple hidden onchange="pickGallery(this)">
          </label>
        </div>
      </div>
    </div>

    <div class="form-actions">
      <button type="submit" class="btn btn-accent" id="save-btn">${escHtml(t('save'))}</button>
      <a class="btn btn-ghost" href="${draft.id ? '#/r/' + draft.id : '#/'}">${escHtml(t('cancel'))}</a>
    </div>
  </form>`;
}

// ── 草稿操作 ──
function toggleDraftTag(tg) {
  const i = draft.tags.indexOf(tg);
  if (i >= 0) draft.tags.splice(i, 1); else draft.tags.push(tg);
  paintEditor();
}
function addDraftTag(tg) {
  const v = String(tg || '').trim();
  if (v && !draft.tags.includes(v)) draft.tags.push(v);
  paintEditor();
}
function setIng(i, field, v) { side().ingredients[i][field] = v; }
function addIng() { side().ingredients.push({ name: '', amount: '' }); paintEditor(); }
function removeIng(i) {
  const s = side();
  s.ingredients.splice(i, 1);
  if (!s.ingredients.length) s.ingredients.push({ name: '', amount: '' });
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
  } catch (e) { setSync('err'); alert(t('uploadFailed', e.message)); }
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
  } catch (e) { setSync('err'); alert(t('uploadFailed', e.message)); }
  paintEditor();
}

// ── 食材自动补全 ──
function ingSuggest(i, v) {
  const box = $('ing-sug-' + i);
  if (!box) return;
  const nv = normKey(v);
  if (!nv) { box.classList.add('hidden'); return; }
  // 按 canonical 去重，但显示成当前页签的语言（见 ingLabel）
  const pool = new Map();
  for (const w of vocab) {
    const hit = normKey(w.canonical).includes(nv)
      || (w.aliases || []).some(a => normKey(a).includes(nv));
    if (hit && !pool.has(w.canonical)) pool.set(w.canonical, ingLabel(w, draft.tab));
  }
  const items = Array.from(pool.values()).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); return; }
  box.innerHTML = items.map(x => `<div onmousedown="applyIngSuggest(${i},'${escHtml(x)}')">${escHtml(x)}</div>`).join('');
  box.classList.remove('hidden');
}
function hideIngSuggest(i) { const b = $('ing-sug-' + i); if (b) b.classList.add('hidden'); }
function applyIngSuggest(i, x) { side().ingredients[i].name = x; paintEditor(); }

// ── 保存 ──
// ingredient_keys 从中文版推导；中文版为空（只填了英文）时退回从英文版推导，
// 靠词表里的英文别名反查 canonical。keys 永远是中文 canonical，匹配逻辑不受语言影响。
function cleanSide(s) {
  return {
    name: s.name.trim(),
    ingredients: s.ingredients.map(i => ({ name: i.name.trim(), amount: (i.amount || '').trim() }))
                              .filter(i => i.name),
    steps: s.steps.split('\n').map(x => x.trim()).filter(Boolean),
  };
}

async function saveDraft(ev) {
  ev.preventDefault();
  const zh = cleanSide(draft.zh), en = cleanSide(draft.en);
  if (!zh.name && !en.name) { alert(t('nameRequired')); return false; }

  const keySource = zh.ingredients.length ? zh.ingredients : en.ingredients;
  const keys = Array.from(new Set(keySource.map(i => toCanonical(i.name, aliasMap)))).filter(Boolean);
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
      name_zh: zh.name || null, name_en: en.name || null,
      ingredients_zh: zh.ingredients, ingredients_en: en.ingredients,
      steps_zh: zh.steps, steps_en: en.steps,
      tags: draft.tags, cover_url: draft.cover_url || null, image_urls: draft.image_urls,
      ingredient_keys: keys,
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
    alert(t('saveFailed', e.message));
    $('save-btn').disabled = false;
  }
  return false;
}

function renderIdea() {
  const chips = ideaHave.map((k, i) =>
    `<span class="chip">${escHtml(k)}<button type="button" onclick="removeHave(${i})">×</button></span>`).join('');

  let body = '';
  if (!ideaHave.length) {
    body = `<div class="empty">${t('ideaEmpty')}</div>`;
  } else {
    const res = matchRecipes(ideaHave, recipes, staples);
    if (!res.length) {
      body = `<div class="empty">${t('ideaNoMatch')}</div>`;
    } else {
      const buckets = new Map();
      for (const it of res) {
        const n = it.missing.length;
        if (!buckets.has(n)) buckets.set(n, []);
        buckets.get(n).push(it);
      }
      for (const n of Array.from(buckets.keys()).sort((a, b) => a - b)) {
        const list = buckets.get(n);
        const title = n === 0 ? t('bucketNow', list.length) : t('bucketBuy', n, list.length);
        body += `<div class="bucket-title ${n === 0 ? 'bucket-0' : 'bucket-n'}">${escHtml(title)}</div>`;
        body += '<ul class="bucket-list">' + list.map(it =>
          `<li>
             <a href="#/r/${it.recipe.id}">${escHtml(pick(it.recipe, 'name'))}</a>
             <span class="miss">${n === 0 ? escHtml(t('allSet')) : '+ ' + it.missing.map(escHtml).join(' + ')}</span>
           </li>`).join('') + '</ul>';
      }
    }
  }

  $('view').innerHTML = `<div class="detail">
    <a class="icon-btn" style="color:var(--muted);padding-left:0" href="#/">${escHtml(t('backToList'))}</a>
    <h1 style="margin:14px 0 18px">${escHtml(t('ideaTitle'))}</h1>
    <div class="chip-input" onclick="document.getElementById('have-input').focus()">
      ${chips}
      <input id="have-input" type="text" placeholder="${escHtml(ideaHave.length ? t('chipPhMore') : t('chipPhFirst'))}"
             autocomplete="off"
             oninput="haveSuggest(this.value)"
             onkeydown="onHaveKey(event, this)">
      <div class="suggest hidden" id="have-suggest"></div>
    </div>
    ${body}
    ${ideaHave.length ? `<div class="detail-actions">
      <button class="btn btn-ghost" id="copy-btn" onclick="copyPrompt()">${escHtml(t('copyBtn'))}</button>
    </div>
    <div class="hint">${escHtml(t('copyHint'))}</div>` : ''}
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
  const items = Array.from(pool).filter(x => !ideaHave.includes(x)).slice(0, 8);
  if (!items.length) { box.classList.add('hidden'); return; }
  box.innerHTML = items.map(x => `<div onmousedown="addHave('${escHtml(x)}')">${escHtml(x)}</div>`).join('');
  box.classList.remove('hidden');
}

// 把食谱库 + 手头食材 + 算法结果拼成一段完整 prompt，让用户粘到 claude.ai 里问。
// 跟随界面语言——中文界面出中文 prompt，英文界面出英文 prompt。
function buildPrompt() {
  const lib = recipes.map(r =>
    `- ${pick(r, 'name')}（${(r.ingredient_keys || []).join('、')}）`).join('\n');
  const libEn = recipes.map(r =>
    `- ${pick(r, 'name')} (${(r.ingredient_keys || []).join(', ')})`).join('\n');
  const res = matchRecipes(ideaHave, recipes, staples);
  const doable = res.filter(x => !x.missing.length).map(x => pick(x.recipe, 'name'));

  if (lang === 'en') {
    const near = res.filter(x => x.missing.length)
      .map(x => `${pick(x.recipe, 'name')} (missing: ${x.missing.join(', ')})`);
    return `Here is our family recipe collection:
${libEn || '(empty so far)'}

I have these ingredients on hand: ${ideaHave.join(', ') || '(none entered)'}
(Assume salt, oil, soy sauce and other pantry staples are always available.)

I have already worked out:
- Can cook right now: ${doable.join(', ') || 'none'}
- Nearly there: ${near.join('; ') || 'none'}

Please suggest some ideas **outside** this collection — what else could I cook with what I have that isn't recorded here? If buying one or two extra things would open up a lot more options, tell me that too.`;
  }

  const near = res.filter(x => x.missing.length)
    .map(x => `${pick(x.recipe, 'name')}（还差：${x.missing.join('、')}）`);
  return `这是我们家的食谱库：
${lib || '（还是空的）'}

我手头有这些食材：${ideaHave.join('、') || '（还没填）'}
（盐、油、酱油这类常备调料默认都有。）

我已经算过了：
- 现在就能做：${doable.join('、') || '无'}
- 差一点的：${near.join('；') || '无'}

请给我一些**库外**的创意建议——用我手头这些食材还能做什么这个库里没记录的菜？如果有值得顺手买的一两样东西能大幅打开选择面，也告诉我。`;
}

async function copyPrompt() {
  try {
    await navigator.clipboard.writeText(buildPrompt());
    const b = $('copy-btn');
    if (b) { const x = b.textContent; b.textContent = t('copied'); setTimeout(() => { b.textContent = x; }, 1800); }
  } catch (e) {
    alert(t('copyFailed') + '\n\n' + buildPrompt());
  }
}

// ── 自动翻译 ──
// 鉴权和数据库请求走同一套令牌：函数拿它去问 /auth/v1/user，验过才干活。
// （Verify JWT 是关的，原因见 supabase/functions/kitchen-ai/index.ts 顶部注释。）
async function callKitchenAI(action, payload) {
  const r = await fetch(FN_URL, {
    method: 'POST',
    headers: await H(),
    body: JSON.stringify({ action, payload }),
  });
  let j = null;
  try { j = await r.json(); } catch (e) { /* 下面按 HTTP 状态处理 */ }
  if (j && j.ok) return j.data;
  const code = (j && j.error) || ('http_' + r.status);
  if (r.status === 401) lockApp();     // 令牌失效，回登录页

  // 友好文案 + 原始详情一起抛。只给友好文案会把「Gemini 404: 模型不存在」
  // 这种唯一有用的信息吞掉，然后只能干瞪眼——2026-08-03 部署时就踩了。
  const known = t('err_' + code);
  const msg = known !== 'err_' + code ? known : code;
  throw new Error(msg + (j && j.detail ? '\n\n' + j.detail : ''));
}

async function translateDraft() {
  const from = draft.tab, to = from === 'zh' ? 'en' : 'zh';
  const s = cleanSide(draft[from]);
  if (!s.name && !s.ingredients.length && !s.steps.length) { alert(t('translateEmpty')); return; }

  const btn = $('tr-btn');
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = t('translating');
  setSync('busy');
  try {
    const out = await callKitchenAI('translate', {
      from, to, recipe: { name: s.name, ingredients: s.ingredients, steps: s.steps, tags: draft.tags },
    });
    draft[to] = {
      name: out.name || '',
      ingredients: (out.ingredients || []).length ? out.ingredients : [{ name: '', amount: '' }],
      steps: (out.steps || []).join('\n'),
    };
    // 顺手补上标签翻译，下次筛选栏就有英文了
    const pairs = Object.entries(out.tags || {})
      .filter(([zh, en]) => zh && en && !tagI18n.some(x => x.zh === zh))
      .map(([zh, en]) => ({ zh, en }));
    if (pairs.length) {
      try { tagI18n = tagI18n.concat(await tagI18nInsert(pairs)); } catch (e) { console.warn('标签翻译写入失败（已忽略）', e); }
    }
    setSync('ok');
    draft.tab = to;          // 翻完直接跳到结果页签，方便立刻校对
    paintEditor();
  } catch (e) {
    setSync('err');
    alert(t('translateFailed', e.message));
    btn.disabled = false; btn.textContent = label;
  }
}

let lastSig = '';
async function poll() {
  if (document.visibilityState !== 'visible') return;
  if (!loaded) return;
  // 编辑页正在填表，重渲染会把用户输入冲掉——跳过这一轮
  if (currentRoute().view === 'editor') return;
  try {
    await loadAll();
    const sig = dataSig();
    if (sig !== lastSig) { lastSig = sig; render(); }
    setSync('ok');
  } catch (e) {
    setSync('err');
  }
}
setInterval(poll, 15000);

// ── 启动 ──
// 必须放在文件最末：上面用 let 声明的 vocab / recipes / loaded 在求值到那一行之前
// 处于暂时性死区，提前调用 initApp() 会在 `if (loaded)` 上抛 ReferenceError。
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
paintChrome();
// 本地存着令牌就续一次，续得上才直接进 app；续不上就老实显示登录页。
(async () => {
  if (await resumeSession()) {
    enterApp();
  } else {
    $('lock-input').focus();
  }
})();
