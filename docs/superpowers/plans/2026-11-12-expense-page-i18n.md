# 家庭账单页中英切换 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 `index.html` 加一个顶栏一键中英切换，只翻界面架构文字，用户录入的内容原样保留。

**Architecture:** 照搬 `assets/recipe.js` 已经跑了三个月的 i18n 模式（`I18N` 词条表 + `t()` 插值 + `paintChrome()` 刷静态文案）。两页共用新 localStorage key `hh_lang`，`recipe.js` 读不到时回退旧的 `recipe_lang`。英文版汇总卡换成中性的 balance 模型，**整张卡的符号从 Tianshu 视角统一取反**。

**Tech Stack:** 纯静态 HTML + 内联 JS，无构建步骤，无测试框架。自动化验证靠 PURE LOGIC 段的 `assert` 断言 + 新增的 i18n key 对齐检查脚本。

**Spec:** `docs/superpowers/specs/2026-11-12-expense-page-i18n-design.md`

---

## 开工前必读

**1. PURE LOGIC 段是 `eval` 提取的，非严格模式下只有 `function` 声明能跨出作用域。** 新纯函数必须写成 `function foo() {}`，不能写 `const foo = () => {}`，否则 `verify-fx-logic.js` 报 `not defined`。`I18N` 是 `const`，**不要放进 PURE LOGIC 段**——它的检查走另一个脚本（Task 1）。

**2. 断言先让它失败一次再改对。** 仓库规矩（CLAUDE.md），也是唯一能证明断言真在测东西的办法。

**3. 改了 `assets/` 就要 bump 引用页面的 `?v=`。** 本计划 Task 10 会改 `assets/recipe.js`，那时 `recipe.html` 的三个 `?v=` 都要 bump 到 `2026111201`。改 `index.html` 本身不需要 bump。

**4. 中文版一个字都不能变。** 所有改动的默认分支必须和现在逐字相同。Task 11 有一条专门验这个。

---

## 文件结构

| 文件 | 改什么 |
|---|---|
| `index.html` | 主体。加 i18n 引擎 + 词条表 + 4 个纯函数；`renderSummary` / `itemRowHtml` / `TYPE_META` / 抽屉 / 历史详情全部走 `t()`；静态 HTML 加 id + `paintChrome()`；顶栏加切换按钮 + `.lang-btn` 内联样式 |
| `scripts/verify-i18n.js` | **新建**。检查 `index.html` 和 `assets/recipe.js` 两张词条表的 zh/en key 是否对齐 |
| `scripts/verify-fx-logic.js` | 加新纯函数的断言；改一条因 `validateExpenseInput` 契约变更而失效的旧断言 |
| `assets/recipe.js` | 改读共用 key `hh_lang`，回退旧 `recipe_lang` |
| `recipe.html` | 三个 `?v=` bump |
| `docs/HANDOFF.md` | 新增一节说明 i18n 机制和那个已知盲区 |

---

## Task 1: i18n 引擎 + key 对齐检查脚本

**Files:**
- Create: `scripts/verify-i18n.js`
- Modify: `index.html`（在 `// ── PURE LOGIC END ──` 之后、`// ── Supabase REST ──` 之前插入）

- [ ] **Step 1: 先写检查脚本（此时它应该报「找不到 I18N」）**

创建 `scripts/verify-i18n.js`：

```js
// 检查中英词条表的 key 有没有对齐。必须从仓库根目录跑：
//     node scripts/verify-i18n.js
//
// 为什么需要它：少一个 key 不会报错，只会在英文界面上露出一句中文——
// 而且往往藏在某个很少打开的弹窗里，自己用很久都发现不了。
//
// 为什么用大括号配对 + eval 而不是正则：词条表一行写多个 key
// （`appTitle: 'x', navDrawer: 'y',`），按行匹配的正则每行只能抓到第一个，
// 会漏掉大半还报「对齐」——那比没有检查更糟。写这个脚本时先用正则试过，
// 对 assets/recipe.js 数出 87 个里的一部分就停了，是实测踩出来的。
//
// 两个文件都查。index.html 和 assets/recipe.js 各有一份独立词条表，引擎也
// 各有一份——这是 HANDOFF 第十一节记录过的刻意选择。verify-shared-fns.py
// 只扫三个页面的内联 script，看不到 assets/recipe.js，所以那两份引擎分化了
// 没有任何检查能发现。这个脚本至少把词条表这一半盯住。
const fs = require('fs');

const TARGETS = ['index.html', 'assets/recipe.js'];

function extractI18N(path) {
  let src = fs.readFileSync(path, 'utf8');
  if (path.endsWith('.html')) {
    src = (src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
            .join('\n').replace(/<\/?script[^>]*>/g, '');
  }
  const start = src.indexOf('const I18N = {');
  if (start < 0) return null;

  // 从第一个 { 开始配对，跳过字符串里和注释里的括号
  let i = src.indexOf('{', start), depth = 0, end = -1, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  return new Function('return ' + src.slice(src.indexOf('{', start), end))();
}

let bad = false;
for (const path of TARGETS) {
  let obj;
  try { obj = extractI18N(path); }
  catch (e) { console.log(`\u274c ${path}: 词条表解析失败 — ${e.message}`); bad = true; continue; }
  if (!obj || !obj.zh || !obj.en) {
    console.log(`\u274c ${path}: 找不到 const I18N = { zh: {...}, en: {...} };`);
    bad = true; continue;
  }
  const onlyZh = Object.keys(obj.zh).filter(k => !(k in obj.en));
  const onlyEn = Object.keys(obj.en).filter(k => !(k in obj.zh));
  if (onlyZh.length || onlyEn.length) {
    bad = true;
    console.log(`\u274c ${path}: zh ${Object.keys(obj.zh).length} 个 / en ${Object.keys(obj.en).length} 个`);
    if (onlyZh.length) console.log(`   只在 zh: ${onlyZh.join(', ')}`);
    if (onlyEn.length) console.log(`   只在 en: ${onlyEn.join(', ')}`);
  } else {
    console.log(`\u2705 ${path}: ${Object.keys(obj.zh).length} 个 key 完全对齐`);
  }
}
process.exit(bad ? 1 : 0);
```

- [ ] **Step 2: 跑一次，确认它对 index.html 失败**

Run: `node scripts/verify-i18n.js`
Expected: FAIL（退出码 1），输出 `❌ index.html: 找不到 const I18N = { zh: {...}, en: {...} };`
（`assets/recipe.js` 那边本来就有，不会报错）

- [ ] **Step 3: 在 `index.html` 加引擎**

找到 `// ── PURE LOGIC END ──` 这一行，在它**下面**插入（引擎不属于 PURE LOGIC，因为 `I18N` 是 `const`、跨不出 eval 作用域）：

```js
// ── i18n ──
// 照搬 assets/recipe.js 里那套（跑了三个月）。两页共用一个 key：
// 在账单页切语言，食谱页跟着变。
//
// 为什么不抽成 assets/i18n.js：引擎只有 6 行，而两页的词条表完全不同，
// 真正能共用的就这几行；抽出去反而要背 ?v= 的维护负担。理由同 HANDOFF
// 第十一节对其他共用小函数的判断。
const LANG_KEY = 'hh_lang';
// 回退读 recipe_lang：食谱页原来用的就是那个 key，不回退的话用户现有的
// 语言偏好会在这次上线时被悄悄重置成中文。
let lang = (localStorage.getItem(LANG_KEY) || localStorage.getItem('recipe_lang')) === 'en' ? 'en' : 'zh';

const I18N = {
  zh: {
    langBtn: 'EN',
  },
  en: {
    langBtn: '中文',
  },
};

// 取词条。{0} {1} 占位符按参数顺序替换。找不到的 key 回退中文，
// 再找不到就返回 key 本身——宁可界面上露出一个英文 key，也不要 undefined。
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
```

