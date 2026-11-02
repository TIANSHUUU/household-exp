# 租金自动记账 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把租金从「每个账期加一次的公式项」改成「每月自动生成的真实开支行」，并删掉归档功能，让账单变成一本持续累加的应收账款。

**Architecture:** 租金成为 `type='partner_paid'` 的普通开支，`id` 用 `YYYYMMDD` 整数所以补登天然幂等（主键冲突即跳过，不需要任何「补到哪了」的状态记录）。页面加载时扫描「最后一笔房租行日期」到今天之间的租金日，缺的补上。`calc()` 的数学抽成 PURE LOGIC 段里的纯函数以便断言。租金金额和租金日搬进 `cycles` 表，因为 `cfg` 存在 localStorage 是每台设备各一份的。

**Tech Stack:** 纯静态 HTML + 内联 JS，无构建步骤，无测试框架。唯一的自动化验证是 PURE LOGIC 段 + `scripts/verify-*.js` 的 `assert` 断言。

**Spec:** `docs/superpowers/specs/2026-11-02-rent-as-expense-design.md`

---

## 开工前必读

**PURE LOGIC 段是用 `eval` 提取的，非严格模式下只有 `function` 声明能跨出作用域，`const`/`let` 不行。** 新加的纯函数必须写成 `function foo() {}`，不能写成 `const foo = () => {}`，否则 `scripts/verify-fx-logic.js` 里会报 `foo is not defined`。

**断言先让它失败一次再改对。** 这是仓库规矩（CLAUDE.md），也是唯一能证明断言真在测代码而不是空转通过的办法。

**改了 `assets/` 下任何文件要 bump 四个页面的 `?v=`。** 本计划只改 `index.html`，不涉及 `assets/`，所以**不需要 bump**。

---

## 文件结构

| 文件 | 改什么 |
|---|---|
| `index.html` | 全部代码改动都在这。PURE LOGIC 段加 4 个纯函数；`calc()` 改为调用纯函数；新增 `ensureRentRows()`；`loadExpenses()` 挂钩；`itemRowHtml()` 隐藏房租行删除键；汇总卡片去掉租金行；删除 `newCycle()` 和设置里的账期块 |
| `scripts/verify-fx-logic.js` | 加新纯函数的断言 |
| `docs/HANDOFF.md` | 第八节待办状态、新增小节说明租金机制 |
| Supabase 控制台 | 一条 `alter table`（用户操作，Task 0） |

---

## Task 0: 数据库加两列（用户在控制台操作）

**这一步必须先做，否则 Task 4 写设置会 400。**

- [ ] **Step 1: 用户在 Supabase SQL Editor 跑这段**

```sql
alter table public.cycles
  add column if not exists rent_amount numeric,
  add column if not exists rent_day    integer;

update public.cycles
   set rent_amount = 1250, rent_day = 22
 where status = 'active' and rent_amount is null;
```

- [ ] **Step 2: 验证**

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/cycles?status=eq.active&select=id,start_date,rent_amount,rent_day" \
  -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" \
  -H "Authorization: Bearer sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5"
```

期望：`[{"id":5,"start_date":"2026-08-24","rent_amount":1250,"rent_day":22}]`

---

## Task 1: 纯函数 `rentRowId()` 和 `isRentRow()`

**Files:**
- Modify: `index.html`（PURE LOGIC 段，`// ── PURE LOGIC END ──` 之前）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 `scripts/verify-fx-logic.js` 末尾 `console.log('\n全部通过 ✅');` 之前）**

```js
// ── 房租行 id ──
// id 用日期派生的理由见 index.html 里 rentRowId 定义处的注释：现有 id 只有
// Date.now() 的 13 位毫秒戳和种子数据的 1–19 两种来源，8 位日期 id 和两者
// 都不会撞，所以重复插入必然违反主键约束 —— 补登的幂等性是白送的。
assert.strictEqual(rentRowId('2026-09-22'), 20260922, '日期转成 8 位整数 id');
assert.strictEqual(rentRowId('2026-10-22'), 20261022, '跨月');
assert.strictEqual(rentRowId('2027-01-05'), 20270105, '个位数月日要补零');

// isRentRow 必须能把房租行和另外两种 id 区分开
assert.strictEqual(isRentRow({ id: 20260922 }), true,  '8 位日期 id 是房租行');
assert.strictEqual(isRentRow({ id: 1793592786771 }), false, 'Date.now() 毫秒戳不是');
assert.strictEqual(isRentRow({ id: 5 }), false, '种子数据的小 id 不是');
assert.strictEqual(isRentRow({ id: 19 }), false, '种子数据最大的 id 也不是');
assert.strictEqual(isRentRow({}), false, '没有 id 不是');
assert.strictEqual(isRentRow(null), false, 'null 不该抛异常');

console.log('✅ rent row id OK');
```

