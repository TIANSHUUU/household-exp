# 家庭账单页中英切换

2026-11-12

## 要解决什么

账单页（`index.html`）只有中文。用户要一个顶栏一键切换的英文版，**只翻界面架构文字，不翻自己录入的内容**（开支描述、食材名等原样保留）。

## 不是从零设计

**这个仓库已经有一套跑了三个月的中英切换机制**，在 `assets/recipe.js` 里：

```js
const LANG_KEY = 'recipe_lang';
let lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';
const I18N = { zh: { ...45 条 }, en: { ...45 条 } };
function t(k) { /* {0} 插值 + 找不到回退中文 */ }
function setLang(l) { lang = l; localStorage.setItem(...); paintChrome(); render(); }
function toggleLang() { setLang(lang === 'en' ? 'zh' : 'en'); }
function paintChrome() { /* 刷 HTML 里写死的静态文案 */ }
```

食谱页顶栏那个 `EN` 按钮（`recipe.html:29`）就是它。**本方案是把这套模式搬到账单页，不是另起炉灶。**

## 设计

### 1. 语言设置两页联动

新建共用 key **`hh_lang`**。`assets/recipe.js` 改成：读不到 `hh_lang` 时回退读旧的 `recipe_lang`，**用户现有的语言偏好不会被重置**。

购物页和日程页**仍然只有中文**。从英文账单页点「🛒 购物」会落到中文页面——这是已知的不一致，用户确认过本次不做。

### 2. 引擎各放一份，不抽 `assets/i18n.js`

`t()` / `setLang()` / `toggleLang()` 这套引擎只有 6 行。在 `index.html` 和 `assets/recipe.js` 里各放一份，**不抽成共用文件**。

理由不是偷懒，是 `docs/HANDOFF.md` 第十一节已经记录过的权衡：抽取会继承 `?v=` 的维护负担；而且两个页面的词条表完全不同（账单页约 62 类，食谱页 45 条，交集几乎为零），真正能共用的只有那几行引擎。

⚠️ `scripts/verify-shared-fns.py` 的 `PAGES` 只扫 `index.html / shopping.html / activity.html` 的内联 `<script>`，**看不到 `assets/recipe.js`**。所以把 `t()` 登记进 `WATCH` 也挡不住这两份引擎分化。这是本方案接受的一个盲区，不假装它不存在。

### 3. 汇总卡：英文版换一套方向模型

**中文版一个字不动。** 它的方向感写在标签里，金额永远是正数：

```
本月宝宝需还给你   $4,216.91     ← 标签表达方向
本月应转给宝宝     $xxx          ← 反过来时换一句话
```

英文版改成中性的 balance 模型，**方向靠正负号**：

```
Running total · 28 entries

      Balance (Tianshu)
      +$4,216.91
      AUD · rent auto-logged on the 22nd

  Previous balance             +$6,984.63
  Shared expenses (total)       $1,135.21
    └ XC's half (÷2)            +$567.61
  TS pays for XC                +$274.63
  XC pays for TS               -$3,609.96
```

用户明确要求避开 `owes`——「有亏欠的感觉」。这是两人自用的账本，不是催收工具。

#### ⚠️ 整张卡的符号都要取反，不只是 hero

代码里 `transfer` **负数表示宝宝欠你**（当前 `transfer = -4216.91`），而约定是「**正数 = Tianshu 是债权方**」，所以：

```
Balance (Tianshu) = -transfer
```

**明细行必须跟着一起翻，否则明细加不出 hero。** 初稿就栽在这：只翻了 hero、明细照抄中文的符号，结果明细加起来是 `-4216.91` 而 hero 显示 `+4216.91`。在算钱的页面上这是硬伤。

展开验算（数字取自 2026-11-12 线上实况）：

```
中文版（从「要转多少钱」的视角）
  carry -6984.63 − shared/2 567.61 − pp 274.63 + cp 3609.96 = -4216.91 = transfer

英文版（从 Tianshu 的视角，全部取反）
  −carry 6984.63 + shared/2 567.61 + pp 274.63 − cp 3609.96 = +4216.91 = Balance(Tianshu)
```

所以英文明细的每一项都是中文那项的相反数：

| 中文行 | 中文符号 | 英文行 | 英文符号 |
|---|---|---|---|
| 上期宝宝欠你（抵减） | `−carry` 为负 | Previous balance | 取反为正 |
| └ 其中抵扣（÷2） | `−shared/2` | └ XC's half (÷2) | `+shared/2` |
| 替宝宝垫付（全额抵扣） | `−pp` | TS pays for XC | `+pp` |
| 宝宝替我垫付 | `+cp` | XC pays for TS | `−cp` |

