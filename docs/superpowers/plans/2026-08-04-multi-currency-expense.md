# 外币开支按记账日汇率折算 AUD — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 家庭账单页记一笔外币开支时选货币和金额，按那一天的汇率折算成 AUD 存库，同时留痕原币金额和用掉的汇率。

**Architecture:** `expenses` 加三列 `orig_currency` / `orig_amount` / `fx_rate`，`amount` 语义不变（永远是 AUD），所以分账、账期结转、往期记录的代码一行不动。汇率浏览器直连 `api.frankfurter.dev`（CORS 开放、免费、无 key、支持按日期查历史），localStorage 缓存，汇率格永远可手改。换算相关的纯函数集中进一个 `PURE LOGIC` 段，由新脚本 `scripts/verify-fx-logic.js` 跑断言——这是本仓库唯一能自动验证的形态。

**Tech Stack:** 纯静态 HTML + 内联 JS，无构建步骤、无 npm、无测试框架。数据走裸 PostgREST fetch。验证脚本用 node 内置 `assert`。

**Spec:** `docs/superpowers/specs/2026-08-04-multi-currency-expense-design.md`

---

## 读这份计划之前必须知道的五件事

1. **所有 Supabase 请求都要 `await H()`**，形状是 `fetch(url, { headers: await H() })`。写成 `headers: H` 是把函数本身当 header 传，请求直接 401。**但汇率 API 是第三方，绝对不要给它带 `H()`**——那会把登录令牌泄露给 frankfurter.dev。这是这份计划里唯一一处 fetch 不带 `H()` 的地方。
2. **`scripts/verify-fx-logic.js` 用 `eval` 提取 PURE LOGIC 段。** 非严格模式的直接 eval 里，**只有 `function` 声明能跨出 eval 作用域**，`const` / `let` 不能。所以对外可见的东西一律写成 `function`；`CURRENCIES` 是 `const`，靠 `currencyList()` 这个函数闭包暴露出去（2026-08-04 实测可行）。
3. **改了 `assets/` 里的文件必须 bump 引用页面的 `?v=`。** 这份计划全程只改 `index.html` 和 `scripts/`，**不碰 `assets/`，所以不用 bump**。如果你发现自己在改 `assets/`，停下来重读 spec。
4. **仓库是公开的。** 不要提交任何含个人信息的文件。
5. **推 `main` 即上线**，没有 CI。每个任务结束都提交，但**只在最后一个任务才 push**。

---

## 前置：用户在 Supabase 控制台加三列

**这一步会话里做不了，必须用户自己操作。开工前先确认它已经完成。**

- [ ] **Step 1: 请用户在 Supabase 控制台 → SQL Editor 跑这段**

```sql
alter table public.expenses
  add column orig_currency text,
  add column orig_amount   numeric,
  add column fx_rate       numeric;
```

- [ ] **Step 2: 确认三列真的加上了**

让用户先跑 `python3 scripts/get-token.py` 换一个令牌（密码不回显、不进会话），然后：

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/expenses?select=id,amount,orig_currency,orig_amount,fx_rate&limit=1" \
  -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" \
  -H "Authorization: Bearer $(cat .token)"
```

期望：返回一条记录，含 `"orig_currency":null,"orig_amount":null,"fx_rate":null`。
如果报 `column expenses.orig_currency does not exist`，说明 SQL 没跑成功，**不要往下做**。

---

## 文件结构

| 文件 | 动作 | 职责 |
|---|---|---|
| `scripts/verify-fx-logic.js` | 新建 | 切出 `index.html` 的 PURE LOGIC 段跑断言。仓库里唯一验证这个功能的自动化手段 |
| `index.html` | 改 | PURE LOGIC 段（纯函数 + 货币表）、汇率获取与缓存、表单 UI 与联动、数据层映射、列表显示 |
| `scripts/verify-refs.py` | 改 | 扩成也扫 HTML 标签上的内联 `on*=` 事件属性 |
| `docs/HANDOFF.md` | 改 | 记下这个功能和它的坑 |

`index.html` 已经 1000+ 行且是单文件内联风格，这是这个仓库四个页面的既定形态。**不要为了"更好的结构"把它拆成 `assets/`**——那会引入 `?v=` 版本号维护负担，而且和另外三个页面不一致。新代码按现有的 `// ── 区块名 ──` 注释风格分段插入。

---

## Task 1: PURE LOGIC 段 + 验证脚本

纯函数先行。这一任务结束时没有任何 UI，但换算、格式化、校验的逻辑全部有断言护着。

**Files:**
- Create: `scripts/verify-fx-logic.js`
- Modify: `index.html`（在 `const toDB = ...` 那行之后、`// ── Sync dot ──` 之前插入新段）

- [ ] **Step 1: 先写验证脚本（此时被测代码还不存在）**

创建 `scripts/verify-fx-logic.js`：