- [ ] **Step 2: 跑一次，确认它失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，报 `rentRowId is not defined`

- [ ] **Step 3: 在 `index.html` 的 PURE LOGIC 段末尾（`// ── PURE LOGIC END ──` 那行之前）加实现**

```js
// 房租行的 id 用日期派生：'2026-09-22' → 20260922。
//
// 这么做是为了白拿幂等性。现有 id 只有两种来源：手动录入用 Date.now() 的
// 13 位毫秒戳，种子数据是 1–19。8 位的日期 id 和两者都不会撞，所以「补登
// 某个月的房租」重复执行时会直接违反主键约束而失败——**不需要任何「补到
// 哪了」的状态记录**，多设备同时打开也只会成功一个。
//
// 为什么不能用本地水位线：cfg 存在 localStorage（见 loadCfg），是每台设备
// 各一份的，任何基于它的「上次补到哪」在多设备下都会重复补登。
function rentRowId(dateStr) {
  return Number(String(dateStr).slice(0, 10).replace(/-/g, ''));
}

// 判断一笔开支是不是自动生成的房租行。靠 id 的量级区分：
// 房租 8 位（19000101–99991231），种子 1–19，手动录入 13 位。
function isRentRow(e) {
  const id = Number(e && e.id);
  return Number.isInteger(id) && id >= 19000101 && id <= 99991231;
}
```

- [ ] **Step 4: 跑断言，确认通过**

Run: `node scripts/verify-fx-logic.js`
Expected: PASS，输出含 `✅ rent row id OK`

- [ ] **Step 5: 提交**

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "租金记账：加 rentRowId / isRentRow 纯函数"
```

---

## Task 2: 纯函数 `rentDatesBetween()`

**Files:**
- Modify: `index.html`（PURE LOGIC 段）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 Task 1 的断言之后）**

```js
// ── 租金日序列 ──
// 区间是左开右闭 (after, to]。左端开是关键：after 要么是账期起始日
// （当天及以前属于上一期的结算范围），要么是最后一笔已存在房租行的日期
// （已经记过了）。两种情况都不能再记一次。
assert.deepStrictEqual(
  rentDatesBetween('2026-08-24', '2026-11-02', 22),
  ['2026-09-22', '2026-10-22'],
  '当前账期的真实场景：08-24 起到今天，应补 09-22 和 10-22 两笔');

assert.deepStrictEqual(rentDatesBetween('2026-09-22', '2026-11-02', 22), ['2026-10-22'],
  '已经补过 09-22 之后再跑，只剩 10-22');
assert.deepStrictEqual(rentDatesBetween('2026-10-22', '2026-11-02', 22), [],
  '全补完了就该是空的——这条就是幂等性');

// 左端点严格排除：租金日正好等于 after 当天时不能算进来，
// 否则和上一期重复计一个月租金（当前账期 start_date 和上一期 end_date
// 都是 2026-08-24，这不是巧合，归档时就是这么写的）
assert.deepStrictEqual(rentDatesBetween('2026-09-22', '2026-09-22', 22), [],
  'after 和 to 同一天且正好是租金日，必须为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-22', '2026-09-30', 22), ['2026-09-22'],
  'after 当天是租金日，只能从下个月开始');

// 右端点闭合：今天正好是租金日就要补
assert.deepStrictEqual(rentDatesBetween('2026-09-30', '2026-10-22', 22), ['2026-10-22'],
  'to 当天是租金日，要算进来');

// 月末钳制：租金日设成 31，2 月没有 31 号。必须落到当月最后一天，
// 不能跳过——跳过的话那个月的租金永远不进账。
assert.deepStrictEqual(rentDatesBetween('2027-01-01', '2027-03-05', 31),
  ['2027-01-31', '2027-02-28'],
  '2 月落到 28 号（2027 不是闰年）；3-31 超出 to 所以不在内');
assert.deepStrictEqual(rentDatesBetween('2028-01-31', '2028-02-29', 31), ['2028-02-29'],
  '闰年 2 月落到 29 号');
assert.deepStrictEqual(rentDatesBetween('2026-03-31', '2026-04-30', 31), ['2026-04-30'],
  '4 月只有 30 天');

