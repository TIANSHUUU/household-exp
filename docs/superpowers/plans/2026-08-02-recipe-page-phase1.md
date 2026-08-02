# 家庭食谱页 一期 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fourth page, `recipe.html`, where the user and their partner can record family recipes (name, tags, cover photo, extra photos, ingredients, steps), search recipes by ingredient, and get "what can I cook with what's in my fridge" bucketed suggestions — all computed client-side with no LLM involved.

**Architecture:** `recipe.html` + `assets/recipe.css` + `assets/recipe.js` in the same repo as the existing three pages. Same Supabase project, same password gate (`PWD_HASH` / `SESSION_KEY` reused so unlocking any page unlocks all four in the same tab), same raw PostgREST calls with no SDK. Two new tables (`ingredient_vocab`, `recipes`) plus a public Storage bucket for photos. Visually it is a deliberate break from the other three pages — it ports the cream/navy/terracotta editorial design language from `~/Documents/code/gourmet` into hand-written CSS. Hash-based routing gives four views (list / detail / editor / idea) inside one static file.

**Tech Stack:** Vanilla HTML/CSS/JS, Supabase (Postgres + PostgREST + Storage), Google Fonts CDN, no build step, no package manager.

**Note on verification:** This project has no test framework, package manager, or CI (no `package.json`, no test files, no CI config). The existing three pages were built and verified by hand. This plan follows that precedent with one addition: the four pure-logic functions (`buildAliasMap`, `toCanonical`, `matchRecipes`, `searchRecipes`) are the part where bugs are silent and expensive, so they live between marker comments in `assets/recipe.js` and are verified by real assertions run through `node -e`. Everything else is verified by `curl` against the REST API and precise manual browser steps.

**Design doc:** `docs/superpowers/specs/2026-08-02-recipe-page-design.md`

**Shared constants (used throughout):**

| | |
|---|---|
| Supabase REST | `https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1` |
| Supabase Storage | `https://mpvsbeghuueffkjdemcr.supabase.co/storage/v1` |
| anon key | `sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5` |
| `PWD_HASH` | `9c2e571eb60385be3ced6e5d4bd7d34837f5219d693e679cd324d5e12b83c4eb` |
| `SESSION_KEY` | `hh_auth` |
| Storage bucket | `recipe-images` |

---

## Task 1: Create the two tables and seed the staple ingredients

**Files:** none (Supabase dashboard action)

- [ ] **Step 1: Run the table-creation SQL**

Open `https://supabase.com/dashboard/project/mpvsbeghuueffkjdemcr/sql/new` and run:

```sql
create table ingredient_vocab (
  id         bigint generated always as identity primary key,
  canonical  text not null unique,
  aliases    text[] not null default '{}',
  staple     boolean not null default false,
  created_at timestamptz default now()
);
alter table ingredient_vocab enable row level security;
create policy "all ingredient_vocab" on ingredient_vocab for all using (true) with check (true);

create table recipes (
  id              bigint generated always as identity primary key,
  name            text not null,
  tags            text[] not null default '{}',
  cover_url       text,
  image_urls      text[] not null default '{}',
  ingredients     jsonb  not null default '[]',
  ingredient_keys text[] not null default '{}',
  steps           text[] not null default '{}',
  created_at      timestamptz default now()
);
create index recipes_ingredient_keys_idx on recipes using gin (ingredient_keys);
alter table recipes enable row level security;
create policy "all recipes" on recipes for all using (true) with check (true);
```

- [ ] **Step 2: Seed the staple ingredients**

This seed is what makes the fridge-matching feature usable. Without it every recipe reports "再买 5 样" because salt and oil are in everything. Run in the same SQL editor:

```sql
insert into ingredient_vocab (canonical, aliases, staple) values
  ('盐',       array['食盐'],                     true),
  ('糖',       array['白糖','砂糖','细砂糖'],      true),
  ('生抽',     array['酱油'],                     true),
  ('老抽',     array[]::text[],                   true),
  ('蚝油',     array['oyster sauce'],             true),
  ('食用油',   array['菜籽油','植物油','油'],      true),
  ('橄榄油',   array['olive oil'],                true),
  ('香醋',     array['醋','陈醋'],                true),
  ('料酒',     array['黄酒','绍兴酒'],            true),
  ('白胡椒粉', array['白胡椒'],                   true),
  ('黑胡椒',   array['黑胡椒粉','black pepper'],  true),
  ('蒜',       array['大蒜','蒜瓣','garlic'],     true),
  ('姜',       array['生姜','ginger'],            true),
  ('葱',       array['小葱','大葱','香葱'],        true),
  ('淀粉',     array['玉米淀粉','生粉','土豆淀粉'], true),
  ('芝麻油',   array['香油','麻油'],              true),
  ('黄油',     array['butter'],                   true),
  ('面粉',     array['中筋面粉','plain flour'],   true);
```

- [ ] **Step 3: Verify both tables are reachable over REST**

Run:

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/recipes?select=*" -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" -H "Authorization: Bearer sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5"
```

Expected: `[]`

Run:

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/ingredient_vocab?select=canonical,staple&staple=eq.true" -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" -H "Authorization: Bearer sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5"
```

Expected: a JSON array of 18 objects, each `{"canonical":"...","staple":true}`.

- [ ] **Step 4: Commit** — nothing to commit (Supabase-only task). Skip.

---

## Task 2: Create the `recipe-images` Storage bucket

**Files:** none (Supabase dashboard action)

- [ ] **Step 1: Create the bucket and its policies**

In the same SQL editor, run:

```sql
insert into storage.buckets (id, name, public) values ('recipe-images', 'recipe-images', true);

create policy "recipe images read"
  on storage.objects for select using (bucket_id = 'recipe-images');
create policy "recipe images insert"
  on storage.objects for insert with check (bucket_id = 'recipe-images');
create policy "recipe images delete"
  on storage.objects for delete using (bucket_id = 'recipe-images');
```

- [ ] **Step 2: Verify upload and public read work with the anon key**