- [ ] **Step 4: 跑检查，确认通过**

Run: `node scripts/verify-i18n.js`
Expected: PASS
```
✅ index.html: 1 个 key 完全对齐
✅ assets/recipe.js: 87 个 key 完全对齐
```

- [ ] **Step 5: 故意破坏一次，确认检查真的有效**

临时把 `index.html` 里 `en:` 段的 `langBtn: '中文',` 删掉，跑：

Run: `node scripts/verify-i18n.js`
Expected: FAIL，输出含 `只在 zh: ['langBtn']`

然后**把那行加回去**，再跑一次确认恢复 PASS。

> 这一步不能省。一个永远通过的检查比没有检查更糟——它会让人以为这块有人看着。

- [ ] **Step 6: 提交**

```bash
git add index.html scripts/verify-i18n.js
git commit -m "账单页 i18n：加引擎和 key 对齐检查脚本"
```

---

## Task 2: 纯函数 `currencyOptionLabel()`

**Files:**
- Modify: `index.html`（PURE LOGIC 段，`// ── PURE LOGIC END ──` 之前）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 `scripts/verify-fx-logic.js` 末尾 `console.log('\n全部通过 ✅');` 之前）**

```js
// ── 货币下拉框的显示文字 ──
// 英文版只显示代码，不显示名字。两个理由：
// 1. 下拉框很窄——上面那条 name.length <= 4 的断言就是为这个存在的，
//    'Malaysian Ringgit' 这种英文全名根本塞不下
// 2. 货币代码对英文读者本来就是通用词汇，比截断的全名更有用
assert.strictEqual(currencyOptionLabel({ code:'AUD', name:'澳元' }, 'zh'), 'AUD 澳元', '中文显示代码+名字');
assert.strictEqual(currencyOptionLabel({ code:'AUD', name:'澳元' }, 'en'), 'AUD', '英文只显示代码');
assert.strictEqual(currencyOptionLabel({ code:'MYR', name:'林吉特' }, 'en'), 'MYR', '英文下长名字也只剩代码');
assert.strictEqual(currencyOptionLabel({ code:'MYR', name:'林吉特' }, 'zh'), 'MYR 林吉特', '中文下保持原样');
// 未知语言当中文处理——宁可多显示信息也别丢信息
assert.strictEqual(currencyOptionLabel({ code:'JPY', name:'日元' }, undefined), 'JPY 日元', '语言未知回退中文');
// 没有 name 的脏数据不能渲染出 'AUD undefined'
assert.strictEqual(currencyOptionLabel({ code:'AUD' }, 'zh'), 'AUD', '缺 name 时只显示代码');

console.log('✅ currency option label OK');
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，`ReferenceError: currencyOptionLabel is not defined`

- [ ] **Step 3: 在 PURE LOGIC 段实现（`// ── PURE LOGIC END ──` 之前）**

```js
// 货币下拉框一个选项的显示文字。
// 英文只给代码：下拉框宽度就那么点（见上面 CURRENCIES 注释里那段关于
// 97px 的计算），英文全名塞不下；而代码本身就是国际通用写法。
function currencyOptionLabel(c, lng) {
  if (!c || !c.code) return '';
  if (lng === 'en' || !c.name) return c.code;
  return c.code + ' ' + c.name;
}
```

- [ ] **Step 4: 跑断言，确认通过**

Run: `node scripts/verify-fx-logic.js`
Expected: PASS，输出含 `✅ currency option label OK`

- [ ] **Step 5: 接上渲染处**

把 `index.html` 里这一行（约 852 行，在填充 `#f-ccy` 下拉框的地方）：

```js
    currencyList().map(c => `<option value="${c.code}">${c.code} ${c.name}</option>`).join('');
```

改成：

```js
    currencyList().map(c => `<option value="${c.code}">${currencyOptionLabel(c, lang)}</option>`).join('');
```

- [ ] **Step 6: 解析检查并提交**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `ok`

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "账单页 i18n：货币下拉框英文版只显示代码"
```

---

## Task 3: 纯函数日期格式化

**Files:**
- Modify: `index.html`（PURE LOGIC 段加纯函数；`fmtDate` 约 1056 行改为调用它）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 Task 2 的断言之后）**

```js
// ── 日期格式化 ──
// 2026-11-12 是周四。星期下标从 0=周日 开始，差一位是这里最经典的错，
// 所以周日和周六两端都要断言。
assert.strictEqual(fmtDateIn('2026-11-12', 'zh'), '11月12日 · 周四', '中文：月日 + 星期');
assert.strictEqual(fmtDateIn('2026-11-12', 'en'), 'Nov 12 · Thu', '英文：月缩写 + 日 + 星期缩写');

// 两端边界：下标 0（周日）和下标 6（周六）
assert.strictEqual(fmtDateIn('2026-11-15', 'zh'), '11月15日 · 周日', '周日是下标 0');
assert.strictEqual(fmtDateIn('2026-11-15', 'en'), 'Nov 15 · Sun', '周日是下标 0（英文）');
assert.strictEqual(fmtDateIn('2026-11-14', 'zh'), '11月14日 · 周六', '周六是下标 6');
assert.strictEqual(fmtDateIn('2026-11-14', 'en'), 'Nov 14 · Sat', '周六是下标 6（英文）');

// 月份两端：1 月（下标 0）和 12 月（下标 11）
assert.strictEqual(fmtDateIn('2027-01-01', 'zh'), '1月1日 · 周五', '1 月是下标 0');
assert.strictEqual(fmtDateIn('2027-01-01', 'en'), 'Jan 1 · Fri', '1 月是下标 0（英文）');
assert.strictEqual(fmtDateIn('2026-12-31', 'zh'), '12月31日 · 周四', '12 月是下标 11');
assert.strictEqual(fmtDateIn('2026-12-31', 'en'), 'Dec 31 · Thu', '12 月是下标 11（英文）');

// 语言未知回退中文
assert.strictEqual(fmtDateIn('2026-11-12', undefined), '11月12日 · 周四', '语言未知回退中文');

console.log('✅ date formatting OK');
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，`ReferenceError: fmtDateIn is not defined`

- [ ] **Step 3: 在 PURE LOGIC 段实现**