// 跨年
assert.deepStrictEqual(rentDatesBetween('2026-11-30', '2027-01-31', 22),
  ['2026-12-22', '2027-01-22'], '跨年要连续');

// 坏输入一律返回空数组，绝不抛异常也绝不返回 undefined——
// 调用方会直接 .map()，返回 undefined 就是白屏
assert.deepStrictEqual(rentDatesBetween(null, '2026-11-02', 22), [], 'after 为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', null, 22), [], 'to 为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', 0),  [], '租金日 0 非法');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', 32), [], '租金日 32 非法');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', null), [], '租金日为空');
assert.deepStrictEqual(rentDatesBetween('2026-11-02', '2026-08-24', 22), [], 'to 早于 after');

console.log('✅ rent date sequence OK');
```

- [ ] **Step 2: 跑一次，确认它失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，报 `rentDatesBetween is not defined`

- [ ] **Step 3: 在 PURE LOGIC 段加实现（紧跟 `isRentRow` 之后）**

```js
// 列出 (afterDate, toDate] 区间内所有的「租金日」，升序。
//
// 左开右闭是刻意的：afterDate 要么是账期起始日（当天及以前属于上一期的
// 结算范围），要么是最后一笔已存在房租行的日期（已经记过了）。两种情况
// 都不能再记一次，所以左端必须排除。
//
// rentDay 超出当月天数时落到当月最后一天：设成 31 的话 2 月记 28/29 号。
// **不能跳过**——跳过的话那个月的租金就永远不进账了。
function rentDatesBetween(afterDate, toDate, rentDay) {
  const day = parseInt(rentDay, 10);
  if (!afterDate || !toDate) return [];
  if (!Number.isInteger(day) || day < 1 || day > 31) return [];

  const a = new Date(afterDate + 'T12:00:00');
  const b = new Date(toDate + 'T12:00:00');
  if (isNaN(a) || isNaN(b) || !(a < b)) return [];

  const out = [];
  let y = a.getFullYear(), m = a.getMonth();
  // 上限 600 个月 = 50 年，纯粹是防死循环的保险丝
  for (let guard = 0; guard < 600; guard++) {
    const lastDay = new Date(y, m + 1, 0).getDate();
    const d = new Date(y, m, Math.min(day, lastDay), 12);
    if (d > b) break;
    if (d > a) {
      out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    m++;
    if (m > 11) { m = 0; y++; }
  }
  return out;
}
```

- [ ] **Step 4: 跑断言，确认通过**

Run: `node scripts/verify-fx-logic.js`
Expected: PASS，输出含 `✅ rent date sequence OK`

- [ ] **Step 5: 提交**

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "租金记账：加 rentDatesBetween 纯函数"
```

---

## Task 3: 把 `calc()` 的数学抽成纯函数，去掉租金项

**这是整个改动里唯一直接改钱的一步。**

**Files:**
- Modify: `index.html`（PURE LOGIC 段加 `calcTotals`；`calc()` 在 930–939 行附近改为调用它）
- Test: `scripts/verify-fx-logic.js`

- [ ] **Step 1: 先写断言（加在 Task 2 的断言之后）**

```js
// ── 结算公式 ──
// 这是全仓库唯一直接决定钱的公式，原来没有任何断言。
// 2026-11-02 之前它长这样：carryover + cfg.myRent - shared/2 - pp + cp
// 那个 myRent 是「每个活跃账期加一次」，不是「每个月加一次」——账期跑了
// 2.3 个月也只加 1250，把宝宝欠款多算了 1250。详见 spec。
const rows = [
  { type: 'shared',           amount: 100 },   // 各付 50
  { type: 'partner_personal', amount: 30  },   // 我替宝宝垫，全额抵扣
  { type: 'partner_paid',     amount: 20  },   // 宝宝替我垫，全额增加
];
const t1 = calcTotals(rows, 0);
assert.strictEqual(t1.shared, 100, 'shared 汇总');
assert.strictEqual(t1.pp, 30, 'pp 汇总');
assert.strictEqual(t1.cp, 20, 'cp 汇总');
assert.strictEqual(t1.transfer, 0 - 50 - 30 + 20, 'transfer = carry - shared/2 - pp + cp');
assert.strictEqual(t1.transfer, -60, '展开算一遍防止上面那行写成恒等式');

// **公式里不能再有租金项。** 这条断言的存在就是为了钉死这件事：
// 如果有人把 myRent 加回来，房租既在 cp 里又在公式里，就是双重计算。
assert.strictEqual(calcTotals([], 0).transfer, 0,
  '空账 + 零结余 = 0。如果公式里还藏着租金项，这里会是 1250');

// 结余滚入
assert.strictEqual(calcTotals([], -6984.63).transfer, -6984.63, '没有开支时结余原样带过');

// 字符串金额（PostgREST 的 numeric 列回来可能是字符串）
assert.strictEqual(
  calcTotals([{ type: 'shared', amount: '100' }], '0').transfer, -50,
  '字符串金额和结余必须和数字一样算');

// 脏数据不能污染结果
assert.strictEqual(calcTotals([{ type: 'shared', amount: null }], 0).transfer, 0, 'null 金额当 0');
assert.strictEqual(calcTotals([{ type: 'unknown', amount: 999 }], 0).transfer, 0, '未知类型忽略');
assert.strictEqual(calcTotals(null, null).transfer, 0, '全空不抛异常');

// 线上真实数据回归：当前账期的实际汇总值（2026-11-02 取自数据库）
// shared/2 = 567.61, pp = 274.63, cp = 1109.96, carryover = -6984.63
// 旧公式（含 1250 租金）= -5466.91，新公式应为 -6716.91；
// 等两笔房租补进 cp 之后变成 -4216.91，正是 spec 里那个数。
//
// ⚠️ 用容差比，不要用 Math.round(x*100)/100 === -6716.91。
// 真实值是 -6716.905，正好卡在进位分界线上，round 的结果完全取决于浮点
// 表示落在哪一侧（实测是 -6716.905000000001 所以刚好进位成 -6716.91）。
// 那种断言能过是运气不是设计，换个输入就可能翻车。
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}（实际 ${a}）`);