```js
// index.html 的 PURE LOGIC 段断言。必须从仓库根目录跑：
//   node scripts/verify-fx-logic.js
//
// 提取方式和 verify-recipe-logic.js 一样是 eval。注意非严格模式的直接 eval
// 里只有 function 声明会跨出作用域，const/let 不会——所以 PURE LOGIC 段里
// 对外可见的东西必须写成 function，CURRENCIES 靠 currencyList() 暴露。
const fs   = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const pure = src.split('// ── PURE LOGIC START ──')[1].split('// ── PURE LOGIC END ──')[0];
eval(pure);

const assert = require('assert');

// ── 货币表 ──
const list = currencyList();
assert.strictEqual(list.length, 30, 'Frankfurter 支持 30 种货币（含 AUD）');
assert.strictEqual(list[0].code, 'AUD', 'AUD 必须置顶——日常记账不该多点一下');
assert.strictEqual(new Set(list.map(c => c.code)).size, 30, '货币代码不能重复');
assert.ok(list.every(c => /^[A-Z]{3}$/.test(c.code)), '代码必须是三个大写字母');
assert.ok(list.every(c => c.name && c.name.length <= 4),
  '中文名不超过 4 字，否则下拉框在手机上会被截断');

console.log('✅ currency list OK');

// ── 换算 ──
// 28.448 → 28.45：这是 spec 验收标准里的那笔拉面
assert.strictEqual(convertToAud(3200, 0.00889), 28.45, '3200 JPY @ 0.00889 = 28.45');
assert.strictEqual(convertToAud(5000, 0.00889), 44.45, '改成 5000 JPY 应重算成 44.45');
assert.strictEqual(convertToAud(1, 1), 1, 'AUD 自己换自己');
assert.strictEqual(convertToAud(10, 0.1), 1, '整数结果不应带浮点尾巴');

// 下面这些必须返回 null 而不是 NaN——NaN 会一路写进数据库，是最难查的一类脏数据
assert.strictEqual(convertToAud(NaN, 0.5),  null, '金额 NaN 应返回 null');
assert.strictEqual(convertToAud(100, NaN),  null, '汇率 NaN 应返回 null');
assert.strictEqual(convertToAud(100, null), null, '汇率为 null 应返回 null');
assert.strictEqual(convertToAud(100, ''),   null, '汇率为空串应返回 null');
assert.strictEqual(convertToAud(100, 0),    null, '汇率为 0 应返回 null');
assert.strictEqual(convertToAud(0, 0.5),    null, '金额为 0 应返回 null');
assert.strictEqual(convertToAud(-5, 0.5),   null, '负金额应返回 null');
assert.strictEqual(convertToAud(undefined, undefined), null, '全空应返回 null');

console.log('✅ conversion OK');

// ── 缓存 key ──
assert.strictEqual(fxCacheKey('2026-08-04', 'JPY'), '2026-08-04|JPY');
assert.strictEqual(fxCacheKey('2026-08-04', 'jpy'), '2026-08-04|JPY', '大小写要归一，否则同一天同一币种会缓存两份');

console.log('✅ cache key OK');

// ── 原币格式化 ──
// currencyDisplay 用 code 不用 narrowSymbol：narrowSymbol 会把 USD 和 SGD
// 都渲染成 $，跟同一行旁边的澳币撞车，而 ¥ 在 JPY 和 CNY 之间也有歧义。
assert.strictEqual(fmtOrig(3200, 'JPY'),   'JPY 3,200',  '日元没有小数位');
assert.strictEqual(fmtOrig(12000, 'KRW'),  'KRW 12,000', '韩元没有小数位');
assert.strictEqual(fmtOrig(450.5, 'THB'),  'THB 450.50', '泰铢两位小数');
assert.strictEqual(fmtOrig(12.3, 'USD'),   'USD 12.30');
assert.strictEqual(fmtOrig(20, 'SGD'),     'SGD 20.00',  '新元不能显示成 $，会跟澳币撞');
assert.strictEqual(fmtOrig(88, 'CNY'),     'CNY 88.00',  '人民币不能显示成 ¥，会跟日元撞');
assert.strictEqual(fmtOrig(100, ''),       '',           '没有币种就不显示');
assert.strictEqual(fmtOrig(null, 'JPY'),   '',           '没有金额就不显示');
assert.strictEqual(fmtOrig(100, 'ZZZ'),    'ZZZ 100',    '非法币种代码不能让整行渲染抛错');

console.log('✅ orig formatting OK');

// ── 解析汇率 API 响应 ──
assert.deepStrictEqual(
  parseFxResponse({ amount:1.0, base:'JPY', date:'2026-07-31', rates:{ AUD:0.00889 } }),
  { rate:0.00889, date:'2026-07-31' });
assert.strictEqual(parseFxResponse({ rates:{} }),        null, '没有 AUD 这一项应返回 null');
assert.strictEqual(parseFxResponse({ rates:{ AUD:0 } }), null, '汇率为 0 是坏数据');
assert.strictEqual(parseFxResponse({}),                  null, '没有 rates 应返回 null');
assert.strictEqual(parseFxResponse(null),                null, 'null 不应抛错');
assert.strictEqual(parseFxResponse({ rates:{ AUD:'0.00889' } }), null, '字符串汇率视为坏数据');

console.log('✅ fx response parsing OK');

// ── 周末回退提示 ──
assert.strictEqual(fxNoteDate('2026-08-04', '2026-08-04'), null, '同一天不提示');
assert.strictEqual(fxNoteDate('2026-08-01', '2026-07-31'), '2026-07-31', '回退了要把真实日期报出来');
assert.strictEqual(fxNoteDate('2026-08-04', ''),           null, '响应没给日期就别瞎提示');

console.log('✅ weekend fallback note OK');

// ── 提交前校验 ──
const V = o => validateExpenseInput(Object.assign(
  { date:'2026-08-04', desc:'ramen', origAmount:3200, ccy:'JPY', rate:0.00889 }, o));

assert.strictEqual(V({}).ok, true, '齐全的输入应通过');
assert.strictEqual(V({ ccy:'AUD', rate:1 }).ok, true, 'AUD 也应通过');
assert.strictEqual(V({ date:'' }).ok,       false, '缺日期应拦下');
assert.strictEqual(V({ desc:'' }).ok,       false, '缺描述应拦下');
assert.strictEqual(V({ origAmount:0 }).ok,  false, '金额 0 应拦下');
assert.strictEqual(V({ origAmount:-3 }).ok, false, '负金额应拦下');
assert.strictEqual(V({ origAmount:NaN }).ok,false, '金额 NaN 应拦下');

// 这三条是「不产生 NaN 记录」这个验收标准的核心
assert.strictEqual(V({ rate:NaN }).ok, false, '外币但汇率为 NaN 必须拦下');
assert.strictEqual(V({ rate:'' }).ok,  false, '外币但汇率为空必须拦下');
assert.strictEqual(V({ rate:0 }).ok,   false, '外币但汇率为 0 必须拦下');
assert.ok(V({ rate:NaN }).error.includes('汇率'), '错误提示要指出是汇率的问题');

// AUD 不该被汇率卡住——它根本不用汇率
assert.strictEqual(V({ ccy:'AUD', rate:NaN }).ok, true, 'AUD 不看汇率');
assert.strictEqual(V({ ccy:'AUD', rate:'' }).ok,  true, 'AUD 不看汇率');

console.log('✅ input validation OK');

// ── 轮询签名 ──
// 只改原币、AUD 恰好没变的编辑，另一台设备也要能刷出来
const base = { id:1, amount:28.45, description:'ramen', type:'shared', date:'2026-08-04',
               orig_currency:'JPY', orig_amount:3200, fx_rate:0.00889 };
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base)), '同一条记录签名必须稳定');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:3300 })),
  '原币金额变了签名必须变');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_currency:'THB' })),
  '原币币种变了签名必须变');

// PostgREST 可能把 numeric 回成字符串，两边必须归一，否则每 15 秒无脑重渲染
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { amount:'28.45' })),
  '字符串和数字形态的同一个金额必须同签名');
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:'3200' })),
  '字符串和数字形态的同一个原币金额必须同签名');

// 老数据：三列全 NULL
const old = { id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22',
              orig_currency:null, orig_amount:null, fx_rate:null };
assert.strictEqual(expenseSig(old), expenseSig(Object.assign({}, old)), '老数据签名也要稳定');
assert.strictEqual(
  expenseSig(old),
  expenseSig({ id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22' }),
  '三列缺失和三列为 null 必须同签名——否则老数据每 15 秒重渲染一次');

console.log('✅ polling signature OK');
console.log('\n全部通过 ✅');
```

- [ ] **Step 2: 跑一次，确认它失败**

这一步不是仪式。它是唯一能证明断言真的在测代码、而不是空转通过的方法（见 HANDOFF 第六节）。