```js
// 日期显示。抽成纯函数是为了能断言——星期下标从 0=周日 开始，
// 差一位的 bug 在界面上就是「周四显示成周三」，不盯着根本发现不了。
//
// 用 T12:00:00 而不是 T00:00:00：澳洲是 UTC+10/+11，用 00:00 构造的话
// new Date 在某些时区会退回前一天。这个写法是从原来的 fmtDate 抄过来的，
// 不要「顺手优化」掉。
function fmtDateIn(ds, lng) {
  const d = new Date(ds + 'T12:00:00');
  if (lng === 'en') {
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const wk = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${mo[d.getMonth()]} ${d.getDate()} · ${wk[d.getDay()]}`;
  }
  const mo = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const wk = ['周日','周一','周二','周三','周四','周五','周六'];
  return `${mo[d.getMonth()]}${d.getDate()}日 · ${wk[d.getDay()]}`;
}
```

- [ ] **Step 4: 把原来的 `fmtDate` 改成薄封装**

把 `index.html` 约 1056 行这一整段：

```js
function fmtDate(ds) {
  const d  = new Date(ds + 'T12:00:00');
  const mo = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const wk = ['周日','周一','周二','周三','周四','周五','周六'];
  return `${mo[d.getMonth()]}${d.getDate()}日 · ${wk[d.getDay()]}`;
}
```

替换成：

```js
// 薄封装，真正的逻辑在 PURE LOGIC 段的 fmtDateIn 里（那边能被断言）
function fmtDate(ds) { return fmtDateIn(ds, lang); }
```

- [ ] **Step 5: 跑断言 + 解析检查**

```bash
node scripts/verify-fx-logic.js | tail -2 && node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `✅ date formatting OK`、`全部通过 ✅`、`ok`

- [ ] **Step 6: 提交**

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "账单页 i18n：日期格式化抽成纯函数并支持英文"
```

---

## Task 4: 纯函数 `balanceView()` —— 符号取反

**这是整个改动里最容易出错的一步。搞反了不会报错，只会把债权债务显示反。**

**Files:**
- Modify: `index.html`（PURE LOGIC 段）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 Task 3 的断言之后）**

```js
// ── 英文版的 balance 视角 ──
// 中文版的方向写在标签里（「本月宝宝需还给你」vs「本月应转给宝宝」），
// 金额永远是正数。英文版换成中性的 balance 模型，方向只靠正负号，
// 约定是「正数 = Tianshu 是债权方」。
//
// 代码里 transfer 负数表示宝宝欠你，所以 Balance(Tianshu) = -transfer。
// 这个翻转必须贯穿整张卡，不能只翻 hero —— spec 初稿就栽在这，
// 只翻了 hero、明细照抄中文符号，结果明细加起来对不上 hero。

// 线上实况（2026-11-12）：宝宝欠你 4216.91
const bv = balanceView({ carryover: -6984.63, shared: 1135.21, pp: 274.63, cp: 3609.96 });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}（实际 ${a}）`);

near(bv.balance,  4216.905, 'Balance(Tianshu) 为正 = 你是债权方（4216.905 是真实值，4216.91 是 fmt 四舍五入后的显示值）');
near(bv.carry,    6984.63, '上期结余取反');
near(bv.halfShare,  567.605, '共同开支的一半取反为正');
near(bv.pp,         274.63, 'TS pays for XC 取反为正');
near(bv.cp,       -3609.96, 'XC pays for TS 取反为负');

// 明细必须加得出 hero。只断言 hero 的符号挡不住「hero 翻了明细没翻」。
near(bv.carry + bv.halfShare + bv.pp + bv.cp, bv.balance,
  '明细四项之和必须严格等于 Balance');

// 反向：你欠宝宝 100 的情况
const bv2 = balanceView({ carryover: 100, shared: 0, pp: 0, cp: 0 });
near(bv2.balance, -100, 'transfer 为正（你要付钱）时 Balance 为负');

// 零值
const bv3 = balanceView({ carryover: 0, shared: 0, pp: 0, cp: 0 });
near(bv3.balance, 0, '全零');

// 脏数据：字符串和 null 都不能变成 NaN
const bv4 = balanceView({ carryover: '-6984.63', shared: '1135.21', pp: null, cp: undefined });
near(bv4.balance, 6984.63 + 567.605, '字符串照算，null/undefined 当 0');

console.log('✅ balance view OK');
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，`ReferenceError: balanceView is not defined`

- [ ] **Step 3: 在 PURE LOGIC 段实现**

```js
// 英文版汇总卡的数值视角。中文版不用它。
//
// 中文版从「要转多少钱」的角度算：transfer = carry - shared/2 - pp + cp，
// 负数表示宝宝欠你，界面上用标签表达方向、金额取绝对值。
//
// 英文版从 Tianshu 的角度算，约定「正数 = Tianshu 是债权方」，所以每一项
// 都是中文那项的相反数。**整张卡必须一起翻**，只翻 hero 的话明细加起来
// 对不上 hero —— 在算钱的页面上这是硬伤。
//
//   -carry + shared/2 + pp - cp === -(carry - shared/2 - pp + cp) === -transfer
function balanceView(v) {
  const num = x => parseFloat(x) || 0;
  const carry     = -num(v && v.carryover);
  const halfShare =  num(v && v.shared) / 2;
  const pp        =  num(v && v.pp);
  const cp        = -num(v && v.cp);
  return { carry, halfShare, pp, cp, balance: carry + halfShare + pp + cp };
}
```

- [ ] **Step 4: 跑断言，确认通过**

Run: `node scripts/verify-fx-logic.js`
Expected: PASS，输出含 `✅ balance view OK`

- [ ] **Step 5: 提交**

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "账单页 i18n：英文版 balance 视角的纯函数和断言"
```

---

## Task 5: 填满词条表

**Files:**
- Modify: `index.html`（Task 1 建的 `I18N` 对象）

- [ ] **Step 1: 把 `I18N` 整个替换成完整词条表**

把 Task 1 加的那个只有 `langBtn` 的 `I18N` 换成：