const live = calcTotals(
  [{ type: 'shared', amount: 1135.21 }, { type: 'partner_personal', amount: 274.63 },
   { type: 'partner_paid', amount: 1109.96 }], -6984.63);
near(live.transfer, -6716.905, '去掉租金项后的裸值');

const withRent = calcTotals(
  [{ type: 'shared', amount: 1135.21 }, { type: 'partner_personal', amount: 274.63 },
   { type: 'partner_paid', amount: 1109.96 + 2500 }], -6984.63);
near(withRent.transfer, -4216.905,
  '两笔房租进 cp 之后 = 宝宝欠你 4216.91（显示值经 fmt 四舍五入），和 spec 对得上');

console.log('✅ settlement formula OK');
```

- [ ] **Step 2: 跑一次，确认它失败**

Run: `node scripts/verify-fx-logic.js`
Expected: FAIL，报 `calcTotals is not defined`

- [ ] **Step 3: 在 PURE LOGIC 段加实现（紧跟 `rentDatesBetween` 之后）**

```js
// 从开支列表和上期结余算出本期各项。抽成纯函数是为了能在
// scripts/verify-fx-logic.js 里断言——这是全仓库唯一直接决定钱的公式，
// 2026-11-02 之前它一条断言都没有。
//
// ⚠️ **公式里没有租金项，这是刻意的。** 2026-11-02 起租金是一条真实的
// partner_paid 开支（每月自动补登，见 ensureRentRows），已经包含在 cp 里。
// 再加一次 cfg.myRent 就是双重计算。
//
// 旧公式是 carryover + cfg.myRent - shared/2 - pp + cp，那个 myRent 按
// 「每个活跃账期一次」计，不是按月——账期跑了 2.3 个月也只加一笔，
// 把宝宝欠款多算了 1250 且每月增长。详见第十三节。
function calcTotals(rows, carryover) {
  let shared = 0, pp = 0, cp = 0;
  (rows || []).forEach(e => {
    const amt = parseFloat(e && e.amount) || 0;
    if      (e.type === 'shared')           shared += amt;
    else if (e.type === 'partner_personal') pp     += amt;
    else if (e.type === 'partner_paid')     cp     += amt;
  });
  const carry = parseFloat(carryover) || 0;
  return { shared, pp, cp, carryover: carry, transfer: carry - shared / 2 - pp + cp };
}
```

- [ ] **Step 4: 把 `calc()` 改成调用它**

把 `index.html` 里这一整段（930 行附近）：

```js
function calc() {
  let shared = 0, pp = 0, cp = 0;
  expenses.forEach(e => {
    if      (e.type === 'shared')           shared += e.amount;
    else if (e.type === 'partner_personal') pp     += e.amount;
    else if (e.type === 'partner_paid')     cp     += e.amount;
  });
  const carryover = activeCycle ? parseFloat(activeCycle.carryover || 0) : 0;
  return { shared, pp, cp, carryover, transfer: carryover + cfg.myRent - shared / 2 - pp + cp };
}
```

替换成：

```js
// 数学在 PURE LOGIC 段的 calcTotals 里，这里只负责把全局状态喂进去。
function calc() {
  return calcTotals(expenses, activeCycle ? activeCycle.carryover : 0);
}
```

⚠️ **`renderArchived()`（1240 行附近）里那份内联的同款计算不要动。** 历史账期当时确实是按含租金的旧公式结算的，`cyc.transfer` 是冻结值，改了明细就和结算额对不上。

- [ ] **Step 5: 跑断言和解析检查**

Run: `node scripts/verify-fx-logic.js`
Expected: PASS，输出含 `✅ settlement formula OK` 和末尾 `全部通过 ✅`

- [ ] **Step 6: 提交**

```bash
git add index.html scripts/verify-fx-logic.js
git commit -m "租金记账：结算公式抽成纯函数并去掉租金项"
```

---

## Task 4: 租金金额和租金日搬进数据库

**依赖 Task 0 已完成。**

**Files:**
- Modify: `index.html`（`loadExpenses()` 约 879 行、`saveSettings()` 约 1159 行、`dbUpdateCycle` 已存在）

- [ ] **Step 1: 在 `loadExpenses()` 里从活跃账期读配置**

在 `index.html` 的 `loadExpenses()` 中，`activeCycle = await dbGetActiveCycle();` 之后、`if (!activeCycle)` 之前插入一行调用；并在 `// ── Config ──` 区块（922 行附近）加这个函数：