```bash
node scripts/verify-fx-logic.js
```

期望：抛错退出，报 `TypeError: Cannot read properties of undefined (reading 'split')`——因为 `index.html` 里还没有 `// ── PURE LOGIC START ──` 这个标记，`split(...)[1]` 是 `undefined`。

**如果它通过了，说明脚本写错了，回去查。**

- [ ] **Step 3: 在 index.html 插入 PURE LOGIC 段**

在 `const toDB = e => ({...});` 那一行之后、`// ── Sync dot ──` 之前插入：

```js

// ── PURE LOGIC START ──
// 这一段不碰 DOM 也不碰网络。scripts/verify-fx-logic.js 会把它切出来 eval 跑断言，
// 是这个仓库里唯一能自动验证的部分。改这里请保持无副作用，加新函数就顺手加断言。
//
// ⚠️ 非严格模式的直接 eval 里只有 function 声明会跨出 eval 作用域，const/let 不会。
// 所以对外可见的东西一律写成 function；CURRENCIES 是 const，靠 currencyList() 的
// 闭包暴露出去。写成 const currencyList = () => ... 会让验证脚本直接报未定义。

// api.frankfurter.dev 支持的全部 30 种（欧央行口径）。AUD 置顶，后面按旅行常用度排，
// 剩下的按字母序。中文名限 4 字以内——下拉框在手机上只有 120px。
// ⚠️ 这里没有的币种（越南盾、新台币、迪拉姆…）走手填汇率那条路，不要往这个表里加
// 假条目，选中了却拉不到汇率反而更糟。
const CURRENCIES = [
  { code:'AUD', name:'澳元'   }, { code:'JPY', name:'日元'   },
  { code:'KRW', name:'韩元'   }, { code:'THB', name:'泰铢'   },
  { code:'SGD', name:'新元'   }, { code:'MYR', name:'林吉特' },
  { code:'IDR', name:'印尼盾' }, { code:'PHP', name:'比索'   },
  { code:'CNY', name:'人民币' }, { code:'HKD', name:'港币'   },
  { code:'USD', name:'美元'   }, { code:'NZD', name:'纽元'   },
  { code:'EUR', name:'欧元'   }, { code:'GBP', name:'英镑'   },
  { code:'CHF', name:'瑞郎'   }, { code:'CAD', name:'加元'   },
  { code:'BRL', name:'雷亚尔' }, { code:'CZK', name:'捷克'   },
  { code:'DKK', name:'丹麦'   }, { code:'HUF', name:'匈牙利' },
  { code:'ILS', name:'以色列' }, { code:'INR', name:'印度'   },
  { code:'ISK', name:'冰岛'   }, { code:'MXN', name:'墨西哥' },
  { code:'NOK', name:'挪威'   }, { code:'PLN', name:'波兰'   },
  { code:'RON', name:'罗马尼亚' }, { code:'SEK', name:'瑞典' },
  { code:'TRY', name:'土耳其' }, { code:'ZAR', name:'南非'   },
];
function currencyList() { return CURRENCIES; }

// 原币金额 × 汇率 → AUD，两位小数。任何一个参数不合法都返回 null 而不是 NaN——
// NaN 会一路写进数据库，是最难查的一类脏数据。
function convertToAud(origAmount, rate) {
  const a = Number(origAmount), r = Number(rate);
  if (!isFinite(a) || !isFinite(r) || a <= 0 || r <= 0) return null;
  return Math.round(a * r * 100) / 100;
}

function fxCacheKey(date, ccy) {
  return String(date) + '|' + String(ccy).toUpperCase();
}

// 原币显示。currencyDisplay 必须是 'code'：narrowSymbol 会把 USD 和 SGD 都渲染成
// $，跟同一行旁边的澳币撞车，而 ¥ 在日元和人民币之间也有歧义。
function fmtOrig(amount, ccy) {
  const a = Number(amount);
  if (!ccy || amount == null || !isFinite(a)) return '';
  try {
    return new Intl.NumberFormat('en-AU',
      { style:'currency', currency: ccy, currencyDisplay:'code' }).format(a);
  } catch (err) {
    return ccy + ' ' + a;    // 非法币种代码不该让整行渲染崩掉
  }
}

// frankfurter 的响应 → { rate, date } 或 null。date 是它实际给的那天，
// 周末和节假日会回退到上一个工作日。
function parseFxResponse(json) {
  if (!json || !json.rates) return null;
  const rate = json.rates.AUD;
  if (typeof rate !== 'number' || !isFinite(rate) || rate <= 0) return null;
  return { rate: rate, date: json.date || '' };
}

// 汇率取的不是你选的那天就返回真实日期，否则 null。不能闷声换掉——
// 用户后来对流水时会奇怪为什么汇率跟那天的不一样。
function fxNoteDate(requestedDate, actualDate) {
  if (!actualDate || actualDate === requestedDate) return null;
  return actualDate;
}

// 提交前校验。返回 { ok, error }，error 直接拿去 alert。
function validateExpenseInput(v) {
  if (!v.date) return { ok:false, error:'请填写日期' };
  if (!v.desc) return { ok:false, error:'请填写描述' };
  const amt = Number(v.origAmount);
  if (!isFinite(amt) || amt <= 0) return { ok:false, error:'请填写有效金额' };
  if (v.ccy && v.ccy !== 'AUD') {
    const r = Number(v.rate);
    if (!isFinite(r) || r <= 0) return { ok:false, error:'没查到汇率，请手动填写汇率' };
  }
  return { ok:true, error:'' };
}

// 15 秒轮询用它判断要不要重渲染。两边（数据库行 / toDB 的输出）都走这一个函数。
// 数字统一过 Number()：PostgREST 可能把 numeric 回成字符串，不归一的话
// "40.00" 和 40 会被当成不同记录，每 15 秒无脑重渲染一次。
function expenseSig(r) {
  const n = x => (x == null || x === '') ? '' : String(Number(x));
  return [r.id, n(r.amount), r.description, r.type, r.date,
          r.orig_currency || '', n(r.orig_amount)].join(':');
}
// ── PURE LOGIC END ──
```

- [ ] **Step 4: 跑验证脚本，确认全绿**

```bash
node scripts/verify-fx-logic.js
```

期望输出结尾是 `全部通过 ✅`，前面 8 行 `✅`。

- [ ] **Step 5: 确认没破坏 HTML 的 JS 解析**

```bash
python3 scripts/verify-refs.py 2>&1 | grep index.html
```

期望：`index.html           ['REST']`——和改动前一模一样（`REST` 是 `// ── Supabase REST (no SDK) ──` 这行注释的误报，一直都有）。
出现别的名字就去 grep 确认。

- [ ] **Step 6: 提交**

