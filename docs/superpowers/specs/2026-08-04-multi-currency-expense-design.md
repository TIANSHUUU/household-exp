# 家庭账单：外币开支按记账日汇率折算 AUD

日期：2026-08-04
影响页面：`index.html`（家庭账单）。其他三页不动。

---

## 一、要解决什么

家庭账单的 `expenses.amount` 一直被当成 AUD 用。出国旅游时开支是日元、泰铢、韩元，现在只能自己在手机计算器上换算完再填 AUD——换算结果没有留痕，事后对不上银行流水，也想不起来当时花了多少原币。

目标：**记一笔外币开支时选好货币和金额，页面按那一天的汇率折算成 AUD 存下来，同时把原币金额和用掉的汇率一并留痕。**

## 二、不做什么

- 不做「账期级旅行模式」（给整个账期设默认货币）。每笔单独选 + 记住上次用的货币已经覆盖了旅行场景。
- 不改购物清单页。那里的价格是预估价，语义和实付账目不一样，要上得先单独想清楚。
- 不做汇率图表、不做多币种统计。所有汇总永远只有 AUD 一种口径。
- 不建 `fx_rates` 表做两人共享缓存。见第五节的方案对比。

## 三、数据模型

```sql
alter table public.expenses
  add column orig_currency text,     -- 'JPY'；NULL = 这笔本来就是 AUD 记的
  add column orig_amount   numeric,  -- 3200
  add column fx_rate       numeric;  -- 0.00889（1 单位原币 = 多少 AUD）
```

**这段 SQL 要用户在 Supabase 控制台自己跑**，会话里没权限。

### 一条不能破的约定

**`amount` 永远是换算后的 AUD，语义一个字都不改。**

这是整个设计的支点。分账（`index.html` 的 `render()` 里 `shared / pp / cp` 三个累加）、hero 结算金额、`newCycle()` 的结余结转、往期记录合计——这些代码一行都不用动，因为它们读的还是同一个 `amount`。

- 三列全 NULL = 这笔本来就是 AUD 记的。**107 条老数据不需要迁移。**
- 不变式：`amount = round(orig_amount × fx_rate, 2)`。
- 冲突时以 `amount` 为准，`orig_currency` / `orig_amount` / `fx_rate` 是留痕，不是真相来源。任何汇总都不许从 `orig_amount` 现算。

`fx_rate` 的方向定死为「**1 单位原币值多少 AUD**」，不是反过来。日元这种会是 0.00889 这样的小数，存 numeric 不丢精度。反向存（1 AUD = 112.5 JPY）看着好读，但换算要做除法，四舍五入的坑更多。

### 不记汇率来源

不加「这个汇率是自动拉的还是手填的」这一列。`fx_rate` 存的就是这笔账实际用掉的数字，来源无所谓。多一列要多维护一个状态，换不来任何东西。

## 四、录入 UI

```
日期   [ 2026-08-04          ]
金额   [ 3200       ] [ JPY ▾ ]
       ┌────────────────────────────┐
       │ 1 JPY = [ 0.00889 ] AUD  ↻ │   ← 非 AUD 时才出现，带底色
       │ ≈ A$28.45                  │
       └────────────────────────────┘
描述   [ ramen               ]
类型   [共同分担][替宝宝垫付][宝宝替我垫]
```

- 金额栏右边一个原生 `<select>`，30 项（Frankfurter 支持的全部币种，含 AUD）。**AUD 置顶**，后面按旅行常用度排：JPY / KRW / THB / SGD / MYR / IDR / PHP / CNY / HKD / USD / NZD / EUR / GBP / CHF / CAD，剩下的按字母序。手机上是系统原生选择器，不用自己做下拉。
- 选回 AUD → 汇率行整个收起，界面和改动前完全一样。日常记账体验零变化。
- **汇率格子永远可以手改。** 现金换汇的实际汇率跟欧央行中间价差不少，用户可以填真实的。这同时也是不支持币种（越南盾、新台币）的唯一入口。
- `≈ A$28.45` 随金额/汇率实时重算。输错一个零一眼看得出来。
- `↻` 按钮：手动重新拉一次汇率，覆盖手改过的值。

### 默认货币：记住上次用的

localStorage 存 `hh_last_ccy`，打开「添加开支」时默认带上。旅行中连记 20 笔不用每次切。

**已知代价**：回国后第一笔 AUD 开支容易忘了切回去。防线是视觉——汇率行有底色、`≈ A$` 那行实时显示，把 A$45 的超市账单记成 45 JPY 会立刻显示「≈ A$0.40」。用户明确接受这个取舍，不要自作主张改成「隔天重置」之类的聪明逻辑。