```js
// 租金配置以数据库为准，localStorage 只是没读到时的兜底。
//
// 为什么必须搬进数据库：cfg 存在 localStorage，是**每台设备各一份的**。
// 租金从「显示用的公式参数」变成「写进数据库的真实金额」之后，两边不一致
// 就会出事——同一个月的租金记成多少，取决于谁先打开网页，而且因为 id
// 幂等，先写的那个值会永久固定下来。
function cfgFromCycle(c) {
  if (!c) return;
  if (c.rent_amount != null) cfg.myRent  = parseFloat(c.rent_amount);
  if (c.rent_day    != null) cfg.rentDay = parseInt(c.rent_day, 10);
  saveCfg();   // 同步一份到 localStorage，纯粹是下次打开时的首屏兜底
}
```

`loadExpenses()` 改成：

```js
    activeCycle = await dbGetActiveCycle();
    cfgFromCycle(activeCycle);
```

- [ ] **Step 2: 把 `saveSettings()` 改成写数据库**

替换 `index.html` 1159 行附近整个 `saveSettings()`：

```js
async function saveSettings() {
  const myRent  = parseFloat(document.getElementById('s-myrent').value);
  const rentDay = parseInt(document.getElementById('s-rentday').value);
  if (!myRent || !rentDay || rentDay < 1 || rentDay > 31) { alert('请填写有效的设置值'); return; }
  if (!activeCycle) { alert('账期尚未加载，请刷新页面重试'); return; }
  setSyncDot('busy');
  try {
    // 写数据库而不是只写 localStorage——两人两台设备必须看到同一个租金
    await dbUpdateCycle(activeCycle.id, { rent_amount: myRent, rent_day: rentDay });
    activeCycle.rent_amount = myRent;
    activeCycle.rent_day    = rentDay;
    cfg = { myRent, rentDay }; saveCfg();
    setSyncDot('ok');
    render();
    document.getElementById('set-overlay').classList.remove('open');
  } catch (e) { console.error(e); setSyncDot('err'); alert('保存失败，请检查网络后重试'); }
}
```

- [ ] **Step 3: 改设置面板的说明文字**

把 `index.html` 473 行附近这一行：

```html
      <div class="srow-lbl">我的租金份额<small>每月转给宝宝的基础金额</small></div>
```

改成：

```html
      <div class="srow-lbl">每月租金<small>每月自动记一笔「宝宝替我垫付」</small></div>
```