```bash
git add scripts/verify-fx-logic.js index.html
git commit -m "Add pure currency-conversion helpers behind assertions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 数据层映射（toLocal / toDB / 轮询签名）

三处必须一起改。漏一处就是一类静默 bug：漏 `toLocal` 则原币读不回来，漏 `toDB` 则轮询签名恒不相等、每 15 秒重渲染，漏 `sig` 则只改原币的编辑同步不过去。

**Files:**
- Modify: `index.html:662-663`（`toLocal` / `toDB`）
- Modify: `index.html:721-722`（轮询里的 `sig`）

- [ ] **Step 1: 替换 toLocal 和 toDB**

把这两行：

```js
const toLocal = r => ({ id: Number(r.id), date: r.date, amount: parseFloat(r.amount), desc: r.description, type: r.type });
const toDB    = e => ({ id: e.id, date: e.date, amount: e.amount, description: e.desc, type: e.type, cycle_id: activeCycle ? activeCycle.id : null });
```

替换成：

```js
// origCcy 为 null 表示这笔本来就是 AUD 记的（老数据三列全 NULL，不需要迁移）。
// amount 永远是换算后的 AUD——分账、账期结转、往期记录读的都是它，语义不能变。
const toLocal = r => ({
  id: Number(r.id), date: r.date, amount: parseFloat(r.amount),
  desc: r.description, type: r.type,
  origCcy:    r.orig_currency || null,
  origAmount: r.orig_amount == null ? null : parseFloat(r.orig_amount),
  fxRate:     r.fx_rate     == null ? null : parseFloat(r.fx_rate),
});
const toDB = e => ({
  id: e.id, date: e.date, amount: e.amount, description: e.desc, type: e.type,
  cycle_id: activeCycle ? activeCycle.id : null,
  orig_currency: e.origCcy    || null,
  orig_amount:   e.origAmount == null ? null : e.origAmount,
  fx_rate:       e.fxRate     == null ? null : e.fxRate,
});
```

- [ ] **Step 2: 换掉轮询里的签名**

把 `startPolling()` 里这一行：

```js
      const sig = d => d.map(r => `${r.id}:${r.amount}:${r.description}:${r.type}:${r.date}`).join('|');
```

替换成：

```js
      const sig = d => d.map(expenseSig).join('|');
```

`if (cycleChanged || sig(data) !== sig(expenses.map(toDB)))` 那一行不动。

- [ ] **Step 3: 确认解析没坏、引用没断**

```bash
node scripts/verify-fx-logic.js
python3 scripts/verify-refs.py 2>&1 | grep index.html
```

期望：前者 `全部通过 ✅`，后者仍是 `['REST']`。

- [ ] **Step 4: 手工验证轮询没有变成无脑重渲染**

这是本任务最容易出错的地方，必须实测。

```bash
python3 -m http.server 8765
```

浏览器开 `http://localhost:8765/index.html?v=1`，登录，然后开 DevTools Console 贴：

```js
let renders = 0; const _r = render; render = function(){ renders++; return _r.apply(this, arguments); };
setTimeout(() => console.log('60 秒内 render 次数:', renders), 60000);
```

**保持这个标签页在前台**（`startPolling` 用 `document.visibilityState !== 'visible'` 挡住后台轮询，切走了就是空转，测了等于没测——HANDOFF 第六节记过这个坑）。

期望：60 秒后打印 `0`。数据没变就不该重渲染。
如果打印 4（每 15 秒一次），说明签名两边不一致，回去查 `toDB` 是不是漏了字段。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "Carry the original currency through the data mapping layer

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 表单 UI（货币下拉 + 汇率行）

只加静态结构和样式，先不接逻辑。这一步结束时下拉是空的、汇率行不出现——都正常。

**Files:**
- Modify: `index.html:225-245` 附近（表单 CSS 之后追加）
- Modify: `index.html:441`（日期 input 加 onchange）
- Modify: `index.html:443-446`（金额那个 `.fgrp` 整块替换）

- [ ] **Step 1: 加 CSS**

在 `.seg input[type=radio]:checked + .seg-lbl { ... }` 这条规则之后、`.submit {` 之前插入：

```css
    .amt-row { display: grid; grid-template-columns: 1fr 120px; gap: 8px; }
    .ccy-select { appearance: none; -webkit-appearance: none; text-align: center; cursor: pointer; }
    .fx-box {
      display: none; margin-top: 8px; padding: 10px 12px;
      background: rgba(0,122,255,0.06); border: 1.5px solid rgba(0,122,255,0.18);
      border-radius: 11px;
    }
    .fx-box.on { display: block; }
    .fx-line { display: flex; align-items: center; gap: 6px; }
    .fx-lbl { font-size: 13px; color: var(--sub); white-space: nowrap; }
    .fx-input {
      flex: 1; min-width: 0; padding: 7px 9px; border: 1.5px solid var(--border);
      border-radius: 8px; font-size: 14px; font-family: inherit;
      background: var(--card); color: var(--text); outline: none;
    }
    .fx-input:focus { border-color: var(--accent); }
    .fx-refresh {
      background: none; border: none; cursor: pointer; color: var(--accent);
      font-size: 16px; padding: 2px 4px; line-height: 1;
    }
    .fx-refresh:disabled { opacity: 0.4; cursor: default; }
    .fx-note { font-size: 11px; color: var(--sub); margin-top: 5px; min-height: 14px; }
    .fx-note.err { color: var(--red); }
    .fx-preview { font-size: 15px; font-weight: 600; margin-top: 3px; }
```

- [ ] **Step 2: 日期 input 加 onchange**

把：

```html
      <input type="date" class="finput" id="f-date">
```

换成：

```html
      <input type="date" class="finput" id="f-date" onchange="onDateChange()">
```

- [ ] **Step 3: 替换金额那一块**

把：

```html
    <div class="fgrp">
      <label class="flabel">金额 (AUD)</label>
      <input type="number" class="finput" id="f-amount" placeholder="0.00" step="0.01" min="0.01" inputmode="decimal">
    </div>
```

换成：

```html
    <div class="fgrp">
      <label class="flabel">金额</label>
      <div class="amt-row">
        <input type="number" class="finput" id="f-amount" placeholder="0.00" step="0.01" min="0.01" inputmode="decimal" oninput="onAmountInput()">
        <select class="finput ccy-select" id="f-ccy" onchange="onCcyChange()"></select>
      </div>
      <!-- 选了非 AUD 才展开。汇率格永远可以手改：现金换汇的实际汇率跟欧央行
           中间价差不少，而且这也是不支持币种（越南盾、新台币）的唯一入口。 -->
      <div class="fx-box" id="fx-box">
        <div class="fx-line">
          <span class="fx-lbl">1 <span id="fx-ccy">—</span> =</span>
          <input type="number" class="fx-input" id="f-rate" step="any" min="0" inputmode="decimal" oninput="onRateInput()">
          <span class="fx-lbl">AUD</span>
          <button type="button" class="fx-refresh" id="fx-refresh" onclick="refreshRate()" title="重新获取汇率">↻</button>
        </div>
        <div class="fx-note" id="fx-note"></div>
        <div class="fx-preview" id="fx-preview">≈ A$—</div>
      </div>
    </div>
```