```js
const I18N = {
  zh: {
    langBtn: 'EN',
    // 顶栏
    appTitle: '家庭账单', navDrawer: '☰ 往期', navShopping: '🛒 购物',
    navActivity: '📅 日程', navRecipe: '🍳 食谱', navSettings: '设置',
    // 汇总卡
    cycleLabel: '累计账单 · 共 {0} 笔',
    heroRecv: '本月宝宝需还给你', heroPay: '本月应转给宝宝',
    heroNote: 'AUD · 每月 {0} 日自动记租金',
    bCarryRecv: '上期宝宝欠你（抵减）', bCarryPay: '上期你欠宝宝（累加）',
    bSharedTotal: '共同开支（全额）', bSharedHalf: '└ 其中抵扣（÷2）',
    bPartnerPaid: '替宝宝垫付（全额抵扣）', bCovered: '宝宝替我垫付',
    // 开支行
    typeShared: '共同分担', typePartnerPersonal: '替宝宝垫付', typePartnerPaid: '宝宝替我垫',
    shareEach: '各付 ${0}', shareFullCredit: '全额抵扣', shareFullCharge: '全额增加',
    btnEdit: '编辑', btnDelete: '删除',
    emptyList: '暂无记录<br>点击上方按钮添加开支',
    addFab: '添加开支',
    // 添加 / 编辑面板
    addTitle: '添加开支', editTitle: '编辑开支',
    fDate: '日期', fAmount: '金额', fDesc: '描述', fType: '类型',
    segSharedSub: '各付一半', segPartnerSub: '全额抵扣', segCoveredSub: '全额增加',
    btnAdd: '添加', btnSaveEdit: '保存修改', fxRefreshTitle: '重新获取汇率',
    // 设置面板
    setTitle: '设置', setRent: '每月租金',
    setRentSub: '每月自动记一笔「宝宝替我垫付」',
    setRentDay: '租金日', setRentDaySub: '每月几号自动记租金',
    btnSave: '保存', rentSectionTitle: '关于房租',
    rentHint: '每月 {0} 日自动记一笔「宝宝替我垫付」。改上面的金额只影响以后生成的，已经记上的保留当时金额。房租行可以改金额但不能删——删了下次打开会自动补回来，真要去掉就把金额改成 0。',
    // 往期抽屉 / 历史详情
    drawerTitle: '往期记录', loading: '加载中...',
    cycEmpty: '暂无往期账单<br>2026-11-02 起不再归档<br>这里只保留此前的历史记录',
    loadFailed: '加载失败，请重试',
    cycRecv: '宝宝还 ', cycPay: '应转 ', cycToNow: '至今',
    histTitle: '账期详情', histEmpty: '本期无开支记录', histSettled: 'AUD · 已结算',
    histRecv: '宝宝需还给你', histPay: '当期应转给宝宝', histRent: '我的租金份额',
    // 弹窗 / 提示
    confirmDelTitle: '确认删除？', btnCancel: '取消', btnUndo: '撤销操作',
    undoDeleted: '已删除「{0}」',
    errNoDate: '请填写日期', errNoDesc: '请填写描述', errBadAmount: '请填写有效金额',
    errNoRate: '没查到汇率，请手动填写汇率',
    errConvert: '金额换算失败，请检查金额和汇率',
    errBadSettings: '请填写有效的设置值',
    errNoCycle: '账期尚未加载，请刷新页面重试',
    errSaveFailed: '保存失败，请检查网络后重试',
    fxLoading: '正在获取汇率…',
    fxNote: '取的是 {0} 的收盘价（当天还没有牌价）',
    fxNoRate: '没查到 {0} 的汇率，请手动填写',
  },
  en: {
    langBtn: '中文',
    // 顶栏
    appTitle: 'Household Expenses', navDrawer: '☰ History', navShopping: '🛒 Shopping',
    navActivity: '📅 Schedule', navRecipe: '🍳 Recipes', navSettings: 'Settings',
    // 汇总卡
    cycleLabel: 'Running total · {0} entries',
    // 英文版 hero 不用方向标签，统一是 Balance (Tianshu)，方向靠正负号
    heroRecv: 'Balance (Tianshu)', heroPay: 'Balance (Tianshu)',
    heroNote: 'AUD · rent auto-logged on day {0}',
    bCarryRecv: 'Previous balance', bCarryPay: 'Previous balance',
    bSharedTotal: 'Shared expenses (total)', bSharedHalf: "└ XC's half (÷2)",
    bPartnerPaid: 'TS pays for XC', bCovered: 'XC pays for TS',
    // 开支行
    typeShared: 'Shared', typePartnerPersonal: 'TS pays for XC', typePartnerPaid: 'XC pays for TS',
    shareEach: '${0} each', shareFullCredit: 'Full credit', shareFullCharge: 'Full charge',
    btnEdit: 'Edit', btnDelete: 'Delete',
    emptyList: 'No entries yet<br>Tap the button above to add one',
    addFab: 'Add expense',
    // 添加 / 编辑面板
    addTitle: 'Add expense', editTitle: 'Edit expense',
    fDate: 'Date', fAmount: 'Amount', fDesc: 'Description', fType: 'Type',
    segSharedSub: 'Split 50/50', segPartnerSub: 'Full credit', segCoveredSub: 'Full charge',
    btnAdd: 'Add', btnSaveEdit: 'Save changes', fxRefreshTitle: 'Refresh rate',
    // 设置面板
    setTitle: 'Settings', setRent: 'Monthly rent',
    setRentSub: 'Logged automatically as "XC pays for TS"',
    setRentDay: 'Rent day', setRentDaySub: 'Day of month to log rent',
    btnSave: 'Save', rentSectionTitle: 'About rent',
    rentHint: 'Rent is logged automatically on day {0} as "XC pays for TS". Changing the amount above only affects future entries — ones already logged keep their original amount. Rent rows can be edited but not deleted: deleting one just brings it back on the next load. To cancel a month, set its amount to 0.',
    // 往期抽屉 / 历史详情
    drawerTitle: 'Past cycles', loading: 'Loading...',
    cycEmpty: 'No past cycles<br>Archiving stopped on 2026-11-02<br>Only earlier history is kept here',
    loadFailed: 'Could not load — please retry',
    cycRecv: 'to TS ', cycPay: 'to XC ', cycToNow: 'now',
    histTitle: 'Cycle detail', histEmpty: 'No expenses in this cycle', histSettled: 'AUD · settled',
    histRecv: 'Balance (Tianshu)', histPay: 'Balance (Tianshu)', histRent: "TS's rent share",
    // 弹窗 / 提示
    confirmDelTitle: 'Delete this?', btnCancel: 'Cancel', btnUndo: 'Undo',
    undoDeleted: 'Deleted "{0}"',
    errNoDate: 'Please pick a date', errNoDesc: 'Please enter a description',
    errBadAmount: 'Please enter a valid amount',
    errNoRate: 'No rate found — please enter one manually',
    errConvert: 'Conversion failed — check the amount and rate',
    errBadSettings: 'Please enter valid settings',
    errNoCycle: 'Cycle not loaded yet — refresh and try again',
    errSaveFailed: 'Save failed — check your connection and retry',
    fxLoading: 'Fetching rate…',
    fxNote: 'Using the close from {0} (no rate published for that day yet)',
    fxNoRate: 'No rate found for {0} — please enter one manually',
  },
};
```

> 带撇号的两条（`XC's half`、`TS's rent share`）用**双引号**包起来。不要用 `\u` 转义——写这份计划时它就被 shell 吃掉过一次，留下一行过不了语法检查的代码。双引号最省事。

- [ ] **Step 2: 跑 key 对齐检查**

Run: `node scripts/verify-i18n.js`
Expected: PASS
```
✅ index.html: 75 个 key 完全对齐
✅ assets/recipe.js: 87 个 key 完全对齐
```

如果数字对不上或报「只在 zh / 只在 en」，**照它列出的 key 补齐再往下走**。

- [ ] **Step 3: 解析检查并提交**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `ok`

```bash
git add index.html
git commit -m "账单页 i18n：填满中英词条表"
```

---

## Task 6: 静态 HTML 加 id + `paintChrome()`

HTML 里写死的中文切语言时不会自己变，要手动刷。没 id 的元素先加 id。

**Files:**
- Modify: `index.html`（HTML 结构 + 新增 `paintChrome()`）

- [ ] **Step 1: 给没有 id 的静态文案元素加 id**

逐个改（行号以当前 `index.html` 为准，改动过程中会偏移，按内容定位更可靠）：