- [ ] **Step 4: 解析检查**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `ok`

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "租金记账：租金金额和租金日改为存数据库"
```

---

## Task 5: 补登 `ensureRentRows()`

**Files:**
- Modify: `index.html`（新增函数 + `loadExpenses()` 挂钩）

- [ ] **Step 1: 在 `loadExpenses()` 上方加这个函数**

```js
// 把「最后一笔房租行」到今天之间漏掉的房租补上。页面加载时调一次。
//
// 水位线取**已有房租行里最晚的那天**，没有才退回账期起始日。不能只看
// start_date：以后要是把租金日从 22 改成 25，就会去扫每月 25 号，而那个月
// 22 号已经有一笔了——同一个月记两次租金。
//
// 逐笔插入而不是批量：PostgREST 的批量插入是原子的，只要有一笔撞上主键
// （另一台设备刚补过），整批都会失败，于是永远补不进去。逐笔插入时失败的
// 那笔跳过，其余照常。
async function ensureRentRows() {
  if (!activeCycle || !activeCycle.start_date) return;
  const today = new Date().toISOString().split('T')[0];
  const rentDates = expenses.filter(isRentRow).map(e => e.date).sort();
  const after = rentDates.length ? rentDates[rentDates.length - 1] : activeCycle.start_date;
  const due = rentDatesBetween(after, today, cfg.rentDay);
  if (!due.length) return;

  for (const d of due) {
    try {
      const [row] = await dbInsert({
        id: rentRowId(d), date: d, amount: cfg.myRent,
        description: '房租', type: 'partner_paid', cycle_id: activeCycle.id,
      });
      expenses.push(toLocal(row));
    } catch (e) {
      // 主键冲突 = 另一台设备刚补过这个月，是正常情况不是错误
      console.warn('房租补登跳过', d, e.message);
    }
  }
  expenses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
}
```

- [ ] **Step 2: 在 `loadExpenses()` 里挂钩**

在 `loadExpenses()` 的 `try` 块中，`expenses = data.map(toLocal);` 之后、`setSyncDot('ok');` 之前加一行：

```js
    await ensureRentRows();
```

⚠️ 必须放在 `expenses` 已经填好之后——`ensureRentRows()` 要读 `expenses` 里已有的房租行来定水位线。

- [ ] **Step 3: 解析检查 + 全套断言**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")' && node scripts/verify-fx-logic.js | tail -2
```
Expected: `ok` 然后 `全部通过 ✅`

- [ ] **Step 4: 提交**

```bash
git add index.html
git commit -m "租金记账：页面加载时补登缺失的房租"
```

---

## Task 6: 房租行不显示删除按钮

**Files:**
- Modify: `index.html`（`itemRowHtml()`，约 982 行）

- [ ] **Step 1: 改 `itemRowHtml()` 里的 `actions`**

把这一段：

```js
  const actions  = readonly ? '' : `<div class="item-actions">
          <button class="edit-btn" onclick="openEdit(${e.id})" title="编辑">✎</button>
          <button class="del-btn"  onclick="askDel(${e.id})"  title="删除">×</button>
        </div>`;
```

改成：

```js
  // 房租行不给删除按钮：删掉之后下次加载会发现那个 id 不存在，于是
  // ensureRentRows 又补回来——一行删不掉的鬼行。改金额没问题，编辑保留
  // 原 id，不会触发补登。真要去掉某个月的房租就把金额改成 0。
  const actions  = readonly ? '' : `<div class="item-actions">
          <button class="edit-btn" onclick="openEdit(${e.id})" title="编辑">✎</button>
          ${isRentRow(e) ? '' : `<button class="del-btn"  onclick="askDel(${e.id})"  title="删除">×</button>`}
        </div>`;
```

- [ ] **Step 2: 解析检查**

```bash
node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `ok`

- [ ] **Step 3: 提交**

```bash
git add index.html
git commit -m "租金记账：房租行不显示删除按钮"
```

---

## Task 7: 汇总卡片去掉「我的租金份额」行

租金现在是一条普通开支，已经计在「宝宝替我垫付」里。留着这一行会让明细加起来对不上结算额。

**Files:**
- Modify: `index.html`（汇总卡片 markup 约 380 行、`renderSummary()` 约 972 行）

- [ ] **Step 1: 删掉 markup 里的租金行**

删除 `index.html` 380 行附近这三行：

```html
        <div class="brow">
          <span class="lbl"><span class="bdot" style="background:var(--accent)"></span>我的租金份额</span>
          <span class="val neutral" id="b-rent">—</span>
        </div>
```

- [ ] **Step 2: 删掉 `renderSummary()` 里对应的赋值**

删除这一行：

```js
  document.getElementById('b-rent').textContent          = `$${fmt(cfg.myRent)}`;
```

- [ ] **Step 3: 改掉「结算」这个措辞**

把 `renderSummary()` 里这一行：

```js
  document.getElementById('cycle-label').textContent = `本期账单（${cfg.rentDay}日结算）· 共 ${expenses.length} 笔`;