标签从「金额 (AUD)」改成「金额」是有意的——币种现在由旁边的下拉决定，写死 AUD 会自相矛盾。

- [ ] **Step 4: 确认页面没被改坏**

```bash
python3 -m http.server 8765
```

开 `http://localhost:8765/index.html?v=2`，登录，点右下角 `+`。

期望：表单出现，金额栏右边有一个**空的**下拉框，汇率行不显示。Console 会报 `onCcyChange is not defined` 之类——**现在这样是对的**，逻辑在 Task 4/5 才接上。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "Add the currency picker and exchange-rate row to the form

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 汇率获取与 localStorage 缓存

**Files:**
- Modify: `index.html`（在 `// ── PURE LOGIC END ──` 之后、`// ── Sync dot ──` 之前插入新段）

- [ ] **Step 1: 插入 FX 段**

```js

// ── FX rates ──
// ⚠️ 这是第三方 API，不是 Supabase。**绝对不要给它带 await H()**——
// 那会把登录令牌泄露给 frankfurter.dev。整个仓库只有这一处 fetch 不带 H()。
const FX_API   = 'https://api.frankfurter.dev/v1';   // 旧域名 .app 现在 301 跳转，别用
const FX_CACHE = 'hh_fx';
const CCY_KEY  = 'hh_last_ccy';

function fxCacheRead() {
  try { return JSON.parse(localStorage.getItem(FX_CACHE) || '{}'); } catch (e) { return {}; }
}
// 历史汇率不可变，所以缓存零风险、只增不删。一年几百个 key、几 KB，不用做淘汰。
function fxCacheGet(date, ccy) {
  const v = fxCacheRead()[fxCacheKey(date, ccy)];
  return typeof v === 'number' ? v : null;
}
function fxCacheSet(date, ccy, rate) {
  const c = fxCacheRead();
  c[fxCacheKey(date, ccy)] = rate;
  try { localStorage.setItem(FX_CACHE, JSON.stringify(c)); } catch (e) {}
}

// 返回 { rate, date } 或 null。date 是 API 实际给的那天。
async function fetchRate(date, ccy) {
  const r = await fetch(`${FX_API}/${date}?base=${encodeURIComponent(ccy)}&symbols=AUD`);
  if (!r.ok) throw new Error('fx ' + r.status);
  return parseFxResponse(await r.json());
}

// 上次用的货币。存的值可能是老版本留下的、现在不在表里的代码，所以要校验。
function lastCcy() {
  const c = localStorage.getItem(CCY_KEY);
  return currencyList().some(x => x.code === c) ? c : 'AUD';
}

function fillCurrencySelect() {
  document.getElementById('f-ccy').innerHTML =
    currencyList().map(c => `<option value="${c.code}">${c.code} ${c.name}</option>`).join('');
}
```

- [ ] **Step 2: 开局填充下拉**

在 `initApp()` 里，把：

```js
async function initApp() {
  showLoading(true);
  loadCfg();
```

改成：

```js
async function initApp() {
  showLoading(true);
  fillCurrencySelect();
  loadCfg();
```

- [ ] **Step 3: 在浏览器里实测取汇率和缓存**

```bash
python3 -m http.server 8765
```

开 `http://localhost:8765/index.html?v=3`，登录，Console 里贴：

```js
localStorage.removeItem('hh_fx');
await fetchRate('2026-08-04', 'JPY');
```

期望：返回 `{rate: 0.00889, date: '2026-08-04'}` 之类（汇率数值会随实际行情变，**关键是 rate 是个大于 0 的数、date 是个日期串**）。

再测周末回退：

```js
await fetchRate('2026-08-01', 'JPY');   // 2026-08-01 是周六
```

期望：`date` 字段是 `'2026-07-31'`（上一个工作日），不是 `'2026-08-01'`。

再测缓存读写：

```js
fxCacheSet('2026-08-04', 'JPY', 0.00889);
console.log(fxCacheGet('2026-08-04', 'JPY'));   // 0.00889
console.log(fxCacheGet('2026-08-04', 'jpy'));   // 0.00889（大小写归一）
console.log(fxCacheGet('2026-08-05', 'JPY'));   // null
console.log(localStorage.getItem('hh_fx'));     // {"2026-08-04|JPY":0.00889}
```

再测不支持的币种：

```js
try { await fetchRate('2026-08-04', 'VND'); } catch (e) { console.log('如期失败:', e.message); }
```

期望：抛错（`fx 404` 之类）。这条路在 Task 5 里会变成「请手动填写」提示。

- [ ] **Step 4: 确认引用没断**

```bash
python3 scripts/verify-refs.py 2>&1 | grep index.html
node scripts/verify-fx-logic.js
```

期望：`['REST']` 和 `全部通过 ✅`。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "Fetch daily rates from frankfurter.dev with a localStorage cache

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 表单联动

把下拉、日期、金额、汇率格串起来。

**Files:**
- Modify: `index.html`（在 Task 4 插入的 `// ── FX rates ──` 段末尾追加）

- [ ] **Step 1: 追加联动函数**

接在 `fillCurrencySelect()` 之后：

```js

// 慢请求可能在新请求之后才返回，会把新结果覆盖掉。每次发请求递增 fxSeq，
// 回来时对不上就丢弃。旅行时快速连点几个币种一定会撞上。
let fxSeq = 0;

function curCcy()  { return document.getElementById('f-ccy').value; }
function curRate() { return parseFloat(document.getElementById('f-rate').value); }

function setFxNote(text, isErr) {
  const el = document.getElementById('fx-note');
  el.textContent = text || '';
  el.classList.toggle('err', !!isErr);
}

// 展开/收起汇率行，返回当前是不是外币。
function syncFxBox() {
  const ccy = curCcy();
  const on  = !!ccy && ccy !== 'AUD';
  document.getElementById('fx-box').classList.toggle('on', on);
  document.getElementById('fx-ccy').textContent = ccy || '—';
  return on;
}

function updateFxPreview() {
  const amt = parseFloat(document.getElementById('f-amount').value);
  const aud = convertToAud(amt, curRate());
  document.getElementById('fx-preview').textContent =
    aud == null ? '≈ A$—' : `≈ A$${fmt(aud)}`;
}

// force = true 时跳过缓存重拉（↻ 按钮用）。
async function loadRate(force) {
  if (!syncFxBox()) { setFxNote(''); return; }
  const date = document.getElementById('f-date').value;
  const ccy  = curCcy();
  if (!date) return;

  const cached = force ? null : fxCacheGet(date, ccy);
  if (cached != null) {
    document.getElementById('f-rate').value = cached;
    setFxNote(''); updateFxPreview(); return;
  }

  const seq = ++fxSeq;
  const btn = document.getElementById('fx-refresh');
  btn.disabled = true;
  setFxNote('正在获取汇率…');
  try {
    const res = await fetchRate(date, ccy);
    if (seq !== fxSeq) return;
    if (!res) throw new Error('no rate');
    fxCacheSet(date, ccy, res.rate);
    document.getElementById('f-rate').value = res.rate;
    const noteDate = fxNoteDate(date, res.date);
    setFxNote(noteDate ? `取的是 ${noteDate} 的收盘价（当天休市）` : '');
  } catch (err) {
    if (seq !== fxSeq) return;
    console.error(err);
    document.getElementById('f-rate').value = '';
    setFxNote(`没查到 ${ccy} 的汇率，请手动填写`, true);
  } finally {
    // finally 在提前 return 时也会跑，但只有最新那次请求才该动 UI
    if (seq === fxSeq) { btn.disabled = false; updateFxPreview(); }
  }
}

function onCcyChange()   { localStorage.setItem(CCY_KEY, curCcy()); loadRate(false); }
function onDateChange()  { loadRate(false); }
function onAmountInput() { updateFxPreview(); }
function onRateInput()   { setFxNote(''); updateFxPreview(); }
function refreshRate()   { loadRate(true); }
```