Run (uploads a 3-byte text file, reads it back over the public URL, then deletes it):

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
B=https://mpvsbeghuueffkjdemcr.supabase.co/storage/v1
printf 'abc' > /tmp/probe.txt
curl -s -X POST "$B/object/recipe-images/probe/probe.txt" -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: text/plain" --data-binary @/tmp/probe.txt
echo
curl -s "$B/object/public/recipe-images/probe/probe.txt"
echo
curl -s -X DELETE "$B/object/recipe-images/probe/probe.txt" -H "apikey: $K" -H "Authorization: Bearer $K"
```

Expected output, in order:
1. `{"Key":"recipe-images/probe/probe.txt","Id":"..."}`
2. `abc`
3. `{"message":"Successfully deleted"}`

If step 1 returns `{"statusCode":"403",...}` the insert policy did not apply — re-check the `create policy` statements ran without error.

- [ ] **Step 3: Commit** — nothing to commit (Supabase-only task). Skip.

---

## Task 3: Pure logic — ingredient normalization

**Files:**
- Create: `assets/recipe.js`

- [ ] **Step 1: Create `assets/recipe.js` with the config block and the first three pure functions**

Create `assets/recipe.js`:

```js
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
// ── PURE LOGIC END ──
```

- [ ] **Step 2: Write the verification script**

Create `/tmp/verify-pure.js`:

```js
const fs = require('fs');
const src = fs.readFileSync('assets/recipe.js', 'utf8');
const pure = src.split('// ── PURE LOGIC START ──')[1].split('// ── PURE LOGIC END ──')[0];
eval(pure);

const assert = require('assert');
const vocab = [
  { canonical: '番茄', aliases: ['西红柿', 'tomato'], staple: false },
  { canonical: '盐',   aliases: ['食盐'],             staple: true  },
];
const m = buildAliasMap(vocab);

assert.strictEqual(toCanonical('番茄', m),   '番茄', 'canonical 自身应命中');
assert.strictEqual(toCanonical('西红柿', m), '番茄', '中文别名应映射到 canonical');
assert.strictEqual(toCanonical('Tomato', m), '番茄', '别名匹配应大小写不敏感');
assert.strictEqual(toCanonical(' 番茄 ', m), '番茄', '应忽略首尾空格');
assert.strictEqual(toCanonical('牛肉', m),   '牛肉', '词表没有的词应原样返回');
assert.strictEqual(toCanonical('', m),       '',     '空字符串应返回空');
assert.strictEqual(toCanonical(null, m),     '',     'null 应返回空而不是抛错');

const st = stapleSet(vocab);
assert.strictEqual(st.has('盐'), true,   '盐应在 staple 集合里');
assert.strictEqual(st.has('番茄'), false, '番茄不应在 staple 集合里');

console.log('✅ normalization OK');
```

- [ ] **Step 3: Run it to verify it fails first**

The file currently has the functions, so instead verify the harness catches a real break. Temporarily change `normKey` in `assets/recipe.js` to drop the `.toLowerCase()`, then run:

```bash
node /tmp/verify-pure.js
```

Expected: `AssertionError [ERR_ASSERTION]: 别名匹配应大小写不敏感`

Restore `.toLowerCase()`.

- [ ] **Step 4: Run it to verify it passes**

```bash
node /tmp/verify-pure.js
```

Expected: `✅ normalization OK`

- [ ] **Step 5: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe page ingredient normalization

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Pure logic — fridge matching

**Files:**
- Modify: `assets/recipe.js` (append inside the PURE LOGIC block, before `// ── PURE LOGIC END ──`)

- [ ] **Step 1: Add the failing assertions first**

Append to `/tmp/verify-pure.js`:

```js
const staples = stapleSet([
  { canonical: '盐', aliases: [], staple: true },
]);
const recipes = [
  { id: 1, name: '番茄炒蛋',   ingredient_keys: ['番茄', '鸡蛋', '盐'] },
  { id: 2, name: '番茄牛腩',   ingredient_keys: ['番茄', '牛腩', '土豆', '盐'] },
  { id: 3, name: '牛肉三明治', ingredient_keys: ['牛肉', '面包', '生菜'] },
  { id: 4, name: '佛跳墙',     ingredient_keys: ['鲍鱼', '海参', '花胶', '瑶柱', '火腿'] },
];

const res = matchRecipes(['番茄', '鸡蛋', '牛腩'], recipes, staples);

assert.strictEqual(res.length, 3, '缺 5 样的佛跳墙应被 maxMissing 剔除');
assert.strictEqual(res[0].recipe.id, 1, '零缺口的应排最前');
assert.deepStrictEqual(res[0].missing, [], '盐是 staple，不应算进 missing');
assert.strictEqual(res[1].recipe.id, 2);
assert.deepStrictEqual(res[1].missing, ['土豆']);
assert.strictEqual(res[2].recipe.id, 3);
assert.strictEqual(res[2].missing.length, 3);

// 同桶内食材少的排前面
const tie = matchRecipes([], [
  { id: 10, name: '多料', ingredient_keys: ['a', 'b', 'c'] },
  { id: 11, name: '少料', ingredient_keys: ['d'] },
], new Set(), 3);
assert.strictEqual(tie[0].recipe.id, 11, '同桶内 need 少的应排前');

console.log('✅ matching OK');
```

- [ ] **Step 2: Run to verify it fails**

```bash
node /tmp/verify-pure.js
```

Expected: `ReferenceError: matchRecipes is not defined`

- [ ] **Step 3: Implement `matchRecipes`**

In `assets/recipe.js`, insert immediately before `// ── PURE LOGIC END ──`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

```bash
node /tmp/verify-pure.js
```

Expected: `✅ normalization OK` then `✅ matching OK`

- [ ] **Step 5: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe fridge-matching algorithm

Staples are excluded from the missing-ingredient count so common
seasonings don't make every recipe look out of reach.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Pure logic — search

**Files:**
- Modify: `assets/recipe.js` (append inside the PURE LOGIC block)

- [ ] **Step 1: Add the failing assertions first**

Append to `/tmp/verify-pure.js`:

```js
const sm = buildAliasMap([
  { canonical: '番茄', aliases: ['西红柿', 'tomato'], staple: false },
]);

const s1 = searchRecipes('西红柿', recipes, sm);
assert.strictEqual(s1.byName.length, 0, '没有菜名叫西红柿');
assert.deepStrictEqual(s1.byIngredient.map(r => r.id), [1, 2], '别名应经 canonical 命中食材');

const s2 = searchRecipes('番茄', recipes, sm);
assert.deepStrictEqual(s2.byName.map(r => r.id), [1, 2], '菜名命中优先');
assert.strictEqual(s2.byIngredient.length, 0, '同一道菜不应两组都出现');

const s3 = searchRecipes('牛', recipes, sm);
assert.deepStrictEqual(s3.byName.map(r => r.id), [2, 3], '子串应匹配菜名');

const s4 = searchRecipes('   ', recipes, sm);
assert.deepStrictEqual(s4, { byName: [], byIngredient: [] }, '空查询应返回两个空数组');

console.log('✅ search OK');
```

- [ ] **Step 2: Run to verify it fails**

```bash
node /tmp/verify-pure.js
```

Expected: `ReferenceError: searchRecipes is not defined`

- [ ] **Step 3: Implement `searchRecipes`**

In `assets/recipe.js`, insert immediately before `// ── PURE LOGIC END ──`:

```js
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
```

- [ ] **Step 4: Run to verify it passes**

```bash
node /tmp/verify-pure.js
```

Expected: all three `✅` lines.

- [ ] **Step 5: Save the verification script into the repo**

The `/tmp` copy will be lost. Move it so it survives:

```bash
mkdir -p scripts
cp /tmp/verify-pure.js scripts/verify-recipe-logic.js
node scripts/verify-recipe-logic.js
```

Expected: all three `✅` lines (it reads `assets/recipe.js` by relative path, so run it from the repo root).

- [ ] **Step 6: Commit**

```bash
git add assets/recipe.js scripts/verify-recipe-logic.js
git commit -m "$(cat <<'EOF'
Add recipe search and pure-logic verification script

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: The stylesheet

**Files:**
- Create: `assets/recipe.css`

This is the whole stylesheet for all four views, written once. Later tasks add HTML and JS only.

- [ ] **Step 1: Create `assets/recipe.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

:root {
  --bg: #FCFAF4;
  --ink: #13314A;
  --terracotta: #F0742A;
  --blue: #0F84B5;
  --blue-deep: #0C6E97;
  --muted: #8A99A6;
  --line: #E6E0D4;
  --card: #FFFFFF;
  --shadow: 0 1px 3px rgba(19,49,74,0.06), 0 8px 24px rgba(19,49,74,0.05);
}