```

改成（不再有「结算」这个动作了，这是一本持续累加的应收账款）：

```js
  document.getElementById('cycle-label').textContent = `累计账单 · 共 ${expenses.length} 笔`;
```

同时把 hero 下面那行提示：

```js
  document.getElementById('hero-note').textContent   = 'AUD · 下次租金日（' + cfg.rentDay + '日）';
```

改成：

```js
  document.getElementById('hero-note').textContent   = `AUD · 每月 ${cfg.rentDay} 日自动记租金`;
```

- [ ] **Step 4: 解析检查 + 确认没有残留引用**

```bash
grep -n "b-rent" index.html; node -e 'const re=require("fs").readFileSync("index.html","utf8").match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g).join("").replace(/<\/?script[^>]*>/g,"");new Function(re);console.log("ok")'
```
Expected: `grep` 无输出（`b-rent` 已彻底删除），然后 `ok`

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "租金记账：汇总卡片去掉租金行，措辞改成累计账单"
```

---

## Task 8: 删除归档功能

**Files:**
- Modify: `index.html`（设置面板 markup 约 478–482 行、`newCycle()` 约 1166 行、`cycleLabel()`）

- [ ] **Step 1: 删掉设置面板里的账期块**

删除 `index.html` 478 行附近：

```html
    <div class="danger-zone">
      <div class="danger-title">账期</div>
      <button class="cycle-btn" onclick="newCycle()">归档本期，开始新账期</button>
      <div class="cycle-hint">本期结余（应转/欠款）将自动滚入下一期冲抵。本期明细会完整保存到「往期记录」，不会被删除。</div>
    </div>
```

替换成一句说明（用户会想知道房租行为什么删不掉）：

```html
    <div class="danger-zone">
      <div class="danger-title">关于房租</div>
      <div class="cycle-hint">每月 <span id="s-rentday-echo">22</span> 日自动记一笔「宝宝替我垫付」。改上面的金额只影响以后生成的，已经记上的保留当时金额。房租行可以改金额但不能删——删了下次打开会自动补回来，真要去掉就把金额改成 0。</div>
    </div>
```

并在 `openSettings()`（1155 行附近）里加一行让那个数字跟着走：

```js
  document.getElementById('s-rentday-echo').textContent = cfg.rentDay;
```

- [ ] **Step 2: 删掉 `newCycle()` 整个函数**

删除 `index.html` 1166 行附近 `async function newCycle() { ... }` 整个函数体（到它的闭合 `}` 为止，约 18 行）。

- [ ] **Step 3: 删掉只被 `newCycle()` 用的 `cycleLabel()`**

先确认没有别处在用：

```bash
grep -n "cycleLabel" index.html
```

如果只剩定义处，删掉：

```js
function cycleLabel(startDate) {
  const d = new Date(startDate + 'T12:00:00');
  return `${d.getMonth() + 1}月账期`;
}
```

⚠️ 如果 `grep` 显示 `loadExpenses()` 的全新数据库分支还在用，就**保留**。

- [ ] **Step 4: 跑全套检查**

```bash
node scripts/verify-recipe-logic.js | tail -1 && node scripts/verify-fx-logic.js | tail -1 && python3 scripts/verify-refs.py | grep '^index.html' && python3 scripts/verify-shared-fns.py | tail -1 && node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("auth ok")'
```
Expected: 全部通过，且 `verify-refs.py` 的 `index.html` 行**必须仍然是 `['REST']`**（CLAUDE.md 规定的基线）。多出 `newCycle` 或 `cycleLabel` 说明有地方还在调用已删除的函数。

- [ ] **Step 5: 提交**

```bash
git add index.html
git commit -m "租金记账：删除归档功能"
```

---

## Task 9: 文档 + 线上验证

**Files:**
- Modify: `docs/HANDOFF.md`

- [ ] **Step 1: HANDOFF 第八节把这项标完成**

把第八节里的：

```
9. 🔵 **进行中**：租金改成每月自动记账、取消归档。见 `docs/superpowers/specs/2026-11-02-rent-as-expense-design.md`
```

改成：

```
9. ~~租金改成每月自动记账、取消归档~~ ✅ 2026-11-02 完成，见第十三节
```

- [ ] **Step 2: HANDOFF 末尾加第十三节**