| 原内容 | 加的 id |
|---|---|
| `<title>家庭账单</title>` | 不用 id，`paintChrome` 直接写 `document.title` |
| `<button class="icon-btn" onclick="openDrawer()">☰ 往期</button>` | `id="nav-drawer"` |
| `<a class="icon-btn" href="shopping.html" …>🛒 购物</a>` | `id="nav-shopping"` |
| `<a class="icon-btn" href="activity.html" …>📅 日程</a>` | `id="nav-activity"` |
| `<a class="icon-btn" href="recipe.html" …>🍳 食谱</a>` | `id="nav-recipe"` |
| `<button class="icon-btn" onclick="openSettings()">设置</button>` | `id="nav-settings"` |
| `…>共同开支（全额）</span>` | 外层 `<span class="lbl">` 加 `id="b-shared-total-lbl"` |
| `<span class="lbl">└ 其中抵扣（÷2）</span>` | `id="b-shared-half-lbl"` |
| `…>替宝宝垫付（全额抵扣）</span>` | 外层 `<span class="lbl">` 加 `id="b-partner-paid-lbl"` |
| `…>宝宝替我垫付</span>` | 外层 `<span class="lbl">` 加 `id="b-covered-lbl"` |
| `<span class="plus">＋</span> 添加开支` | 外层 `<button>` 加 `id="add-fab"` |
| `<div class="empty-text">暂无记录<br>…</div>` | `id="empty-text"` |
| `<label class="flabel">日期</label>` | `id="f-date-lbl"` |
| `<label class="flabel">金额</label>` | `id="f-amount-lbl"` |
| `<label class="flabel">描述</label>` | `id="f-desc-lbl"` |
| `<label class="flabel">类型</label>` | `id="f-type-lbl"` |
| `<label class="seg-lbl" for="ft-shared">共同分担<small>各付一半</small></label>` | `id="seg-shared"` |
| `<label class="seg-lbl" for="ft-partner">替宝宝垫付<small>全额抵扣</small></label>` | `id="seg-partner"` |
| `<label class="seg-lbl" for="ft-covered">宝宝替我垫<small>全额增加</small></label>` | `id="seg-covered"` |
| `<div class="sheet-title">设置</div>` | `id="set-title"` |
| `<div class="srow-lbl">每月租金<small>…</small></div>` | `id="set-rent-lbl"` |
| `<div class="srow-lbl">租金日<small>…</small></div>` | `id="set-rentday-lbl"` |
| `<button class="submit" onclick="saveSettings()">保存</button>` | `id="set-save-btn"` |
| `<div class="danger-title">关于房租</div>` | `id="rent-section-title"` |
| `<div class="cycle-hint">每月 <span id="s-rentday-echo">22</span> 日…</div>` | `id="rent-hint"`，**并删掉里面那个 `<span id="s-rentday-echo">22</span>`**，整句改由 `t('rentHint', cfg.rentDay)` 生成 |
| `<span class="drawer-title">往期记录</span>` | `id="drawer-title"` |
| `<div class="confirm-title">确认删除？</div>` | `id="confirm-title"` |
| `<button class="cbtn-cancel" onclick="cancelDel()">取消</button>` | `id="btn-cancel-del"` |
| `<button class="cbtn-delete" onclick="confirmDel()">删除</button>` | `id="btn-confirm-del"` |
| `<button class="undo-btn" onclick="undoDel()">撤销操作</button>` | `id="btn-undo"` |
| `<div class="transfer-big …" id="hero-amount"><span class="sym">$</span>…` | 那个 `<span class="sym">` 加 `id="hero-sym"` |

⚠️ **删掉 `s-rentday-echo` 之后**，`openSettings()` 里这一行会抛 `Cannot set properties of null`，必须一起删：

```js
  document.getElementById('s-rentday-echo').textContent = cfg.rentDay;
```

改成（放在 `openSettings()` 里，每次打开面板都刷一次，这样改完租金日立刻生效）：

```js
  document.getElementById('rent-hint').textContent = t('rentHint', cfg.rentDay);
```

- [ ] **Step 2: 加 `paintChrome()`**

加在 `toggleLang()` 下面：

```js
// HTML 里写死的静态文案，切语言时要手动刷一遍。
// 动态渲染出来的部分（开支行、汇总数值）由 render() 负责，不在这儿。
function paintChrome() {
  const set = (id, txt) => { const e = document.getElementById(id); if (e) e.textContent = txt; };
  const html = (id, s) => { const e = document.getElementById(id); if (e) e.innerHTML = s; };

  document.title = t('appTitle');
  const h1 = document.querySelector('.topbar h1');
  if (h1) h1.childNodes[0].nodeValue = t('appTitle');   // 后面还跟着同步小圆点，只能换第一个文本节点

  set('nav-drawer', t('navDrawer'));   set('nav-shopping', t('navShopping'));
  set('nav-activity', t('navActivity')); set('nav-recipe', t('navRecipe'));
  set('nav-settings', t('navSettings')); set('lang-btn', t('langBtn'));

  set('b-shared-total-lbl', t('bSharedTotal'));
  set('b-shared-half-lbl',  t('bSharedHalf'));
  set('b-partner-paid-lbl', t('bPartnerPaid'));
  set('b-covered-lbl',      t('bCovered'));

  set('add-fab', t('addFab'));
  html('empty-text', t('emptyList'));

  set('f-date-lbl', t('fDate')); set('f-amount-lbl', t('fAmount'));
  set('f-desc-lbl', t('fDesc')); set('f-type-lbl', t('fType'));
  html('seg-shared',  t('typeShared') + '<small>' + t('segSharedSub') + '</small>');
  html('seg-partner', t('typePartnerPersonal') + '<small>' + t('segPartnerSub') + '</small>');
  html('seg-covered', t('typePartnerPaid') + '<small>' + t('segCoveredSub') + '</small>');

  set('set-title', t('setTitle'));
  html('set-rent-lbl',    t('setRent')    + '<small>' + t('setRentSub')    + '</small>');
  html('set-rentday-lbl', t('setRentDay') + '<small>' + t('setRentDaySub') + '</small>');
  set('set-save-btn', t('btnSave'));
  set('rent-section-title', t('rentSectionTitle'));
  set('rent-hint', t('rentHint', cfg.rentDay));

  set('drawer-title', t('drawerTitle'));
  set('confirm-title', t('confirmDelTitle'));
  set('btn-cancel-del', t('btnCancel'));
  set('btn-confirm-del', t('btnDelete'));
  set('btn-undo', t('btnUndo'));

  const fx = document.getElementById('fx-refresh');
  if (fx) fx.title = t('fxRefreshTitle');

  // 货币下拉框的选项文字也跟着语言变。函数名是 fillCurrencySelect，
  // 它在 index.html 约 850 行，Task 2 Step 5 改过它里面的渲染行。
  fillCurrencySelect();
}
```

⚠️ `paintChrome()` 里引用了 `cfg.rentDay`。`cfg` 在 `// ── Config ──` 区块声明，**在当前文件里它出现在 i18n 引擎之后**——但 `paintChrome()` 只在启动块和 `setLang()` 里被调用，那时 `cfg` 早已求值，不会撞上暂时性死区。

- [ ] **Step 3: 解析检查**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `ok`