body {
  background: var(--bg);
  color: var(--ink);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

.font-display { font-family: 'Fraunces', 'Noto Serif SC', Georgia, serif; }
.font-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

/* ── 带噪点的渐变 header（移植自 gourmet） ── */
.header-gradient {
  background-image:
    url("data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='150' height='150' filter='url(%23n)' opacity='0.92'/></svg>"),
    linear-gradient(125deg, #F0742A 0%, #E06C54 24%, #BE8893 46%, #8B8090 66%, #3C6FB0 85%, #0F84B5 100%);
  background-size: 150px 150px, cover;
  background-repeat: repeat, no-repeat;
  background-attachment: scroll, fixed;
  background-blend-mode: overlay, normal;
}

/* ── 密码门 ── */
#lock-screen {
  position: fixed; inset: 0; background: var(--bg); z-index: 9999;
  display: flex; align-items: center; justify-content: center; padding: 24px;
}
#lock-screen.hidden { display: none; }
.lock-card {
  background: var(--card); border-radius: 4px; padding: 40px 28px 28px;
  width: 100%; max-width: 340px; box-shadow: var(--shadow); text-align: center;
  border: 1px solid var(--line);
}
.lock-icon  { font-size: 44px; margin-bottom: 16px; }
.lock-title { font-size: 22px; font-weight: 700; margin-bottom: 6px; }
.lock-sub   { font-size: 13px; color: var(--muted); margin-bottom: 26px; }
.lock-input {
  width: 100%; padding: 13px 16px; border: 1.5px solid var(--line);
  border-radius: 3px; font-size: 17px; font-family: inherit;
  background: var(--bg); color: var(--ink); text-align: center;
  letter-spacing: 3px; outline: none; transition: border-color 0.2s; margin-bottom: 12px;
}
.lock-input:focus { border-color: var(--terracotta); }
.lock-input.error { border-color: #C0392B; animation: shake 0.35s ease; }
@keyframes shake {
  0%,100%{transform:translateX(0)} 20%{transform:translateX(-8px)}
  40%{transform:translateX(8px)}   60%{transform:translateX(-5px)}
  80%{transform:translateX(5px)}
}
.lock-error { font-size: 13px; color: #C0392B; margin-bottom: 10px; min-height: 18px; }
.lock-btn {
  width: 100%; padding: 13px; background: var(--terracotta); color: #fff;
  border: none; border-radius: 3px; font-size: 15px; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: opacity 0.15s;
}
.lock-btn:active { opacity: 0.8; }

#app { display: none; padding-bottom: 80px; }
#app.visible { display: block; }

/* ── 顶栏 ── */
.topbar { position: sticky; top: 0; z-index: 100; border-bottom: 3px solid var(--blue); }
.topbar-inner {
  max-width: 1100px; margin: 0 auto; padding: 0 20px;
  height: 60px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.topbar h1 {
  font-family: 'Fraunces', 'Noto Serif SC', Georgia, serif;
  font-size: 20px; font-weight: 700; color: #fff; white-space: nowrap;
  cursor: pointer;
}
.topbar-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.icon-btn {
  background: none; border: none; cursor: pointer; color: rgba(255,255,255,0.85);
  font-size: 13px; font-weight: 500; padding: 6px 9px; border-radius: 3px;
  transition: background 0.15s, color 0.15s; text-decoration: none; display: inline-block;
  font-family: inherit;
}
.icon-btn:hover { background: rgba(255,255,255,0.16); color: #fff; }
.sync-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  margin-left: 8px; vertical-align: middle; transition: background 0.3s;
}
.sync-dot.ok   { background: #7BD389; }
.sync-dot.busy { background: #FFD166; animation: pulse 1s infinite; }
.sync-dot.err  { background: #E76F51; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
@media (max-width: 520px) {
  .topbar h1 { font-size: 17px; }
  .icon-btn { padding: 5px 5px; font-size: 12px; }
}

.wrap { max-width: 1100px; margin: 0 auto; padding: 28px 20px 0; }

/* ── 加载 / 空状态 ── */
.loading-wrap {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 80px 20px; color: var(--muted); gap: 14px;
}
.spinner {
  width: 26px; height: 26px; border: 3px solid var(--line);
  border-top-color: var(--terracotta); border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.empty {
  text-align: center; padding: 70px 20px; color: var(--muted); font-size: 15px; line-height: 1.8;
}

/* ── 搜索 + 筛选 ── */
.toolbar { display: flex; gap: 10px; align-items: center; margin-bottom: 18px; flex-wrap: wrap; }
.search-box { position: relative; flex: 1 1 260px; min-width: 200px; }
.search-box input {
  width: 100%; padding: 11px 14px; border: 1.5px solid var(--line); border-radius: 3px;
  font-size: 15px; font-family: inherit; background: var(--card); color: var(--ink); outline: none;
  transition: border-color 0.2s;
}
.search-box input:focus { border-color: var(--terracotta); }
.suggest {
  position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
  background: var(--card); border: 1px solid var(--line); border-radius: 3px;
  box-shadow: var(--shadow); max-height: 240px; overflow-y: auto;
}
.suggest.hidden { display: none; }
.suggest div { padding: 9px 14px; cursor: pointer; font-size: 14px; }
.suggest div:hover, .suggest div.active { background: #F5EFE3; }

.btn {
  padding: 11px 16px; border: 1.5px solid var(--ink); background: var(--ink); color: #fff;
  border-radius: 3px; font-size: 14px; font-weight: 600; font-family: inherit;
  cursor: pointer; white-space: nowrap; text-decoration: none; display: inline-block;
  transition: opacity 0.15s;
}
.btn:active { opacity: 0.82; }
.btn-ghost { background: transparent; color: var(--ink); }
.btn-ghost:hover { background: rgba(19,49,74,0.06); }
.btn-accent { background: var(--terracotta); border-color: var(--terracotta); }
.btn-danger { background: transparent; color: #C0392B; border-color: #C0392B; }
.btn-sm { padding: 6px 11px; font-size: 12px; }

.tagbar { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 26px; }
.tag-chip {
  padding: 5px 12px; border: 1px solid var(--line); border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; letter-spacing: 0.08em; cursor: pointer; background: transparent;
  color: var(--muted); transition: all 0.15s;
}
.tag-chip:hover { border-color: var(--muted); color: var(--ink); }
.tag-chip.on { background: var(--ink); border-color: var(--ink); color: #fff; }

/* ── 卡片网格 ── */
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 34px 26px; }
.group-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.14em; font-size: 11px;
  color: var(--muted); margin: 30px 0 14px;
}
.group-title:first-child { margin-top: 0; }

.card { cursor: pointer; display: block; text-decoration: none; color: inherit; }
.card-img {
  position: relative; aspect-ratio: 16 / 10; overflow: hidden;
  background: #EFE9DC; margin-bottom: 12px;
}
.card-img img { width: 100%; height: 100%; object-fit: cover; transition: transform 0.5s ease; }
.card:hover .card-img img { transform: scale(1.05); }
.card-img .noimg {
  position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-size: 34px; opacity: 0.35;
}
.card-meta { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
.card-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; font-weight: 700; color: var(--terracotta);
}
.card-tags {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--blue-deep);
}
.card h2 {
  font-family: 'Fraunces', 'Noto Serif SC', Georgia, serif;
  font-size: 20px; font-weight: 600; line-height: 1.25; transition: color 0.2s;
}
.card:hover h2 { color: var(--terracotta); }

/* ── 详情页 ── */
.detail { max-width: 720px; margin: 0 auto; }
.detail-cover {
  aspect-ratio: 16 / 10; overflow: hidden; background: #EFE9DC; margin-bottom: 22px;
}
.detail-cover img { width: 100%; height: 100%; object-fit: cover; }
.detail h1 {
  font-family: 'Fraunces', 'Noto Serif SC', Georgia, serif;
  font-size: 34px; font-weight: 700; line-height: 1.15; margin-bottom: 8px;
}
.detail-tags {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em;
  color: var(--blue-deep); margin-bottom: 28px;
}
.section-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.14em; font-size: 11px;
  color: var(--terracotta); margin: 32px 0 12px;
  padding-bottom: 7px; border-bottom: 1px solid var(--line);
}
.ing-list { list-style: none; }
.ing-list li {
  display: flex; justify-content: space-between; gap: 16px;
  padding: 9px 0; border-bottom: 1px dashed var(--line); font-size: 15px;
}
.ing-list li .amt { color: var(--muted); font-size: 14px; white-space: nowrap; }
.step-list { list-style: none; counter-reset: step; }
.step-list li {
  counter-increment: step; position: relative; padding: 0 0 16px 38px;
  font-size: 15px; line-height: 1.75;
}
.step-list li::before {
  content: counter(step); position: absolute; left: 0; top: 1px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px; font-weight: 700; color: #fff; background: var(--blue);
  width: 24px; height: 24px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.thumbs { display: flex; gap: 10px; flex-wrap: wrap; }
.thumbs img {
  width: 108px; height: 108px; object-fit: cover; cursor: zoom-in;
  transition: opacity 0.15s; background: #EFE9DC;
}
.thumbs img:hover { opacity: 0.82; }
.detail-actions { display: flex; gap: 10px; margin: 40px 0 20px; }

/* ── 灯箱 ── */
.lightbox {
  position: fixed; inset: 0; z-index: 9998; background: rgba(19,49,74,0.94);
  display: flex; align-items: center; justify-content: center; padding: 30px; cursor: zoom-out;
}
.lightbox.hidden { display: none; }
.lightbox img { max-width: 100%; max-height: 100%; object-fit: contain; }

/* ── 表单 ── */
.form { max-width: 720px; margin: 0 auto; }
.field { margin-bottom: 22px; }
.field label {
  display: block; font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 11px;
  color: var(--muted); margin-bottom: 7px;
}
.field input[type=text], .field textarea {
  width: 100%; padding: 11px 13px; border: 1.5px solid var(--line); border-radius: 3px;
  font-size: 15px; font-family: inherit; background: var(--card); color: var(--ink);
  outline: none; transition: border-color 0.2s; line-height: 1.7;
}
.field input[type=text]:focus, .field textarea:focus { border-color: var(--terracotta); }
.field textarea { resize: vertical; min-height: 140px; }
.hint { font-size: 12px; color: var(--muted); margin-top: 6px; line-height: 1.6; }

.ing-row { display: flex; gap: 8px; margin-bottom: 8px; align-items: flex-start; }
.ing-row .ing-name { flex: 1 1 auto; position: relative; }
.ing-row .ing-amt  { flex: 0 0 110px; }
.ing-row .rm {
  flex: 0 0 auto; background: none; border: none; color: var(--muted);
  cursor: pointer; font-size: 19px; line-height: 1; padding: 10px 6px;
}
.ing-row .rm:hover { color: #C0392B; }
.ing-row .new-flag {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9px; letter-spacing: 0.1em; color: var(--terracotta);
  position: absolute; right: 10px; top: 13px; pointer-events: none;
}

.imgs-row { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-start; }
.img-thumb { position: relative; width: 108px; height: 108px; background: #EFE9DC; }
.img-thumb img { width: 100%; height: 100%; object-fit: cover; }
.img-thumb button {
  position: absolute; top: 3px; right: 3px; width: 22px; height: 22px;
  border: none; border-radius: 50%; background: rgba(19,49,74,0.8); color: #fff;
  cursor: pointer; font-size: 13px; line-height: 1;
}
.form-actions { display: flex; gap: 10px; margin: 34px 0 20px; }

/* ── 灵感页 ── */
.chip-input {
  display: flex; flex-wrap: wrap; gap: 7px; align-items: center;
  padding: 9px 11px; border: 1.5px solid var(--line); border-radius: 3px;
  background: var(--card); position: relative;
}
.chip-input:focus-within { border-color: var(--terracotta); }
.chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 10px; background: var(--ink); color: #fff; border-radius: 999px; font-size: 13px;
}
.chip button { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 14px; line-height: 1; padding: 0; }
.chip button:hover { color: #fff; }
.chip-input input {
  flex: 1 1 120px; border: none; outline: none; background: transparent;
  font-size: 15px; font-family: inherit; color: var(--ink); padding: 4px 0;
}
.bucket-title {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  text-transform: uppercase; letter-spacing: 0.13em; font-size: 11px;
  margin: 30px 0 12px; padding-bottom: 7px; border-bottom: 1px solid var(--line);
}
.bucket-0 { color: #2E8B57; }
.bucket-n { color: var(--terracotta); }
.bucket-list { list-style: none; }
.bucket-list li {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 11px 0; border-bottom: 1px dashed var(--line);
}
.bucket-list a {
  font-family: 'Fraunces', 'Noto Serif SC', Georgia, serif;
  font-size: 17px; font-weight: 600; color: var(--ink); text-decoration: none;
}
.bucket-list a:hover { color: var(--terracotta); }
.bucket-list .miss { font-size: 13px; color: var(--muted); text-align: right; }
```

- [ ] **Step 2: Verify the file parses as CSS**

There is no CSS linter in this repo. Check brace balance instead:

```bash
node -e 'const s=require("fs").readFileSync("assets/recipe.css","utf8");const o=(s.match(/{/g)||[]).length,c=(s.match(/}/g)||[]).length;console.log("{",o,"}",c);if(o!==c)process.exit(1);console.log("✅ braces balanced")'
```

Expected: `{ N } N` then `✅ braces balanced`

- [ ] **Step 3: Commit**

```bash
git add assets/recipe.css
git commit -m "$(cat <<'EOF'
Add recipe page stylesheet

Ports the gourmet guide's cream/navy/terracotta editorial look —
Fraunces display type, mono labels, noise-textured gradient header.
Light mode only by design.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: The page shell — password gate, topbar, hash router

**Files:**
- Create: `recipe.html`
- Modify: `assets/recipe.js` (append after the PURE LOGIC block)

- [ ] **Step 1: Create `recipe.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>家庭食谱</title>
  <link rel="preconnect" href="https://mpvsbeghuueffkjdemcr.supabase.co">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@500;700&family=Noto+Serif+SC:wght@600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/recipe.css">
</head>
<body>

<div id="lock-screen">
  <div class="lock-card">
    <div class="lock-icon">🍳</div>
    <div class="lock-title">家庭食谱</div>
    <div class="lock-sub">请输入密码以继续</div>
    <input type="password" class="lock-input" id="lock-input"
           placeholder="••••••••" autocomplete="current-password"
           onkeydown="if(event.key==='Enter')unlock()">
    <div class="lock-error" id="lock-error"></div>
    <button class="lock-btn" onclick="unlock()">进入</button>
  </div>
</div>

<div id="app">
  <header class="topbar header-gradient">
    <div class="topbar-inner">
      <h1 onclick="location.hash='#/'">家庭食谱<span class="sync-dot ok" id="sync-dot"></span></h1>
      <div class="topbar-actions">
        <a class="icon-btn" href="index.html">💰 开支</a>
        <a class="icon-btn" href="shopping.html">🛒 购物</a>
        <a class="icon-btn" href="activity.html">📅 日程</a>
        <button class="icon-btn" onclick="lockApp()">锁定</button>
      </div>
    </div>
  </header>
  <main class="wrap" id="view"></main>
</div>

<div id="lightbox" class="lightbox hidden" onclick="closeLightbox()">
  <img id="lightbox-img" alt="">
</div>

<script src="assets/recipe.js"></script>
</body>
</html>
```

- [ ] **Step 2: Append the auth + router + lightbox block to `assets/recipe.js`**

Append at the end of the file (after `// ── PURE LOGIC END ──`):

```js
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
```

- [ ] **Step 3: Add temporary placeholder renderers and the startup trigger**

Append to `assets/recipe.js` (the renderers get replaced in Tasks 8–14):

```js
// ── 视图（后续任务逐个替换） ──
function renderList()   { $('view').innerHTML = '<div class="empty">列表页占位</div>'; }
function renderDetail() { $('view').innerHTML = '<div class="empty">详情页占位</div>'; }
function renderEditor() { $('view').innerHTML = '<div class="empty">编辑页占位</div>'; }
function renderIdea()   { $('view').innerHTML = '<div class="empty">灵感页占位</div>'; }
function initApp()      { render(); }

// ── 启动 ──
// 必须放在文件最末：Task 8 会在上面用 let 声明 vocab / recipes / loaded，
// 在求值到那些行之前它们处于暂时性死区，提前调用 initApp() 会在
// `if (loaded)` 上抛 ReferenceError —— 页面看起来正常但内容区永远空白。
if (sessionStorage.getItem(SESSION_KEY) === '1') {
  enterApp();
} else {
  $('lock-input').focus();
}
```

> ⚠️ The startup block must stay the **last** thing in the file for the rest of this plan. Later tasks insert code *above* it, never below.

- [ ] **Step 4: Verify in the browser**

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/recipe.html`. Verify:
1. The lock card shows 🍳 家庭食谱 on a cream background.
2. A wrong password shakes the input and shows 密码错误，请重试.
3. The correct password reveals the page: a gradient header bar with 家庭食谱 in serif, four nav buttons, and `列表页占位` below.
4. Manually setting `location.hash = '#/idea'` in the console swaps the text to `灵感页占位`.
5. `锁定` returns to the lock screen.
6. Open `http://localhost:8765/shopping.html`, unlock it, then navigate to `recipe.html` — it should skip the lock screen (shared `SESSION_KEY`).

Stop the server with Ctrl-C.

- [ ] **Step 5: Commit**

```bash
git add recipe.html assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe page shell with password gate and hash router

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Data layer and initial load

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Add the DB layer and in-memory state**

In `assets/recipe.js`, insert immediately **before** the `// ── 视图（后续任务逐个替换） ──` block:

```js
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
```

- [ ] **Step 2: Replace `initApp` with the real one**

Replace the placeholder `function initApp() { render(); }` with:

```js
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
```

- [ ] **Step 3: Verify the load path**

Serve and open `recipe.html`, unlock, then in the DevTools console run:

```js
console.log(vocab.length, recipes.length, staples.has('盐'), toCanonical('西红柿', aliasMap));
```

Expected: `18 0 true 西红柿`

(`西红柿` maps to itself here because 番茄 is not in the seed — only staples are. That is correct: it becomes a new vocab entry the first time a recipe uses it.)

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe data layer and initial load

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: List view

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Replace the `renderList` placeholder**

Replace `function renderList() { ... }` with:

```js
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
```

- [ ] **Step 2: Insert two recipes over REST so there is something to look at**

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
curl -s -X POST "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/recipes" \
  -H "apikey: $K" -H "Authorization: Bearer $K" -H "Content-Type: application/json" \
  -H "Prefer: return=minimal" -d '[
  {"name":"番茄炒蛋","tags":["中餐","主菜"],
   "ingredients":[{"name":"番茄","amount":"2个"},{"name":"鸡蛋","amount":"3个"},{"name":"盐","amount":"少许"}],
   "ingredient_keys":["番茄","鸡蛋","盐"],
   "steps":["鸡蛋打散加少许盐","番茄切块","热油炒蛋盛出","炒番茄出汁后回锅合炒"]},
  {"name":"牛肉三明治","tags":["西餐","早餐"],
   "ingredients":[{"name":"牛肉","amount":"150g"},{"name":"面包","amount":"2片"},{"name":"生菜","amount":"2片"}],
   "ingredient_keys":["牛肉","面包","生菜"],
   "steps":["牛肉煎至五分熟","面包烤香","夹入生菜和牛肉"]}]'
```

Expected: empty output (HTTP 201 with `return=minimal`).

- [ ] **Step 3: Verify in the browser**

Serve, unlock, reload `recipe.html`. Verify:
1. Two cards appear in a grid, numbered `№ 01` and `№ 02`, with `🍽` placeholders (no photos yet) and tags in small caps.
2. The tag bar shows 全部 / 中餐 / 主菜 / 早餐 / 西餐. Clicking 西餐 leaves only 牛肉三明治.
3. Typing `番` in the search box shows a suggestion dropdown and filters to 番茄炒蛋 under 菜名含此词.
4. Typing `牛肉` puts 牛肉三明治 under 菜名含此词 and nothing under 食材含此词 (name match wins).
5. Typing `生菜` puts 牛肉三明治 under 食材含此词.
6. Hovering a card scales its image placeholder area and turns the title terracotta.

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe list view with tag filter and ingredient search

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Detail view and lightbox

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Replace the `renderDetail` placeholder**

```js
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
```

- [ ] **Step 2: Add a temporary `askDelete` stub (real one lands in Task 13)**

Append:

```js
function askDelete(id) { alert('删除功能在 Task 13 实现'); }
```

- [ ] **Step 3: Verify in the browser**

Reload, click 番茄炒蛋. Verify:
1. Serif title, `中餐 · 主菜` in small caps beneath it.
2. 食材 section lists three rows with the amount right-aligned in grey.
3. 步骤 section shows four numbered blue circles.
4. No 成品图 section (no photos yet).
5. `← 回到列表` returns to the grid; the browser back button also works.
6. Clicking 删除 shows the placeholder alert.

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe detail view with photo lightbox

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Image upload helper

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Add the shrink + upload + delete helpers**

Insert after the `// ── DB 层 ──` functions:

```js
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
```

- [ ] **Step 2: Verify upload works from the page**

Serve, unlock `recipe.html`, then in the DevTools console run:

```js
const inp = document.createElement('input');
inp.type = 'file'; inp.accept = 'image/*';
inp.onchange = async () => {
  const url = await uploadImage('probe', inp.files[0]);
  console.log('uploaded:', url);
  window.open(url);
};
inp.click();
```

Pick any photo. Expected: the console logs a `.../object/public/recipe-images/recipes/probe/....jpg` URL and a new tab shows the image, with its long edge at most 1600px (check via right-click → 显示简介 / Inspect).

Then clean it up:

```js
await deleteImage('<paste the URL here>');
```

- [ ] **Step 3: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add client-side image shrink and Supabase Storage upload

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Editor view

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Replace the `renderEditor` placeholder**

```js
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
```

- [ ] **Step 2: Verify creating a recipe**

Serve, unlock, click `+ 新食谱`. Enter:
- 菜名 `葫芦蛋花汤`
- 标签: click 中餐, then type `汤` in the new-tag box and press Enter
- 封面图: upload any photo
- 成品图: upload two photos
- 食材: `葫芦` / `半个`, then `+ 加一行` → `鸡蛋` / `1个`, then `+ 加一行` → type `盐` (the dropdown should offer 盐 — pick it; no 新 flag appears)
- 步骤: three lines

Click 保存. Verify:
1. It lands on the detail page for 葫芦蛋花汤 with the cover, both thumbnails, three ingredients and three steps.
2. Clicking a thumbnail opens the lightbox; clicking the lightbox closes it.
3. Back on `#/`, the new recipe appears first (id desc) and a 汤 tag chip now exists in the tag bar.

Confirm the new vocab entries were written:

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/ingredient_vocab?select=canonical,staple&staple=eq.false" -H "apikey: $K" -H "Authorization: Bearer $K"
```

Expected: includes `葫芦` and `鸡蛋` with `"staple":false`, and does **not** include `盐` (it was matched to the existing staple row).

- [ ] **Step 3: Verify editing a recipe**

Open 番茄炒蛋 → ✎ 编辑. Change 菜名 to `番茄炒蛋（家常版）`, remove the 主菜 tag, add a fourth step, save. Verify the detail page reflects all three changes and that reloading the page keeps them (i.e. they persisted, not just in memory).

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe editor with ingredient autocomplete and photo upload

New ingredient names are appended to the shared vocabulary on save so
autocomplete gets better the more recipes are added.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Delete a recipe

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Replace the `askDelete` stub**

Replace `function askDelete(id) { alert('删除功能在 Task 13 实现'); }` with:

```js
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
```

- [ ] **Step 2: Verify**

Create a throwaway recipe with one cover photo, note the cover URL from the DevTools Network tab (or `recipes.find(r=>r.name==='测试').cover_url` in the console), then delete it from the detail page. Verify:
1. The confirm dialog names the recipe.
2. After confirming, the page returns to `#/` and the card is gone.
3. Reloading confirms it stayed gone.
4. Opening the noted cover URL in a new tab now returns `{"error":"Object not found",...}` — the photo was cleaned up too.

- [ ] **Step 3: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add recipe deletion with photo cleanup

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Idea view — what can I cook

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Replace the `renderIdea` placeholder**

```js
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
```

- [ ] **Step 2: Verify the buckets**

Serve, unlock, click `🧊 冰箱里有什么`. Add `番茄`, `鸡蛋`, `牛肉` (typing `番` should offer 番茄 from the dropdown, since it was added to the vocab when 番茄炒蛋 was saved).

Expected with the three recipes from Tasks 9 and 12:
- **现在就能做 (1)** — 番茄炒蛋（家常版），标注 `食材齐了`
- **再买 2 样就能做 (1)** — 牛肉三明治，标注 `+ 面包 + 生菜`
- 葫芦蛋花汤 shows under **再买 1 样** with `+ 葫芦`

Critically: **盐 must never appear in any `+ ...` list** — it is a staple. If it does, `stapleSet` or `matchRecipes` is wrong; re-run `node scripts/verify-recipe-logic.js`.

Also verify:
1. Backspace on an empty input removes the last chip.
2. Clicking a recipe name navigates to its detail page.
3. `← 回到列表` returns to `#/` and the chips are still there when you come back (`ideaHave` is module state).

- [ ] **Step 3: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add fridge-matching idea view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Copy-prompt button

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Add the prompt builder and the button**

Append to `assets/recipe.js`:

```js
// 把食谱库 + 手头食材 + 算法结果拼成一段完整 prompt，让用户粘到 claude.ai 里问。
// 二期上线页面内 AI 之后这个按钮保留作为兜底。
function buildPrompt() {
  const lib = recipes.map(r =>
    `- ${r.name}（${(r.ingredient_keys || []).join('、')}）`).join('\n');
  const res = matchRecipes(ideaHave, recipes, staples);
  const doable = res.filter(x => !x.missing.length).map(x => x.recipe.name);
  const near = res.filter(x => x.missing.length)
    .map(x => `${x.recipe.name}（还差：${x.missing.join('、')}）`);

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
    if (b) { const t = b.textContent; b.textContent = '✓ 已复制'; setTimeout(() => { b.textContent = t; }, 1800); }
  } catch (e) {
    alert('复制失败，请手动复制：\n\n' + buildPrompt());
  }
}
```

- [ ] **Step 2: Wire the button into the idea view**

In `renderIdea`, replace the line:

```js
    ${body}
  </div>`;
```

with:

```js
    ${body}
    ${ideaHave.length ? `<div class="detail-actions">
      <button class="btn btn-ghost" id="copy-btn" onclick="copyPrompt()">📋 复制给 Claude 提问</button>
    </div>
    <div class="hint">把食谱库和手头食材拼成一段 prompt 复制走，粘到 claude.ai 里问创意建议。用的是你自己的订阅额度，不花 API 钱。</div>` : ''}
  </div>`;
```

- [ ] **Step 3: Verify**

On the idea view with 番茄 / 鸡蛋 / 牛肉 selected, click `📋 复制给 Claude 提问`. Verify:
1. The button briefly reads `✓ 已复制`.
2. Pasting into any text field yields a prompt that lists all recipes with their ingredient keys, the three ingredients you picked, the computed "现在就能做" and "差一点的" lines, and the closing request for out-of-library ideas.
3. The button and hint are hidden when no ingredients are selected.

> Note: `navigator.clipboard` requires a secure context. It works on `localhost` and on the live HTTPS GitHub Pages site, but not over plain `http://` to a LAN IP. The `catch` branch falls back to an alert with the text.

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add copy-prompt button for asking Claude outside the app

Zero-cost creativity layer using the user's existing subscription,
pending the phase-2 in-page AI.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Polling sync

**Files:**
- Modify: `assets/recipe.js`

- [ ] **Step 1: Add the poller**

Append to `assets/recipe.js`:

```js
// ── 15 秒轮询（只在标签页可见时请求，且只有内容真变了才重渲染） ──
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
```

- [ ] **Step 2: Seed `lastSig` after the initial load**

In `initApp`, after `loaded = true;` add:

```js
    lastSig = dataSig();
```

- [ ] **Step 3: Verify**

Open `recipe.html` in two browser windows side by side, both on `#/`. In one, add a recipe. Within 15 seconds the other window's grid should show the new card without a manual refresh, and its sync dot should stay green.

Then open the editor in window A and add a recipe from window B. Verify window A's form does **not** get wiped while you are typing.

- [ ] **Step 4: Commit**

```bash
git add assets/recipe.js
git commit -m "$(cat <<'EOF'
Add 15s polling sync for the recipe page

Skips the editor view so an in-progress form is never wiped.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 17: Add the 🍳 食谱 link to the other three pages

**Files:**
- Modify: `index.html:375-376`
- Modify: `shopping.html:293-294`
- Modify: `activity.html:270-271`

- [ ] **Step 1: `index.html`**

Find:

```html
        <a class="icon-btn" href="shopping.html" style="text-decoration:none;display:inline-block">🛒 购物</a>
        <a class="icon-btn" href="activity.html" style="text-decoration:none;display:inline-block">📅 日程</a>
```

Add after them:

```html
        <a class="icon-btn" href="recipe.html" style="text-decoration:none;display:inline-block">🍳 食谱</a>
```

- [ ] **Step 2: `shopping.html`**

Find:

```html
        <a class="icon-btn" href="index.html">💰 开支</a>
        <a class="icon-btn" href="activity.html">📅 日程</a>
```

Add after them:

```html
        <a class="icon-btn" href="recipe.html">🍳 食谱</a>
```

- [ ] **Step 3: `activity.html`**

Find:

```html
        <a class="icon-btn" href="index.html">💰 开支</a>
        <a class="icon-btn" href="shopping.html">🛒 购物</a>
```

Add after them:

```html
        <a class="icon-btn" href="recipe.html">🍳 食谱</a>
```

- [ ] **Step 4: Verify the four pages link to each other**

Serve, open `index.html`, unlock. Verify the topbar now has three nav links plus 锁定, and that 🍳 食谱 lands on the recipe page without asking for the password again. Repeat from `shopping.html` and `activity.html`.

On a 480px-wide viewport (DevTools device toolbar), confirm the four topbar buttons still fit on one line on all three old pages — they already have a `@media (max-width: 480px)` rule shrinking `.icon-btn` padding, so this should hold; if any page wraps, reduce that page's `.icon-btn` font-size by 1px rather than dropping a link.

- [ ] **Step 5: Commit**

```bash
git add index.html shopping.html activity.html
git commit -m "$(cat <<'EOF'
Link the recipe page from the other three pages

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 18: Final check and deploy

**Files:** none

- [ ] **Step 1: Re-run the pure-logic verification**

```bash
node scripts/verify-recipe-logic.js
```

Expected: `✅ normalization OK`, `✅ matching OK`, `✅ search OK`

- [ ] **Step 2: Structural sanity check on the new files**

```bash
node -e '
const fs=require("fs");
for (const f of ["assets/recipe.js","assets/recipe.css","recipe.html"]) {
  const s=fs.readFileSync(f,"utf8");
  const o=(s.match(/{/g)||[]).length, c=(s.match(/}/g)||[]).length;
  console.log(f, "{", o, "}", c, o===c ? "OK" : "MISMATCH");
}
new Function(fs.readFileSync("assets/recipe.js","utf8"));
console.log("✅ recipe.js parses");
'
```

Expected: brace counts match for the CSS file, and `✅ recipe.js parses`.

(`recipe.html` and `recipe.js` will show unequal brace counts because of template literals and CSS-in-attribute strings — that is expected. The `new Function(...)` parse check is the real signal for the JS.)

- [ ] **Step 3: Clean up the probe data**

Delete any leftover test recipes through the UI. Confirm the vocab has no junk entries:

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/ingredient_vocab?select=canonical,staple" -H "apikey: $K" -H "Authorization: Bearer $K"
```

Delete any bad rows via the Supabase table editor.

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Verify the live site**

Wait 1–2 minutes, then open `https://tianshuuu.github.io/household-exp/recipe.html`. Verify:
1. The password gate appears and accepts the shared password.
2. Fonts load (Fraunces serif headings, mono small caps) — a fallback to Georgia means the Google Fonts `<link>` is wrong.
3. Existing recipes and their photos render.
4. Uploading a new photo works over HTTPS.
5. `📋 复制给 Claude 提问` copies (HTTPS is a secure context, so `navigator.clipboard` is available).
6. The other three pages show the 🍳 食谱 link.

---

## What phase 1 does NOT include

Deliberately deferred, per the design doc:

- **AI 层**（二期）—— `assets/recipe-ai.js`, the `kitchen-ai` Edge Function with the Gemini adapter, the `ai_usage` table and its 30/day cap, the ✨ button, and LLM-assisted new-ingredient normalization. The copy-prompt button in Task 15 covers the need in the meantime.
- **购物清单联动**（三期）—— the `+ 购物清单` button on missing-ingredient rows.
- Ratings, notes, cook time, difficulty, source links, per-step photos, dark mode, per-user attribution, structured ingredient quantities — all recorded as out of scope in the design doc's 「明确不做的事」 section.