```markdown

---

## 十三、租金是怎么记的（2026-11-02 起）

### 一句话

租金是一条**每月自动生成的真实开支**（`type='partner_paid'`，描述「房租」），不再是结算公式里的一项。没有归档，账单是一本持续累加的应收账款。

### 为什么改

旧公式 `carryover + cfg.myRent - shared/2 - pp + cp` 里的 `myRent` 是**每个活跃账期加一次**，不是每个月加一次。而「归档」在真实使用里从来没有对应的现实事件——没人在租金日转账，所以没人点，所以租金不进账。

实测：账期从 2026-08-24 跑到 2026-11-02 共 70 天 ≈ 2.3 个月，区间内经过 2 个租金日，公式只加了 1 笔 1250。**把宝宝欠款多算了 $1,250，且每月增长 $1,250。**

**把一个没有现实对应物的操作当成关键计算的触发器，是这个 bug 的根因。**

### 三个不显眼但关键的地方

**一、id 用 `YYYYMMDD`，幂等是白送的。** 现有 id 只有 `Date.now()` 的 13 位毫秒戳和种子数据的 1–19，8 位日期 id 和两者都不会撞。重复补登直接违反主键约束而失败——**不需要任何「补到哪了」的状态记录**，多设备也不会重复。

**二、水位线看最后一笔房租行，不是看 `start_date`。** 否则以后把租金日从 22 改成 25，会在同一个月记两次。水位线必须在数据库里（就是房租行本身）——`cfg` 存 localStorage 是每台设备各一份的。

**三、房租行不能删。** 删了下次加载会补回来，成为一行删不掉的鬼行。所以 UI 不给删除按钮，只给改金额（编辑保留 id，不触发补登）。真要去掉就改成 0。

### 租金金额存在哪

`cycles.rent_amount` / `cycles.rent_day`，存在活跃账期那一行上。**不是 localStorage**——理由同上，两台设备必须看到同一个值，否则同月租金记成多少取决于谁先打开网页。

改金额只影响以后生成的行，已生成的保留当时金额。

### 公式现在长什么样

```js
transfer = carryover - shared / 2 - pp + cp
```

**没有租金项。** 租金在 `cp` 里。`calcTotals()` 在 PURE LOGIC 段，有断言盯着（`scripts/verify-fx-logic.js`），其中一条就是专门钉死「公式里不能再有租金项」的。

⚠️ `renderArchived()` 里那份内联计算**保留了旧公式**。历史三期当时确实按含租金的公式结算且钱已转过，`cyc.transfer` 是冻结值，改了明细就和结算额对不上。
```

- [ ] **Step 3: 提交并推送**

```bash
git add docs/HANDOFF.md && git commit -m "租金记账：更新 HANDOFF" && git push origin main
```

- [ ] **Step 4: 线上验证（等 1–2 分钟部署）**

```bash
curl -s "https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1/expenses?select=id,date,amount,description,type&description=eq.%E6%88%BF%E7%A7%9F&order=date.asc" -H "apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5" -H "Authorization: Bearer sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5"
```

期望：两条记录，`id` 分别是 `20260922` 和 `20261022`，`amount` 都是 1250，`type` 都是 `partner_paid`。

- [ ] **Step 5: 用浏览器打开 https://tianshuuu.github.io/household-exp/ 确认**

逐条核对：
1. 顶部金额显示 **$4,216.91**（之前是 $5,466.91）
2. 开支列表里有两笔「房租」，日期 9月22 和 10月22
3. 那两笔**没有 ×（删除）按钮**，但有 ✎（编辑）
4. 汇总明细里**没有**「我的租金份额」那一行
5. 设置面板里**没有**「归档本期」按钮
6. 控制台零报错
7. **刷新一次，金额仍然是 $4,216.91**（不是 $5,466.91 - 1250×N）——这条验的是幂等，刷新不会重复补登

---

## 自查：spec 覆盖检查

| spec 章节 | 对应任务 |
|---|---|
| 1. 租金变成一条真实开支 | Task 5 |
| 2. id 用日期，幂等白送 | Task 1 |
| 3. `calc()` 去掉 `myRent` | Task 3 |
| 4. 补登时机 + 三个边界 | Task 2（边界断言）、Task 5（水位线） |
| 4.5 房租行不能删但能改 | Task 6、Task 8 Step 1（说明文字） |
| 5. 配置搬进数据库 | Task 0、Task 4 |
| 6. 归档按钮删掉 | Task 8 |
| 对现有数据的影响 | Task 9 Step 4/5 |
| 不做的事 | Task 3 Step 4 的警告、Task 9 第十三节末尾 |
| 怎么验证 | Task 1/2/3 的断言、Task 9 |