- [ ] **Step 2: 实测联动**

```bash
python3 -m http.server 8765
```

开 `http://localhost:8765/index.html?v=4`，登录，Console 先清缓存 `localStorage.removeItem('hh_fx')`，然后点 `+`：

| 操作 | 期望 |
|---|---|
| 下拉选 JPY | 汇率行展开、带浅蓝底色，「1 JPY =」后面自动填上汇率 |
| 金额输 3200 | 下面显示 `≈ A$28.xx`（数值随行情） |
| 金额改 100 | 变成 `≈ A$0.89` 左右——这就是防误记的那道视觉防线 |
| 下拉选回 AUD | 汇率行整个收起 |
| 再选 JPY | 立刻填上汇率，**Network 面板没有新请求**（命中缓存） |
| 点 ↻ | 发新请求，汇率行短暂显示「正在获取汇率…」 |
| 日期改成 2026-08-01（周六） | 提示「取的是 2026-07-31 的收盘价（当天休市）」 |
| 手改汇率格成 0.01，金额 3200 | 显示 `≈ A$32.00`，提示文字清空 |

再测拉不到的情况——Console 里临时把 API 打歪：

```js
const _f = fetchRate; fetchRate = async () => { throw new Error('boom'); };
```

然后切一下货币。期望：汇率格被清空，红字「没查到 XXX 的汇率，请手动填写」，`≈ A$—`。手工填个数字进去，预览恢复。

测完还原：`fetchRate = _f;`

- [ ] **Step 3: 确认引用没断**

```bash
python3 scripts/verify-refs.py 2>&1 | grep index.html
node scripts/verify-fx-logic.js
```

期望：`['REST']` 和 `全部通过 ✅`。

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "Wire the currency picker, date and amount to the rate row

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: openAdd / openEdit 回填

**Files:**
- Modify: `index.html:831-854`（`openAdd` 和 `openEdit`）

- [ ] **Step 1: 替换 openAdd**

```js
function openAdd() {
  editingId = null;
  document.getElementById('f-date').value   = new Date().toISOString().split('T')[0];
  document.getElementById('f-amount').value = '';
  document.getElementById('f-desc').value   = '';
  document.getElementById('ft-shared').checked = true;
  // 记住上次用的货币：旅行中连记 20 笔不用每次切。代价是回国后第一笔 AUD
  // 容易忘了切回去——防线是汇率行的底色和实时的「≈ A$」数字。
  // 用户明确接受这个取舍，别自作主张改成「隔天自动重置」之类的聪明逻辑。
  document.getElementById('f-ccy').value  = lastCcy();
  document.getElementById('f-rate').value = '';
  setFxNote('');
  document.getElementById('add-sheet-title').textContent = '添加开支';
  document.getElementById('add-submit-btn').textContent  = '添加';
  document.getElementById('add-overlay').classList.add('open');
  loadRate(false);
  setTimeout(() => document.getElementById('f-amount').focus(), 350);
}
```

- [ ] **Step 2: 替换 openEdit**

```js
function openEdit(id) {
  const e = expenses.find(x => x.id === id);
  if (!e) return;
  editingId = id;
  document.getElementById('f-date').value   = e.date;
  document.getElementById('f-ccy').value    = e.origCcy || 'AUD';
  // 外币记录回填的是原币金额，不是换算后的 AUD
  document.getElementById('f-amount').value = e.origCcy ? e.origAmount : e.amount;
  document.getElementById('f-rate').value   = e.origCcy ? e.fxRate : '';
  document.getElementById('f-desc').value   = e.desc;
  document.querySelector(`input[name="ftype"][value="${e.type}"]`).checked = true;
  setFxNote('');
  // 只开合面板，**不重新拉汇率**——那笔账当时用的就是存下来的这个，
  // 重拉会无声改掉已经记好的账。改了日期或货币才会触发重拉。
  syncFxBox();
  updateFxPreview();
  document.getElementById('add-sheet-title').textContent = '编辑开支';
  document.getElementById('add-submit-btn').textContent  = '保存修改';
  document.getElementById('add-overlay').classList.add('open');
  setTimeout(() => document.getElementById('f-amount').focus(), 350);
}
```

- [ ] **Step 3: 实测**

开 `http://localhost:8765/index.html?v=5`，登录。

| 操作 | 期望 |
|---|---|
| 点 `+` | 货币是上次用的那个（第一次是 AUD，汇率行收起） |
| 选 JPY，关掉，再点 `+` | 货币仍是 JPY，汇率自动填好 |
| Console 跑 `localStorage.setItem('hh_last_ccy','ZZZ')` 再点 `+` | 回落到 AUD，不报错也不留空下拉 |
| 编辑一条已有的 AUD 记录 | 金额是 AUD 数值，汇率行收起 |

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "Remember the last currency and refill it when editing

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: submitExpense 写库

**Files:**
- Modify: `index.html:857-878`（`submitExpense`）

- [ ] **Step 1: 整个替换 submitExpense**