```bash
grep -c 's-rentday-echo' index.html
```
Expected: `0`（旧 span 和它的赋值都已删除）

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "账单页 i18n：静态文案加 id，补 paintChrome()"
```

---

## Task 7: 动态渲染走 `t()`

**Files:**
- Modify: `index.html`（`renderSummary` / `TYPE_META` / `itemRowHtml` / 抽屉 / 历史详情）

- [ ] **Step 1: 改 `renderSummary()`**

整段替换：

```js
function renderSummary() {
  const { shared, pp, cp, carryover, transfer } = calc();
  const recv = transfer < 0;                 // 宝宝欠你
  const en   = lang === 'en';
  // 英文版从 Tianshu 视角看，每一项都是中文那项的相反数（见 PURE LOGIC
  // 段的 balanceView 注释）。**颜色不用翻**：中文的 -$567.60 和英文的
  // +$567.61 都表示「对你有利」，class 语义本来就是「对 TS 好 = 绿」。
  const bv = en ? balanceView({ carryover, shared, pp, cp }) : null;

  document.getElementById('hero').className        = 'transfer-hero ' + (recv ? 'receive' : 'pay');
  document.getElementById('hero-amount').className = 'transfer-big '  + (recv ? 'receive' : 'pay');
  document.getElementById('hero-label').textContent = recv ? t('heroRecv') : t('heroPay');
  if (en) {
    document.getElementById('hero-sym').textContent = (bv.balance < 0 ? '-$' : '+$');
    document.getElementById('hero-num').textContent = fmt(bv.balance);
  } else {
    document.getElementById('hero-sym').textContent = '$';
    document.getElementById('hero-num').textContent = fmt(transfer);
  }
  document.getElementById('hero-note').textContent   = t('heroNote', cfg.rentDay);
  document.getElementById('cycle-label').textContent = t('cycleLabel', expenses.length);

  const carryRow = document.getElementById('b-carry-row');
  if (Math.abs(carryover) >= 0.005) {
    carryRow.style.display = 'flex';
    document.getElementById('b-carry-lbl').textContent = carryover < 0 ? t('bCarryRecv') : t('bCarryPay');
    const cv = document.getElementById('b-carry');
    const cVal = en ? bv.carry : carryover;
    cv.textContent = (cVal < 0 ? '-$' : '+$') + fmt(cVal);
    cv.className   = 'val ' + (carryover < 0 ? 'positive' : 'negative');
  } else {
    carryRow.style.display = 'none';
  }

  document.getElementById('b-shared-total').textContent = `$${fmt(shared)}`;
  document.getElementById('b-shared-half').textContent  = (en ? '+$' : '-$') + fmt(shared / 2);
  document.getElementById('b-partner-paid').textContent = pp > 0 ? (en ? '+$' : '-$') + fmt(pp) : '$0.00';
  document.getElementById('b-covered').textContent      = cp > 0 ? (en ? '-$' : '+$') + fmt(cp) : '$0.00';
}
```

- [ ] **Step 2: 改 `TYPE_META` 和 `itemRowHtml()`**

`TYPE_META` 的 `tag` 从写死的中文改成 key：

```js
const TYPE_META = {
  shared:           { dot:'var(--green)',  tagKey:'typeShared'           },
  partner_personal: { dot:'var(--orange)', tagKey:'typePartnerPersonal'  },
  partner_paid:     { dot:'var(--red)',    tagKey:'typePartnerPaid'      },
};
```

`itemRowHtml()` 里三处跟着改：

```js
  const shareTxt = e.type === 'shared' ? t('shareEach', fmt(e.amount/2))
                 : e.type === 'partner_personal' ? t('shareFullCredit')
                 : t('shareFullCharge');
```

```js
          <button class="edit-btn" onclick="openEdit(${e.id})" title="${t('btnEdit')}">✎</button>
          ${isRentRow(e) ? '' : `<button class="del-btn"  onclick="askDel(${e.id})"  title="${t('btnDelete')}">×</button>`}
```

```js
          <div class="item-tag">${t(meta.tagKey)}</div>
```

⚠️ **必须先把局部变量 `t` 改名，否则上面那行会炸。** 函数第一行原来是 `const t = TYPE_META[e.type];`，改成：

```js
  const meta = TYPE_META[e.type];
```

局部的 `t` 会遮蔽全局的 `t()` 函数，`t('shareEach')` 就变成「把一个对象当函数调」，直接 TypeError。模板里的 `${t.dot}` 也要跟着改成 `${meta.dot}`。

- [ ] **Step 3: 改抽屉和历史详情**

`openDrawer()` 里：

```js
  body.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>${t('loading')}</span></div>`;
```
```js
      body.innerHTML = `<div class="cyc-empty">${t('cycEmpty')}</div>`;
```
```js
      const tTxt = (recv ? t('cycRecv') : t('cycPay')) + '$' + fmt(t2);
```
（把循环里原来的 `const t = parseFloat(c.transfer || 0);` 改名成 `const t2 = …`，同样是为了不遮蔽 `t()`；下面 `recv = t < 0` 也要跟着改成 `t2 < 0`。）
```js
  } catch(e) { console.error(e); body.innerHTML = `<div class="cyc-empty">${t('loadFailed')}</div>`; }
```

`cycRange()`：

```js
function cycRange(c) {
  return `${fmtShort(c.start_date) || '—'} – ${c.end_date ? fmtShort(c.end_date) : t('cycToNow')}`;
}
```

`openHistory()`：

```js
  body.innerHTML = `<div class="loading-wrap"><div class="spinner"></div><span>${t('loading')}</span></div>`;
```
```js
    document.getElementById('hist-title').textContent = cyc ? cycRange(cyc) : t('histTitle');
```
```js
      (exps.length ? groupedListHtml(exps, true) : `<div class="cyc-empty">${t('histEmpty')}</div>`);
```
```js
  } catch(e) { console.error(e); body.innerHTML = `<div class="cyc-empty">${t('loadFailed')}</div>`; }
```

`historySummaryHtml()` 里的标签同样换成 `t('histRecv')` / `t('histPay')` / `t('histSettled')` / `t('histRent')` / `t('bSharedTotal')` / `t('bSharedHalf')` / `t('bPartnerPaid')` / `t('bCovered')`。

⚠️ **历史账期的数值一律不动。** `cyc.transfer` 是冻结值（HANDOFF 第十三节），这里只换标签文字，**不套 `balanceView`**。

- [ ] **Step 4: 改剩下的提示文案**

| 位置 | 改成 |
|---|---|
| `openAdd()` / `openEdit()` 里设 `add-sheet-title` | `t('addTitle')` / `t('editTitle')` |
| 同处设 `add-submit-btn` | `t('btnAdd')` / `t('btnSaveEdit')` |
| `showUndoToast()` 里 `已删除「${desc}」` | `t('undoDeleted', desc)` |
| `saveSettings()` 里三个 `alert` | `t('errBadSettings')` / `t('errNoCycle')` / `t('errSaveFailed')` |
| `submitExpense()` 里换算失败的 alert | `t('errConvert')` |
| 汇率「正在获取…」 | `t('fxLoading')` |
| `取的是 ${noteDate} 的收盘价…` | `t('fxNote', noteDate)` |
| `没查到 ${ccy} 的汇率…` | `t('fxNoRate', ccy)` |

用这条命令找出所有还没改的中文字面量（PURE LOGIC 段的 `CURRENCIES` 和 Task 8 要处理的校验除外）：

