# 食谱页 中英双语 设计文档

日期：2026-08-02
前置：`2026-08-02-recipe-page-design.md`（一期已交付上线）

## 背景

一期只有中文界面。用户要求加英文界面并支持中英切换，且明确要求**内容也双语**：「如果我填的是纯中文你帮我翻译成英文，and vice versa。如果是中英交杂，你自己整理两版。」

自动翻译在纯静态页面上做不到——所有逻辑跑在浏览器里，没有服务端。因此本次把原定二期的 Supabase Edge Function 提前建起来，第一个 action 是 `translate` 而不是原计划的 `suggest`。翻译比创意建议更适合当首个用途：它是确定性任务，错了一眼能看出来；创意建议错了用户未必察觉。

## 决策（已与用户确认）

1. **内容双语，不只是界面** —— 菜名、食材、步骤各存中英两版。
2. **自动翻译，一次做到位** —— 不走「先手填、以后再叠加」的折中路径。
3. **供应商先用 Gemini 免费层**，Edge Function 内部做供应商抽象，可切 Anthropic（沿用一期 spec 的决策）。
4. **匹配与搜索逻辑完全不动** —— `ingredient_keys` 永远是中文 canonical。
5. **标签走共享翻译表**，不在每条食谱上存双份。

## 数据模型变更

```sql
-- 现有三列即中文版，改名让语言显式化
alter table recipes rename column name        to name_zh;
alter table recipes rename column ingredients to ingredients_zh;
alter table recipes rename column steps       to steps_zh;

-- 英文版
alter table recipes add column name_en        text;
alter table recipes add column ingredients_en jsonb  not null default '[]';
alter table recipes add column steps_en       text[] not null default '{}';

-- 标签翻译表。标签在食谱间高度重复，存每条食谱上会冗余，
-- 且筛选栏需要按语言去重，共享表更干净。
create table tag_i18n (
  id bigint generated always as identity primary key,
  zh text not null unique,
  en text not null
);
alter table tag_i18n enable row level security;
create policy "all tag_i18n" on tag_i18n for all using (true) with check (true);

-- AI 调用日限额（一期 spec 已设计，此处正式建表）
create table ai_usage (
  day   date primary key,
  count integer not null default 0
);
alter table ai_usage enable row level security;
-- 不建 policy：只有 Edge Function 用 service role key 访问
```

**不变的列**：`tags`（始终存中文 canonical 标签）、`ingredient_keys`（始终中文 canonical）、`cover_url`、`image_urls`、`created_at`。

**为什么 `ingredient_keys` 不双语**：它是匹配和搜索的机器键，双语化会让集合运算需要跨语言对齐，平白引入一类新 bug。英文搜索通过 `ingredient_vocab.aliases` 里的英文别名命中——这条链路一期已实测可用（`buttermilk → 酪乳`、`oats → 燕麦片`）。

## 缺失回退

任何一版为空时回退到另一版，而不是显示空白：

```js
function pick(r, field) {
  const a = r[field + '_' + lang], b = r[field + '_' + (lang === 'en' ? 'zh' : 'en')];
  return (a && a.length) ? a : b;
}
```

这样只填了一种语言的食谱在两种模式下都能正常显示，翻译是渐进的、不是前置条件。

## 界面文案

`I18N = { zh: {...}, en: {...} }` + `t(key, ...args)`。语言存 `localStorage`（跨会话保持，与 `sessionStorage` 的登录态分开）。顶栏加 `EN / 中文` 切换按钮，样式沿用 gourmet 的圆角描边按钮。

**不翻译的东西**：用户录入的食谱内容（走上面的 `pick`）、食材词表里的 canonical 名。

## Edge Function

`POST /functions/v1/kitchen-ai`，契约沿用一期 spec：

```json
{ "action": "translate", "payload": { "from": "zh", "to": "en", "recipe": {...} } }
→ { "ok": true, "data": { "name": "...", "ingredients": [...], "steps": [...], "tags": {"早餐":"Breakfast"} } }
```

**混写输入的处理**：prompt 明确要求输出目标语言的**单语干净版本**——输入里已有的目标语言片段保留，其余翻译，不做逐句对照。这正是 LLM 擅长的归一化任务。

**供应商抽象**：`PROVIDER` 环境变量（`gemini` | `anthropic`）分派到两个适配器，同一签名 `callLLM(system, user) → string`。切换 = 改一个 secret + 重新部署，前端不动。

**安全与限额**（沿用一期 spec 的结论）：
- 解锁时把明文密码存 `sessionStorage`，调用时作 `x-kitchen-pw` header，函数用 secrets 里的 hash 校验
- 真正的防线是 `ai_usage` 表的 **30 次/天**硬上限，超了直接拒绝，不调供应商

Secrets：`PROVIDER`、`GEMINI_API_KEY`、`ANTHROPIC_API_KEY`、`KITCHEN_PWD_HASH`。

## 编辑器

加「中文 / EN」两个页签。每个页签内是该语言的菜名 + 食材 + 步骤。标签、封面图、成品图是**共享**的，不分语言，放在页签之外。

页签下方一个「🌐 翻译到 EN / 翻译到中文」按钮：把当前页签内容发给 Edge Function，结果填进另一个页签。**翻完可以手改**——自动翻译是起点不是终点。

保存时两版一起写。`ingredient_keys` 仍从**中文版**食材推导（英文版食材只用于显示）。若中文版为空（用户只填了英文），则从英文版推导，走 `ingredient_vocab` 的英文别名反查 canonical。

## 明确不做

- 不翻译已录入食谱的历史数据（用户按需点翻译按钮）
- 不做第三种语言
- 不做「自动检测输入语言」——由用户当前所在页签决定源语言
- 不把 `ingredient_keys` 双语化（见上）
- 界面双语不扩散到其余三个页面（用户只要求食谱页）

## 分期

| | 内容 | 阻塞于 |
|---|---|---|
| **A** | SQL 迁移 + 界面文案双语 + 顶栏切换 + 展示层回退 | 用户跑 SQL |
| **B** | 编辑器双页签（翻译按钮先置灰） | A |
| **C** | Edge Function + 翻译按钮接通 | 用户申请 Gemini key + 部署函数 |

A 和 B 不依赖 Edge Function，可以先做。C 需要用户先完成两件外部操作。

## 验证方式

- 纯逻辑（`pick` 的回退、`t()` 的缺 key 兜底）加进 `scripts/verify-recipe-logic.js`
- 界面双语用浏览器实测：切换后所有可见文案不残留中文（EN 模式下扫描 DOM 文本）
- 翻译质量人工抽验，重点看计量单位和烹饪术语
- `curl` 验证 Edge Function 的限额与鉴权分支