编辑已有记录时不受此影响，回填的是那笔账自己的货币。

## 五、汇率怎么拉

### 数据源：api.frankfurter.dev

```
GET https://api.frankfurter.dev/v1/2026-08-04?base=JPY&symbols=AUD
→ {"amount":1.0,"base":"JPY","date":"2026-07-31","rates":{"AUD":0.00889}}
```

2026-08-04 实测：

- 返回 `access-control-allow-origin: *`，**浏览器可以直连**，不需要 Edge Function 代理，也就不吃 Gemini 那 20 次/天的配额。
- 免费、不要 key、支持按日期查历史。
- 欧央行口径，**30 种货币**：AUD BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR。日韩泰新马印尼菲、人民币港币、美欧英纽全覆盖。
- **缺越南盾、新台币、迪拉姆等**。走手填汇率那条路。

注意旧域名 `api.frankfurter.app` 现在 301 跳转且 curl 不跟随，代码里直接写 `api.frankfurter.dev/v1`。

### 触发时机

| 用户动作 | 行为 |
|---|---|
| 改货币 | 拉汇率 |
| 改日期 | 拉汇率（货币非 AUD 时） |
| 改金额 | 只重算 `≈ A$`，不发请求 |
| 点 ↻ | 强制重拉，覆盖手改值 |
| 选回 AUD | 收起汇率行，清掉相关状态 |

### 周末和节假日

请求 2026-08-01（周六）会拿到 2026-07-31 的收盘价，响应里的 `date` 字段是真实日期。**这时汇率行要标一句「(07-31 收盘价)」**，不能闷声换掉——用户后来对流水时会奇怪为什么汇率跟那天的不一样。

### 缓存：localStorage

```js
localStorage['hh_fx'] = '{"2026-08-04|JPY":0.00889,"2026-08-03|THB":0.0468}'
```

历史汇率是不可变的，缓存零风险。旅行时同一天记十笔只拉一次。

对比过的另外两个方案：

| 方案 | 为什么不选 |
|---|---|
| 不缓存，每次都拉 | 简单，但旅行中一天十几个请求纯浪费，弱网下每笔都要等 |
| 建 Supabase `fx_rates` 表两人共享 | 要用户去控制台建表 + 配 RLS 策略，还多一张表要维护。为省几个 HTTP 请求，不值 |

缓存只增不删。一年下来几百个 key，几 KB，不用做淘汰。

### 拉不到的时候

币种不支持、断网、API 挂了——三种情况一样处理：

- 汇率格留空，下面红字提示「没查到汇率，请手填」
- 用户填进去，`≈ A$` 正常算，正常保存
- **不允许在汇率为空的情况下提交**（`submitExpense()` 要挡住，否则会写进一条 `amount = NaN`）

## 六、显示

改 `itemRowHtml()` 一处即可——当期列表和往期记录详情共用这个函数（都经过 `groupedListHtml(exps, readonly)`）。

```
ramen                        $28.45
共同分担          JPY 3,200 · 各付 $14.23
```

只有 `orig_currency` 非空的行才多这一段原币。AUD 记的行显示不变。

### 货币符号：只有录入表单用 `A$`，列表和 hero 保持 `$`

现有页面到处是裸 `$`（`itemRowHtml` 的 `$${fmt(...)}`、hero 的 `<span class="sym">$</span>`），**不要为了「更严谨」批量改成 `A$`**，那是无谓的视觉改动。

唯一例外是录入表单里那行 `≈ A$28.45`——它就贴在一个 JPY 金额输入框下面，消歧义正是它存在的理由。列表里有 `¥3,200` 在旁边做对照，`$` 不会被误读。

原币的符号/格式：用 `Intl.NumberFormat('en-AU', {style:'currency', currency, currencyDisplay:'code'})`（locale 跟现有 `fmt` 保持一致），日元韩元自动没有小数位，不用自己维护符号表。

**`currencyDisplay` 必须是 `'code'`，不能用 `'narrowSymbol'`。** 2026-08-04 实测：

| 币种 | `narrowSymbol` | `code` |
|---|---|---|
| JPY | `¥3,200` | `JPY 3,200` |
| CNY | `¥88.00` | `CNY 88.00` |
| USD | `$12.30` | `USD 12.30` |
| SGD | `$20.00` | `SGD 20.00` |

符号好看，但 **USD / SGD 都渲染成 `$`，跟同一行旁边的澳币 `$28.45` 直接撞车**；`¥` 在日元和人民币之间本来也是歧义的。`code` 三个字母永远不撞、永远不歧义，这是记旅行账的场景里更重要的事。

hero 大数字、三类合计、往期记录的账期合计——**全部只有 AUD**，代码不动。