```js
async function submitExpense() {
  const date  = document.getElementById('f-date').value;
  const desc  = document.getElementById('f-desc').value.trim();
  const type  = document.querySelector('input[name="ftype"]:checked').value;
  const ccy   = curCcy();
  const inAmt = parseFloat(document.getElementById('f-amount').value);
  const rate  = ccy === 'AUD' ? 1 : curRate();

  const v = validateExpenseInput({ date, desc, origAmount: inAmt, ccy, rate });
  if (!v.ok) { alert(v.error); return; }

  // amount 永远是 AUD。origCcy 为 null 表示这笔本来就是 AUD 记的。
  const amount     = ccy === 'AUD' ? inAmt : convertToAud(inAmt, rate);
  const origCcy    = ccy === 'AUD' ? null  : ccy;
  const origAmount = ccy === 'AUD' ? null  : inAmt;
  const fxRate     = ccy === 'AUD' ? null  : rate;
  // 校验已经拦过一层，这里是最后一道闸——NaN 写进数据库比报错难查得多
  if (amount == null || amount <= 0) { alert('金额换算失败，请检查金额和汇率'); return; }

  const row = { date, amount, description: desc, type,
                orig_currency: origCcy, orig_amount: origAmount, fx_rate: fxRate };

  const btn = document.getElementById('add-submit-btn');
  btn.disabled = true; setSyncDot('busy');
  try {
    if (editingId !== null) {
      await dbUpdate(editingId, row);
      const idx = expenses.findIndex(x => x.id === editingId);
      if (idx !== -1) expenses[idx] = { id: editingId, date, amount, desc, type, origCcy, origAmount, fxRate };
    } else {
      const newId = Date.now();
      await dbInsert({ id: newId, ...row, cycle_id: activeCycle ? activeCycle.id : null });
      expenses.push({ id: newId, date, amount, desc, type, origCcy, origAmount, fxRate });
    }
    setSyncDot('ok'); render(); closeAdd();
  } catch(e) { console.error(e); setSyncDot('err'); }
  btn.disabled = false;
}
```

- [ ] **Step 2: 实测写库**

开 `http://localhost:8765/index.html?v=6`，登录。

1. 记一笔 AUD：金额 `12.50`、描述 `test-aud`、共同分担 → 保存成功，列表显示 `$12.50`
2. 记一笔外币：日期 `2026-08-04`、`3200` JPY、描述 `test-jpy` → 保存成功，列表显示的是**换算后的 AUD**（原币小字要等 Task 8）
3. 拦 NaN：选 JPY，**手工清空汇率格**，填金额和描述，点「添加」→ 弹出「没查到汇率，请手动填写汇率」，**没有新记录产生**

数据库里核对（先让用户跑 `python3 scripts/get-token.py`）：

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/expenses?select=description,amount,orig_currency,orig_amount,fx_rate&description=like.test-*" \
  -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" \
  -H "Authorization: Bearer $(cat .token)"
```

期望：
- `test-aud` 的 `orig_currency` / `orig_amount` / `fx_rate` **全是 null**
- `test-jpy` 的三列有值，且 `amount ≈ orig_amount × fx_rate`（两位小数）
- **没有任何一条 `amount` 是 null 或 NaN**

- [ ] **Step 3: 实测编辑**

编辑那条 `test-jpy`，把金额从 3200 改成 5000（**不动日期和货币**），保存。

期望：`fx_rate` 不变，`amount` 按同一个汇率重算。再 curl 一次核对。

- [ ] **Step 4: 清掉测试数据**

```bash
curl -s -X DELETE "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/expenses?description=like.test-*" \
  -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" \
  -H "Authorization: Bearer $(cat .token)"
```

跑完刷新页面确认那两条没了。**跑之前先看一眼上面那条 select 的输出，确认 `like.test-*` 只匹配到你刚建的那两条**——这是个删除操作，匹配过宽会删掉真实账目。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "Convert to AUD on submit and persist the original amount

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 列表显示原币

`itemRowHtml()` 是当期列表和往期记录详情共用的（两边都走 `groupedListHtml`），所以改一处两边都有。

**Files:**
- Modify: `index.html:791-810`（`itemRowHtml`）

- [ ] **Step 1: 改 itemRowHtml**

把：

```js
  const amtTxt   = e.type === 'partner_paid' ? `−$${fmt(e.amount)}` : `$${fmt(e.amount)}`;
  const shareTxt = e.type === 'shared' ? `各付 $${fmt(e.amount/2)}` : e.type === 'partner_personal' ? '全额抵扣' : '全额增加';
```

换成：

```js
  const amtTxt   = e.type === 'partner_paid' ? `−$${fmt(e.amount)}` : `$${fmt(e.amount)}`;
  const shareTxt = e.type === 'shared' ? `各付 $${fmt(e.amount/2)}` : e.type === 'partner_personal' ? '全额抵扣' : '全额增加';
  // 只有外币记录才多这一段。AUD 记的行显示和以前一模一样。
  const origTxt  = e.origCcy ? fmtOrig(e.origAmount, e.origCcy) : '';
  const subTxt   = origTxt ? `${origTxt} · ${shareTxt}` : shareTxt;
```

再把下面这一行：

```js
          <div class="item-share">${shareTxt}</div>
```

换成：

```js
          <div class="item-share">${subTxt}</div>
```

- [ ] **Step 2: 实测**

开 `http://localhost:8765/index.html?v=7`，登录，记一笔 `3200 JPY` 描述 `test-disp`。

期望那一行长这样：

```
test-disp                    $28.45
共同分担          JPY 3,200 · 各付 $14.23
```

同时确认：
- 原有的 AUD 记录**一个字都没变**（还是 `各付 $x.xx`，没有多余的 `·`）
- 把浏览器窗口收窄到 375px（iPhone 宽度），那行小字换行也不会撑破卡片
- hero 大数字、三类合计仍然只有 AUD

再确认往期记录：打开左侧抽屉 → 任一往期账期 → 里面的行同样规则渲染。（如果还没有含外币的归档账期，可以先跳过，最后一个任务的验收清单里会再走一遍。）

测完删掉 `test-disp` 那条（页面上点 × 即可）。

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "Show the original currency next to the AUD amount

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 让 verify-refs.py 也扫内联事件属性

这次新加了 6 个内联处理器（`onDateChange` / `onAmountInput` / `onCcyChange` / `onRateInput` / `refreshRate`，加上原有的一堆 `onclick`），而 `source()` 对 `.html` 只抽 `<script>` 的内容，标签上的 `on*=` 完全在扫描范围外。补上这个缺口。

**Files:**
- Modify: `scripts/verify-refs.py:25-30`（`source()`）

- [ ] **Step 1: 扩 source()**

把：

```python
def source(path):
    s = open(path, encoding='utf-8').read()
    if not path.endswith('.js'):
        # 只取内联 <script>，带 src 的是另一个文件
        s = '\n'.join(re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S))
    return s
```

换成：

```python
def source(path):
    s = open(path, encoding='utf-8').read()
    if not path.endswith('.js'):
        # 只取内联 <script>，带 src 的是另一个文件
        scripts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)
        # 再加上标签上的内联事件属性：onclick="openAdd()" 这类调用不在 <script>
        # 里，光扫脚本体是看不见的。少一个 handler 定义就是点了没反应的哑按钮。
        handlers = re.findall(r'\son\w+\s*=\s*"([^"]*)"', s)
        s = '\n'.join(scripts + handlers)
    return s
```