```bash
python3 - <<'PY'
import re
h=open('index.html',encoding='utf-8').read()
js='\n'.join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>',h,re.S))
start=js.index('const I18N'); end=js.index('\n};', start)
js=js[:start]+js[end:]          # 词条表本身不算
for i,l in enumerate(js.split('\n'),1):
    code=l.split('//')[0]
    for m in re.finditer(r"""(['"`])((?:(?!\1).)*[一-龥](?:(?!\1).)*)\1""", code):
        print(f'{i:>5}  {m.group(2)[:60]}')
PY
```
Expected: 只剩 `CURRENCIES` 里那 30 个货币名，和 `validateExpenseInput` 里的 4 条（Task 8 处理）。

- [ ] **Step 5: 解析 + 全套断言 + 提交**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")' && node scripts/verify-fx-logic.js | tail -1 && node scripts/verify-i18n.js
```
Expected: `ok`、`全部通过 ✅`、两行 `✅ … 完全对齐`

```bash
git add index.html
git commit -m "账单页 i18n：动态渲染全部走 t()"
```

---

## Task 8: `validateExpenseInput` 改返回 key

它在 PURE LOGIC 段里直接返回中文，而且有一条断言在检查中文字符串内容。

**Files:**
- Modify: `index.html`（PURE LOGIC 段 + 调用处）
- Test: `scripts/verify-fx-logic.js:108`

- [ ] **Step 1: 先改断言（让它失败）**

把 `scripts/verify-fx-logic.js` 第 108 行附近这一条：

```js
assert.ok(V({ rate:NaN }).error.includes('汇率'), '错误提示要指出是汇率的问题');
```

替换成：

```js
// 2026-11-12 起 validateExpenseInput 返回的是词条 key 而不是中文句子——
// 它在 PURE LOGIC 段里，不该知道界面说什么语言。文案由调用方 t(key) 取。
assert.strictEqual(V({ rate:NaN }).errorKey, 'errNoRate', '外币缺汇率要给出 errNoRate');
assert.strictEqual(V({ date:'' }).errorKey, 'errNoDate', '缺日期给 errNoDate');
assert.strictEqual(V({ desc:'' }).errorKey, 'errNoDesc', '缺描述给 errNoDesc');
assert.strictEqual(V({ origAmount:0 }).errorKey, 'errBadAmount', '金额非法给 errBadAmount');
assert.strictEqual(V({}).errorKey, '', '通过时 errorKey 为空串');
```

- [ ] **Step 2: 跑一次，确认失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，`AssertionError` 显示 `undefined !== 'errNoRate'`

- [ ] **Step 3: 改实现**

把 PURE LOGIC 段里的 `validateExpenseInput` 整段替换：

```js
// 提交前校验。返回 { ok, errorKey }，调用方用 t(errorKey) 取文案。
// 2026-11-12 前这里直接返回中文句子——但这个函数在 PURE LOGIC 段，
// 它不该知道界面说什么语言。
function validateExpenseInput(v) {
  if (!v.date) return { ok:false, errorKey:'errNoDate' };
  if (!v.desc || !String(v.desc).trim()) return { ok:false, errorKey:'errNoDesc' };
  const amt = Number(v.origAmount);
  if (!isFinite(amt) || amt <= 0) return { ok:false, errorKey:'errBadAmount' };
  const c = String(v.ccy || 'AUD').toUpperCase();
  if (c !== 'AUD') {
    const r = Number(v.rate);
    if (!isFinite(r) || r <= 0) return { ok:false, errorKey:'errNoRate' };
  }
  return { ok:true, errorKey:'' };
}
```

- [ ] **Step 4: 改调用处**

`submitExpense()` 里（约 1190 行）：

```js
  if (!v.ok) { alert(v.error); return; }
```
改成：
```js
  if (!v.ok) { alert(t(v.errorKey)); return; }
```

确认没有别处还在读 `.error`：

```bash
grep -n '\.error\b' index.html
```
Expected: 无输出（或只剩与校验无关的）

- [ ] **Step 5: 跑断言，确认通过，提交**

```bash
node scripts/verify-fx-logic.js | tail -1
```
Expected: `全部通过 ✅`

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "账单页 i18n：validateExpenseInput 改返回词条 key"
```

---

## Task 9: 切换按钮 + 样式 + 启动

**Files:**
- Modify: `index.html`（顶栏 markup、内联 `<style>`、启动块）

- [ ] **Step 1: 顶栏加按钮**

在 `<button class="icon-btn" onclick="openSettings()" id="nav-settings">设置</button>` **后面**加：

```html
        <button class="lang-btn" id="lang-btn" onclick="toggleLang()">EN</button>
```

- [ ] **Step 2: 内联 `<style>` 加样式**

`index.html` 的 CSS 全部内联，而 `.lang-btn` 的样式在 `assets/recipe.css`（index 不加载它），所以要复制一份。加在 `/* ── App ── */` 那段之前：

```css
    /* 和 assets/recipe.css 里的 .lang-btn 同源。index.html 不加载 recipe.css
       （它的 CSS 全部内联），所以只能复制一份。两边样式细节不必完全一致——
       两个页面的配色本来就不同。 */
    .lang-btn {
      padding: 4px 9px; border: 1px solid var(--border); border-radius: 7px;
      background: transparent; color: var(--sub); font-size: 11px; font-weight: 600;
      font-family: inherit; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .lang-btn:active { background: var(--card); color: var(--text); }
    @media (max-width: 520px) { .lang-btn { padding: 3px 7px; font-size: 10px; } }
```

- [ ] **Step 3: 启动时刷一次**

在 `index.html` 末尾的启动块里，`initApp();` **之前**加两行：

```js
// ── Boot ──
// 2026-11-02 起没有登录门了，直接起 app。
document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
paintChrome();
initApp();
```

⚠️ `paintChrome()` 必须在 `initApp()` 之前：`initApp()` 会触发 `render()`，而 `render()` 依赖的静态标签得先就位。

- [ ] **Step 4: 解析检查 + CSS 括号平衡**

```bash
node -e 'const s=require("fs").readFileSync("index.html","utf8");const css=s.slice(s.indexOf("<style>"),s.indexOf("</style>"));const o=(css.match(/{/g)||[]).length,c=(css.match(/}/g)||[]).length;console.log(o===c?"CSS ok "+o:"MISMATCH "+o+"/"+c)' && node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("JS ok")'
```
Expected: `CSS ok <数字>` 和 `JS ok`

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "账单页 i18n：顶栏加中英切换按钮"
```

---

## Task 10: 食谱页改用共用 key

**Files:**
- Modify: `assets/recipe.js:125-126`
- Modify: `recipe.html`（三个 `?v=`）

- [ ] **Step 1: 改 key**

把 `assets/recipe.js` 这两行：

```js
const LANG_KEY = 'recipe_lang';
let lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';
```

替换成：

```js
// 2026-11-12 起和账单页共用一个 key，在哪边切都算。
// 回退读旧的 recipe_lang：不回退的话，这次上线会把用户已有的语言偏好
// 悄悄重置成中文。
const LANG_KEY = 'hh_lang';
let lang = (localStorage.getItem(LANG_KEY) || localStorage.getItem('recipe_lang')) === 'en' ? 'en' : 'zh';
```

- [ ] **Step 2: bump `recipe.html` 的三个 `?v=`**

改了 `assets/recipe.js` 就必须 bump（CLAUDE.md）。把 `recipe.html` 里**三处** `?v=2026110201` 全改成 `?v=2026111201`：

```bash
sed -i '' 's/?v=2026110201/?v=2026111201/g' recipe.html
grep -c '2026111201' recipe.html
```
Expected: `3`

- [ ] **Step 3: 跑食谱页的断言**

```bash
node scripts/verify-recipe-logic.js | tail -1 && node scripts/verify-i18n.js
```
Expected: 断言通过 + 两行 `✅ … 完全对齐`

- [ ] **Step 4: 提交**

```bash
git add assets/recipe.js recipe.html
git commit -m "食谱页改用共用语言 key，回退读旧 key 保住现有偏好"
```

---

## Task 11: 文档 + 线上验证

**Files:**
- Modify: `docs/HANDOFF.md`、`CLAUDE.md`

- [ ] **Step 1: HANDOFF 末尾加第十四节**

```markdown

---

## 十四、中英切换是怎么做的（2026-11-12 起）

### 一句话

账单页和食谱页各有一份 `I18N` 词条表和一份 6 行引擎（`t()` / `setLang()` / `toggleLang()` / `paintChrome()`），共用 localStorage key **`hh_lang`**。购物页和日程页仍然只有中文。

### 为什么不抽成 `assets/i18n.js`

引擎只有 6 行，而两页的词条表完全不同（账单 75 条、食谱 87 条，交集几乎为零），真正能共用的就那几行。抽出去反而要背 `?v=` 的维护负担。判断依据同第十一节对其他共用小函数的那套理由。

### ⚠️ 一个已知盲区

`scripts/verify-shared-fns.py` 的 `PAGES` 只扫 `index.html / shopping.html / activity.html` 的内联 `<script>`，**看不到 `assets/recipe.js`**。所以那两份 `t()` 引擎如果分化了，没有任何检查能发现。

`scripts/verify-i18n.js` 至少把两张词条表的 zh/en key 对齐盯住了——少一个 key 不会报错，只会在英文界面上露出一句中文，而且往往藏在很少打开的弹窗里。

### 英文版汇总卡的符号是反的，这是对的

中文版从「要转多少钱」的角度算，方向写在标签里（「本月宝宝需还给你」），金额取绝对值。

英文版换成中性的 balance 模型（用户说 `owes` 有亏欠感），方向只靠正负号，约定 **正数 = Tianshu 是债权方**。所以：

```
Balance (Tianshu) = -transfer
```

**整张卡一起翻，不只是 hero。** 只翻 hero 的话明细加起来对不上 hero——spec 初稿就栽在这。展开：

```
中文  carry −6984.63 − shared/2 567.61 − pp 274.63 + cp 3609.96 = −4216.91 = transfer
英文  −carry 6984.63 + shared/2 567.61 + pp 274.63 − cp 3609.96 = +4216.91 = Balance
```

逻辑在 PURE LOGIC 段的 `balanceView()` 里，有断言钉死，其中一条专门验「明细四项之和严格等于 hero」——只断言 hero 的符号挡不住「hero 翻了明细没翻」这类错。

**颜色不用翻。** class 的语义是「对 TS 有利 = 绿」，中文的 `-$567.60` 和英文的 `+$567.61` 表达的是同一件事。

### 历史账期不套这套

`renderArchived()` / `historySummaryHtml()` 只换标签文字，**数值一律不动**。`cyc.transfer` 是冻结值（第十三节），套 `balanceView` 会让历史明细和当时结算的数字对不上。

### 加新文案时

1. `I18N.zh` 和 `I18N.en` **同时**加，跑 `node scripts/verify-i18n.js` 确认对齐
2. 静态 HTML 的文案要在 `paintChrome()` 里刷，否则切语言时不会变
3. 局部变量**不要叫 `t`**——会遮蔽 `t()` 函数。`itemRowHtml` 和 `openDrawer` 里原来都有叫 `t` 的局部变量，这次改名成 `meta` / `t2` 了
```

- [ ] **Step 2: CLAUDE.md 的五个检查改成六个**

在那段 bash 里加一行：

```bash
node scripts/verify-i18n.js         # 中英词条表 key 有没有对齐（index.html + assets/recipe.js）
```

- [ ] **Step 3: 跑完整检查套件**

```bash
node scripts/verify-recipe-logic.js | tail -1
node scripts/verify-fx-logic.js | tail -1
python3 scripts/verify-refs.py | grep '^index.html'
python3 scripts/verify-shared-fns.py | tail -1
node scripts/verify-i18n.js
node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("auth ok")'
```
Expected: 全部通过。**`verify-refs.py` 的 `index.html` 必须仍是 `['REST']`**（CLAUDE.md 基线），多出名字就逐个 grep 查。

- [ ] **Step 4: 确认中文版一个字没变**

```bash
git stash && node -e '
const fs=require("fs");
const cur=fs.readFileSync("index.html","utf8");
' ; git stash pop
```

用更直接的办法：在浏览器里打开线上旧版和本地新版（中文），逐屏对照汇总卡、开支行、设置面板、往期抽屉。**任何一处中文变了都是 bug**——本次改动的中文分支应当逐字相同。

- [ ] **Step 5: 推送**

```bash
git add docs/HANDOFF.md CLAUDE.md && git commit -m "账单页 i18n：更新 HANDOFF 和 CLAUDE.md" && git push origin main
```

- [ ] **Step 6: 线上验收（等 1–2 分钟部署）**

打开 https://tianshuuu.github.io/household-exp/ ，逐条核对：

1. 顶栏最右边有 `EN` 按钮
2. 点 `EN` → 整页变英文，按钮变成 `中文`
3. hero 显示 `Balance (Tianshu)` 和 **`+$4,216.91`**（带加号，正数）
4. 明细四行：`Previous balance +$6,984.63` / `Shared expenses (total) $1,135.21` / `└ XC's half (÷2) +$567.61` / `TS pays for XC +$274.63` / `XC pays for TS -$3,609.96`
5. **手动把明细加一遍**：`6984.63 + 567.61 + 274.63 − 3609.96 = 4216.91`，必须等于 hero
6. 开支行的类型标签是 `Shared` / `TS pays for XC` / `XC pays for TS`
7. 日期显示 `Nov 12 · Thu` 这种格式
8. 打开「添加开支」面板，货币下拉框里只有 `AUD` `JPY` 这样的代码，没有中文名
9. 打开设置面板，文字全英文
10. 打开往期抽屉，三条历史记录的标签是英文、**数值和中文版一致**
11. 刷新页面，仍然是英文（localStorage 生效）
12. 点进食谱页，**也是英文**（共用 key 生效）
13. 切回中文，逐屏确认和改动前**逐字相同**
14. 控制台零报错

---

## 自查：spec 覆盖检查

| spec 章节 | 对应任务 |
|---|---|
| 1. 两页联动 / `hh_lang` + 回退 | Task 1（引擎）、Task 10（食谱页） |
| 2. 引擎各放一份，不抽文件 | Task 1；盲区写进 Task 11 的 HANDOFF |
| 3. 英文版 balance 模型 + 整卡取反 | Task 4（纯函数 + 断言）、Task 7 Step 1（接上渲染） |
| 4. 三个类型的英文 | Task 5（词条）、Task 7 Step 2（`TYPE_META`） |
| 5. 日期 | Task 3 |
| 6. 货币只显示代码 | Task 2 |
| 7. 切换按钮 + `.lang-btn` 样式 | Task 9 |
| 8. 要翻的范围（62 类） | Task 5（词条表）、Task 6（静态）、Task 7（动态）、Task 8（校验） |
| 不做：购物/日程页 | 全程未涉及 |
| 不做：中文版不变 | Task 11 Step 4 |
| 不做：历史数值不动 | Task 7 Step 3 的警告、Task 11 的 HANDOFF |
| 验证 1 货币 label | Task 2 Step 1 |
| 验证 2 日期 | Task 3 Step 1 |
| 验证 3 符号取反 | Task 4 Step 1 |
| 验证 3b 明细自洽 | Task 4 Step 1（那条 `明细四项之和` 断言） |
| 验证 4 key 对齐 | Task 1（脚本）+ Task 5 Step 2 |
| 验证 5 断言先失败 | 每个 Task 的 Step 2 |
| 验证 6 五个检查 | Task 11 Step 3 |
| 验证 7 浏览器实跑 | Task 11 Step 6 |