## 七、编辑已有记录

`openEdit()` 回填原币金额 + 货币 + **存下来的那个 `fx_rate`**，不重新拉。那笔账当时用的就是那个汇率，重拉会无声改掉已记好的账。

改了日期或货币才重新拉。只改金额则用现有汇率重算。

## 八、轮询签名要带上原币

`index.html` 的 15 秒轮询用这个签名判断要不要刷新：

```js
const sig = d => d.map(r => `${r.id}:${r.amount}:${r.description}:${r.type}:${r.date}`).join('|');
```

如果一笔账只改了原币金额、换算后的 AUD 恰好没变，另一台设备不会刷新，会一直显示旧的原币。极端边角，但把 `orig_amount` 和 `orig_currency` 加进签名几乎零成本。加上。

对应地 `toDB()` 也要输出这两列，否则 `sig(expenses.map(toDB))` 那边永远是 undefined，签名恒不相等 → 每 15 秒无脑重渲染一次。

`toLocal()` 同样要把三列映射进内存对象（`origCcy` / `origAmount` / `fxRate`），否则从数据库读回来的记录渲染不出原币、编辑时也回填不了。

**`toLocal` / `toDB` / `sig` 这三处必须一起改**，漏一处就是一类静默 bug。`submitExpense()` 里的 insert/update 是自己拼的对象字面量，不走 `toDB`，要单独加这三个字段。

## 九、验证

`index.html` 目前没有任何自动化验证——PURE LOGIC 那套只存在于 `assets/recipe.js`。这次给它开个头：

把换算相关的纯函数抽成 `// ── PURE LOGIC START ──` / `// ── PURE LOGIC END ──` 段，配 `scripts/verify-fx-logic.js`，照 `scripts/verify-recipe-logic.js` 的做法把这段切出来 eval 跑断言。

要进这个段的函数：

| 函数 | 断言要覆盖 |
|---|---|
| `convertToAud(origAmount, rate)` | 四舍五入到 2 位；`3200 × 0.00889 = 28.45`；rate 为 0/NaN/空要返回 null 而不是 NaN |
| `fxCacheKey(date, ccy)` | `'2026-08-04\|JPY'` |
| `CURRENCIES` | 30 项、AUD 在第一位、无重复 |
| `fmtOrig(amount, ccy)` | JPY 无小数位，THB 两位 |

**按 HANDOFF 第六节的规矩：断言写完先让它失败一次**，证明它真在测代码而不是空转通过。

改完跑 CLAUDE.md 里那三个检查，另加新的这个：

```bash
node scripts/verify-fx-logic.js
node scripts/verify-recipe-logic.js
python3 scripts/verify-refs.py
node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("ok")'
```

`verify-refs.py` 目前只扫 `recipe.js` + `recipe.html`。新加的 `onchange` / `oninput` 处理函数在 `index.html` 里，**这个脚本盖不到**，需要人工核对新加的内联事件处理器都有对应定义。

## 十、上线风险

**不需要停机窗口。** 这跟 2026-08-03 上 Auth 那次「前后端必须同时切」完全不同：

- 新加的三列可空，旧数据 NULL
- HTML 有 10 分钟 CDN 缓存期，期间手机上跑的是旧版 `index.html`。旧版读到带 `orig_currency` 的行只是不显示原币小字，`amount` 照样正确、分账照样对
- 旧版写入的新记录三列为 NULL，新版读到也正常

所以先跑 SQL 加列、再推代码，两步之间不用等。

不涉及 `assets/` 改动，**不用 bump `?v=`**（除非实施时确实动了 `assets/auth.js`）。

## 十一、验收标准

1. 日常记 AUD 的流程和改动前逐像素一致（汇率行不出现）
2. 选 JPY 输 3200，日期 2026-08-04 → 表单显示 `≈ A$28.45`，保存后列表显示 `$28.45` 和 `¥3,200`
3. 同一天再记一笔 JPY，不发第二个网络请求（缓存命中）
4. 日期选一个周六 → 汇率行标出实际取的是哪天的收盘价
5. 选 VND（不在列表里，用手填路径模拟）→ 提示手填，填完能正常保存
6. 汇率为空时点「添加」→ 被挡住，不产生 NaN 记录
7. 编辑那笔 JPY 记录 → 回填 3200 / JPY / 0.00889，不发网络请求
8. 改成 5000 JPY 保存 → `amount` 变 44.45，`fx_rate` 仍是 0.00889
9. 归档账期 → 往期记录里那笔仍显示 `¥3,200`
10. 两台设备开着，A 改原币金额但 AUD 不变 → B 在 15 秒内刷出新原币
11. `node scripts/verify-fx-logic.js` 全绿