- [ ] **Step 2: 跑一次，确认 baseline 没变差**

```bash
python3 scripts/verify-refs.py
```

期望：`index.html` 那行**仍然只有 `['REST']`**。

`REST` 是 `// ── Supabase REST (no SDK) ──` 这行注释的已知误报，一直都有。
**多出来的任何名字都要逐个 grep 确认**——是代码就是真 bug（这次改动漏了个函数定义），是文案里的英文单词就无视。另外三个页面的名单也可能变长，同样逐个确认。

- [ ] **Step 3: 反向验证——确认它真能抓到断裂**

先让它失败一次，证明扩的这段真的在扫，而不是空转。

临时把 `index.html` 里的 `onclick="refreshRate()"` 改成 `onclick="refreshRateTypo()"`，然后：

```bash
python3 scripts/verify-refs.py 2>&1 | grep index.html
```

期望：名单里出现 `refreshRateTypo`。

**看到它之后立刻改回来**，再跑一次确认回到 `['REST']`。

- [ ] **Step 4: 提交**

```bash
git add scripts/verify-refs.py
git commit -m "Scan inline on*= handlers in verify-refs.py

Calls written on the tag, not inside <script>, were invisible to it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 10: 全量验证、更新 HANDOFF、上线

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: 跑全部四个检查**

```bash
node scripts/verify-fx-logic.js
node scripts/verify-recipe-logic.js
python3 scripts/verify-refs.py
node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("ok")'
```

期望：第一个 `全部通过 ✅`，第二个一串 `✅`，第三个 `index.html` 是 `['REST']`，第四个 `ok`。

**四个全绿之前不要往下走。** 任何一个红了就回去修，不要靠"应该没问题"推进。

- [ ] **Step 2: 走一遍 spec 的验收清单**

开 `http://localhost:8765/index.html?v=8`，登录，逐条对。**每条都要实际点一遍，不要凭代码推断。**

| # | 验收项 | 通过 |
|---|---|---|
| 1 | 日常记 AUD 的流程和改动前一致（汇率行不出现） | ☐ |
| 2 | 选 JPY 输 3200 → 表单 `≈ A$xx.xx`，保存后列表 `$xx.xx` 和 `JPY 3,200` | ☐ |
| 3 | 同一天再记一笔 JPY，Network 面板没有新的 frankfurter 请求 | ☐ |
| 4 | 日期选周六 → 标出实际取的是哪天的收盘价 | ☐ |
| 5 | 汇率拉不到 → 提示手填，填完能正常保存 | ☐ |
| 6 | 汇率为空时点「添加」→ 被挡住，不产生 NaN 记录 | ☐ |
| 7 | 编辑那笔 JPY → 回填原币金额/货币/汇率，不发网络请求 | ☐ |
| 8 | 改成 5000 JPY 保存 → amount 按原汇率重算，fx_rate 不变 | ☐ |
| 9 | 归档账期 → 往期记录里那笔仍显示原币 | ☐ |
| 10 | 两台设备（或两个浏览器窗口）开着，A 改原币但 AUD 不变 → B 在 15 秒内刷出新原币 | ☐ |
| 11 | `node scripts/verify-fx-logic.js` 全绿 | ☐ |
| 12 | 删掉一笔外币记录再点「撤销操作」→ 恢复出来的行原币小字还在 | ☐ |

第 12 条走的是 `confirmDel` → `toDB(e)` → `dbInsert` → `toLocal(...)` 这条往返路径，Task 2 的两个映射函数任何一边漏字段，撤销回来的记录都会丢掉原币。**这条不能只看列表，要刷新一次页面**，确认数据库里也真的带着那三列。

第 9 条要真的归档一期。**这会动真实账目**，做之前先问用户愿不愿意，或者等他下次正常结算时顺带验。不愿意就跳过并在交付说明里写清楚这条没验。

第 10 条的做法：两个浏览器窗口都登录并保持前台（后台标签页轮询是空转的），在 A 窗口编辑一笔外币记录、只改原币金额到一个折算后 AUD 恰好相同的数值不容易凑，**改成随便一个不同的原币金额即可**——重点是验证 B 能刷新且原币小字跟着变。

- [ ] **Step 3: 更新 HANDOFF**

在 `docs/HANDOFF.md` 的「三、数据模型」那段 `recipes / ingredient_vocab / ...` 代码块里补上 expenses（现在那里没有记账相关的表），并在「八、下一步建议顺序」的已完成列表里加一条。

在第三节的代码块末尾追加：

```
expenses
  id, date, amount(AUD), description, type, cycle_id,
  orig_currency, orig_amount, fx_rate    ← 2026-08-04 加的外币三列
```

在第三节「三条不能破的约定」后面追加第 4 条：

```markdown
4. **`expenses.amount` 永远是 AUD。** 2026-08-04 加了外币支持，但换算在写入时就做完了——
   `orig_currency` / `orig_amount` / `fx_rate` 只是留痕，三列全 NULL 表示这笔本来就是
   AUD 记的。**任何汇总都不许从 `orig_amount` 现算**，否则汇率一变历史账目就会漂。
   汇率走 `api.frankfurter.dev`（浏览器直连、CORS 开放、无 key、按日期查历史），
   缓存在 localStorage `hh_fx`。**这个 fetch 不带 `H()`**——它是第三方 API，
   带上等于把登录令牌送出去。
```

在第八节末尾把「目前没有待办」那两句之前加一行：

```markdown
6. ~~外币开支按记账日汇率折算~~ ✅ 2026-08-04 完成。见
   `docs/superpowers/specs/2026-08-04-multi-currency-expense-design.md`。
```

- [ ] **Step 4: 提交并推送上线**

```bash
git add docs/HANDOFF.md
git commit -m "Record the multi-currency work in the handoff

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 5: 确认线上真的是新版**

推完等 1–2 分钟，然后：

```bash
curl -s "https://tianshuuu.github.io/household-exp/index.html?cb=$(date +%s)" | grep -c 'frankfurter'
```

期望：`2`（`FX_API` 常量一处 + 注释里提到旧域名一处）。返回 `0` 说明还没生效，**等 10 分钟再试**——GitHub Pages 给 HTML 设的是 `max-age=600`。

最后在手机上开一次线上页面，点 `+`，确认货币下拉出得来。**手机上要加个 cache-buster**：`https://tianshuuu.github.io/household-exp/index.html?x=1`。

---

## 收尾说明

这次改动**没有停机窗口**，跟 2026-08-03 上 Auth 那次不一样：新列可空，10 分钟 CDN 缓存期内手机上的旧页面读到带原币的行也只是不显示那行小字，`amount` 和分账照样正确。所以 SQL 和代码两步之间不用等。

**没碰 `assets/`，所以四个页面的 `?v=` 都不用 bump。**