「共同开支（全额）」那一行是毛额（`$1,135.21`），两种语言都不带符号，只是信息展示。

**搞反了不会报错，只会把债权债务显示反。** 这一条要单独写断言钉死，而且要断言「明细四项之和 === hero」。

### 4. 三个开支类型的英文

用户指定，用缩写不用 Baby：

| `type` | 中文 | 英文 |
|---|---|---|
| `shared` | 共同分担 | `Shared` |
| `partner_personal` | 替宝宝垫付 | `TS pays for XC` |
| `partner_paid` | 宝宝替我垫 | `XC pays for TS` |

缩写顺带解决了公开仓库放真名的顾虑。hero 那行用户要求保留全名 `Balance (Tianshu)`——站点网址本身就是 `tianshuuu.github.io`，额外暴露为零。

### 5. 日期

`index.html:1056` 的 `fmtDate()` 里写死了两个中文数组：

```js
const mo = ['1月','2月',…,'12月'];
const wk = ['周日','周一',…,'周六'];
```

英文版：

```
中文   11月12日 · 周四
英文   Nov 12 · Thu
```

`fmtShort()`（`index.html:1295`，往期抽屉里用）同样处理。

### 6. 货币名：英文版只显示代码

现在下拉框渲染的是 `${c.code} ${c.name}` → `AUD 澳元`。英文版**只显示代码** → `AUD`。

两个理由：

1. 下拉框很窄。`scripts/verify-fx-logic.js` 现有断言就写着「中文名不超过 4 字，否则下拉框在手机上会被截断」，`Malaysian Ringgit` 这种根本塞不下。
2. 货币代码对英文读者本来就是通用词汇，比截断的全名更有用。

**`CURRENCIES` 表（`index.html:648`）和那条现有断言都不动**，只在 PURE LOGIC 段加一个 `currencyOptionLabel(c, lang)`。

### 7. 切换按钮

顶栏加一个 `EN` / `中文` 按钮，和食谱页同一套 `.lang-btn` 样式。

⚠️ 那套样式在 `assets/recipe.css:63-71`，而 **`index.html` 不加载 `recipe.css`**（它的 CSS 全部内联）。所以要把那几行复制进 `index.html` 的内联 `<style>`。

### 8. 要翻的范围

| 区块 | 约 |
|---|---|
| 顶栏 + 标题 | 6 |
| 汇总卡 | 10 |
| 开支行（类型标签 + 副标题） | 8 |
| 添加 / 编辑面板 | 10 |
| 设置面板 | 5 |
| 往期抽屉 + 账期详情 | 8 |
| 提示 / 弹窗 / 空状态 | 11 |
| 日期（月 + 周） | 19 |
| 货币（只切显示方式） | — |

完整词条表在实施计划里逐条列出。

## 不做的事

- **购物页和日程页不翻。** 用户确认本次只做账单 + 食谱联动。
- **用户录入的内容不翻。** 开支描述原样显示。
- **中文版不改。** 英文版的 balance 模型只用于 `lang === 'en'`。
- **历史账期的中文不动。** `renderArchived()` 里「我的租金份额」等标签同样走 `t()`，但其底层数值和公式一律不动（见 HANDOFF 第十三节：`cyc.transfer` 是冻结值）。

## 怎么验证

仓库没有测试框架，PURE LOGIC 段的断言是唯一能自动验的部分。

1. **`currencyOptionLabel(c, lang)`**：中文返回 `AUD 澳元`，英文返回 `AUD`。
2. **日期格式化**：纯函数化之后断言 `2026-11-12` 在两种语言下分别是 `11月12日 · 周四` 和 `Nov 12 · Thu`，含跨月跨年和周日（数组下标 0）这个最容易差一位的边界。
3. **符号取反**：断言 `transfer = -4216.91` 时 `Balance (Tianshu)` 显示为 `+4216.91`，`transfer = +100` 时显示 `-100`。**这是本方案最容易出错的一处**，spec 初稿就写错过。
3b. **明细自洽**：断言英文明细四项（previous / XC's half / TS pays / XC pays）之和严格等于 hero 的 Balance 值。只断言 hero 的符号挡不住「hero 翻了明细没翻」这类错。
4. **中英 key 对齐**：`I18N.zh` 和 `I18N.en` 的 key 集合必须完全相同，缺一个就会在界面上露出中文。食谱页已有同类检查可照抄。
5. 按仓库惯例，**所有断言先让它失败一次再改对**。
6. CLAUDE.md 规定的五个检查全过，`verify-refs.py` 的 `index.html` 必须仍是 `['REST']`。
7. 浏览器实跑：切到 EN 全页检查无中文残留，切回中文无英文残留，刷新后语言保持，从账单页切 EN 后进食谱页应同样是英文。
