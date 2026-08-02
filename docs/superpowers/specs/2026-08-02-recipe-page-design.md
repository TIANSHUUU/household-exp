# 家庭食谱页 设计文档

日期：2026-08-02

## 背景

我和伴侣都喜欢做菜，积累了一些最爱的家庭食谱，目前散落在各处没有统一记录。希望有一个食谱页面：两人的电脑端都能登录上传图文、按食材搜索、并在「冰箱里有这些东西」时给出做菜灵感。

与已有的开支页、购物页、日程页不同，这一页承载的是创作和料理的内容，视觉上刻意不走 iOS 极简风，改用 `~/Documents/code/gourmet`（菠萝子美食指南）那套编辑感的配色与字体。

## 决策（已与用户确认）

1. **落在 household_exp，新增 `recipe.html`** —— 同仓库、同密码、同 Supabase 项目、零构建步骤。视觉上写一套完全独立的 CSS，不受现有三页约束。
2. **AI 建议 = 算法匹配 + LLM 创意层** —— 「我有 xx、yy → 再买 aa 就能做 cc」是食谱库上的集合运算，纯前端算，准确且免费；LLM 只负责库外的创意发挥、自由文本解析、新食材归一化建议。**LLM 全挂也不影响记录、浏览、搜索、分桶匹配。**
3. **食谱字段**：菜名 + 封面图 + 成品多图 + 食材 + 步骤 + 分类标签。不做评分、心得笔记、烹饪时间、难度、来源链接（YAGNI，需要时再加）。
4. **图片：封面 + 成品多图 + 灯箱** —— 一张主图用于首页卡片，详情页下方一排缩略图，点开看大图。量力而行，只传一张也完全 OK。
5. **两个明确入口** —— 列表页顶部搜索框（找菜 / 找含某食材的菜），单独一个「🧊 冰箱里有什么」入口进灵感页。不做「chip 数量自动切换模式」的隐式设计。
6. **只做浅色模式** —— gourmet 那套配色的灵魂是暖奶油底配深蓝字，硬做深色会失去质感，食物照片在奶油底上也更好看。不写 `prefers-color-scheme: dark`。
7. **与购物清单联动** —— 分桶结果里的「再买 X + Y」可一键写进现有 `shopping_items` 表。
8. **分三期交付** —— 一期（纯前端，完整可用）→ 二期（AI 层）→ 三期（购物清单联动）。
9. **AI 供应商先用 Gemini 免费层，保留切换到 Anthropic 的口子** —— Edge Function 从第一天起做供应商抽象，前端只认一个契约，换供应商 = 改一个环境变量 + 重新部署，前端不动一行。

## 形态

```
household-exp/
├── index.html / shopping.html / activity.html   （不动）
├── recipe.html          结构 + 密码门（与其余三页同款）
└── assets/
    ├── recipe.css       gourmet 风格样式
    ├── recipe.js        数据层 + 渲染 + 匹配算法
    └── recipe-ai.js     Edge Function 调用（二期才引入）
```

拆分文件的理由：食谱页功能比现有三页复杂得多（`index.html` 已 49KB），单文件内联会难以维护和可靠编辑。GitHub Pages 直接支持多文件，仍然零构建步骤，`git push` 后 1–2 分钟生效。

四页顶栏互加跳转，食谱页链接文案为 `🍳 食谱`。

## 数据模型（Supabase，需手动在 SQL 编辑器建表）

### `ingredient_vocab` —— 食材词表

```sql
create table ingredient_vocab (
  id        bigint generated always as identity primary key,
  canonical text not null unique,           -- 番茄
  aliases   text[] not null default '{}',   -- {西红柿, tomato, 洋柿子}
  staple    boolean not null default false, -- 盐/油/酱油这类，匹配时默认当你有
  created_at timestamptz default now()
);
alter table ingredient_vocab enable row level security;
create policy "all ingredient_vocab" on ingredient_vocab for all using (true) with check (true);
```

### `recipes` —— 食谱

```sql
create table recipes (
  id              bigint generated always as identity primary key,
  name            text not null,                        -- 红烧排骨
  tags            text[] not null default '{}',         -- {中餐, 主菜}
  cover_url       text,
  image_urls      text[] not null default '{}',
  ingredients     jsonb  not null default '[]',  -- [{"name":"排骨","amount":"500g"}] 显示用，保留原始写法
  ingredient_keys text[] not null default '{}',  -- {排骨,冰糖,生姜} 匹配用，canonical
  steps           text[] not null default '{}',
  created_at      timestamptz default now()
);
create index recipes_ingredient_keys_idx on recipes using gin (ingredient_keys);
alter table recipes enable row level security;
create policy "all recipes" on recipes for all using (true) with check (true);
```

**关键设计：`ingredients` 和 `ingredient_keys` 分开存。** 前者保留「排骨 500g」的原始写法用于显示，后者是干净的 canonical 名字专供机器匹配。显示与计算解耦，两边都不将就。

### `ai_usage` —— AI 调用日限额（二期）

```sql
create table ai_usage (
  day   date primary key,
  count integer not null default 0
);
alter table ai_usage enable row level security;
-- 不建 policy：只有 Edge Function 用 service role key 访问，匿名 key 读不到也写不了
```

### Storage

建 public bucket `recipe-images`，路径 `recipes/<recipe_id>/<uuid>.jpg`。

- 上传前在浏览器用 canvas 压缩：长边最大 1600px，导出 JPEG quality 0.85。省流量、加载快、免费额度够用。
- bucket 为 public read，图片 URL 不可枚举但可猜。对私人食谱集合而言可接受；如果以后介意，改成 signed URL 即可，数据模型不受影响。
- 需要给 bucket 加允许匿名 insert / delete 的 policy（与三张表的全允许策略同思路）。

## 食材归一化 —— 整个功能的成败点

「番茄」和「西红柿」必须被认成同一样东西，否则搜索漏、匹配错。

**采用方案：别名主表 + 录入时自动补全。**

- 页面加载时把 `ingredient_vocab` 全量拉进内存（几百行、几十 KB），建 `别名 → canonical` 的查找表（小写化、去空格）。
- 录食谱时，食材名输入框做 autocomplete，从内存词表补全。选中已有条目即自动得到 canonical。
- 打了词表里没有的词 → 标为「新食材」，保存时以该词本身为 canonical 新建一行 vocab。
- 可选（二期）：点一下让 LLM 判断「这个是不是就是词表里已有的某个？常见别名有哪些？」，用户确认才写入。**LLM 不可用时整条链路照常工作，只是少了这个建议。**

被否决的替代方案：

- **不建表、搜索时模糊匹配** —— 「番茄」搜不到「西红柿」；「鸡胸肉」算不算「鸡肉」说不清；「差几样」的硬逻辑会算错。食谱到 30 个以上开始明显出问题。
- **每次调 LLM 归一化** —— 慢、花钱，且同一个词两次归一化可能得到不同结果，数据会慢慢腐烂。

方案 A 把不确定性挡在写入那一刻：录入时人看着下拉选，选完数据就是干净的，之后所有搜索和匹配都是内存里的精确集合运算，零延迟零成本。

## 匹配算法

```
have    = 用户输入的食材，逐个经别名表映射到 canonical，取集合
staples = vocab 中 staple = true 的 canonical 集合

对每个 recipe：
  need    = Set(recipe.ingredient_keys) − staples
  missing = need − have
  bucket  = missing.size          // 0 / 1 / 2 / 3+，超过 3 不展示

分桶展示：现在就能做 (0) / 再买 1 样 (1) / 再买 2 样 (2) / 再买 3 样 (3)
桶内排序：need.size 升序（食材少的优先），并列时 created_at 降序
```

**`staple` 字段是这个算法能用的前提。** 盐、油、酱油、糖几乎每道菜都有，但没人在说「我有番茄鸡蛋」时会把它们算进去。不做 staple 排除，结果会变成每道菜都提示「再买 5 样」，功能直接废掉。

## 搜索

列表页顶部一个搜索框，输入时做 autocomplete（从食材词表 + 已有菜名）。结果分两组展示：

- **菜名含此词** —— `recipe.name` 子串匹配（大小写不敏感）
- **食材含此词** —— canonical 命中 `ingredient_keys`，或原始写法 `ingredients[].name` 子串匹配

标签筛选是列表页顶部一排 chip（全部 / 中餐 / 西餐 / …），单选，与搜索框叠加生效。标签列表从现有食谱的 `tags` 去重汇总得出，不单独建表。

搜索、筛选、匹配全部在客户端内存里算——页面加载时一次性拉全量食谱 + 词表，之后零网络往返。这与现有三页的做法一致，几十道菜的规模完全撑得住。

## 页面与交互

hash 路由，单页四视图：

| 路由 | 视图 | 内容 |
|---|---|---|
| `#/` | 列表页 | 渐变 header + 搜索框 + 标签筛选 + № 卡片网格 + 「🧊 冰箱里有什么」入口 |
| `#/r/<id>` | 详情页 | 封面大图 → 菜名 + 标签 → 食材 → 步骤 → 缩略图相册（灯箱） |
| `#/new` `#/edit/<id>` | 编辑页 | 表单 |
| `#/idea` | 灵感页 | 食材 chip 输入 → 分桶结果 |

**编辑表单**：菜名（必填）、标签（chip 多选 + 可新建）、封面图（上传/替换）、成品多图（多选上传、可删）、食材（一行一个，name 带 autocomplete + amount 选填，可增删排序）、步骤（一行一步的多行文本，保存时按行拆分）。

**灵感页**：chip 输入手头食材（autocomplete），下方实时分桶。二期在分桶结果下方加 `✨ 让 AI 再想想`。

**同步**：15 秒轮询（`document.visibilityState === 'visible'` 时才请求），签名比对仅在数据变化时重渲染，参考现有三页实现。

**删除**：原生 `confirm()` 二次确认，同时删除 Storage 里对应的图片文件。

## 视觉规范

移植 gourmet 的编辑感设计语言，用手写 CSS 实现（不引 Tailwind，避免构建步骤）：

| 项 | 值 |
|---|---|
| 底色 | `#FCFAF4` 暖奶油 |
| 正文 | `#13314A` 深海军蓝 |
| 强调 | `#F0742A` 橘 · `#0F84B5` 蓝 · `#8A99A6` 灰 |
| 标题 | Fraunces 衬线 + Noto Serif SC（CJK） |
| 小标签 | JetBrains Mono，大写宽字距 —— `№ 03` `中餐 · 主菜` |
| Header | 复用 gourmet 带噪点纹理的渐变（橘→蓝，`feTurbulence` SVG filter，`background-attachment: fixed`） |
| 卡片 | 16:10 大图 + 悬停 `scale(1.05)` + № 编号 |

字体走 Google Fonts CDN `<link>` 引入，与 gourmet 同一套。

**明确不做深色模式**，`recipe.css` 里不写 `prefers-color-scheme: dark`。

## AI 层（二期）

### Edge Function 契约

`POST /functions/v1/kitchen-ai`

```json
// 请求
{ "action": "normalize" | "parse" | "suggest", "payload": { ... } }

// 响应
{ "ok": true,  "data": { ... } }
{ "ok": false, "error": "rate_limited" | "unauthorized" | "provider_error" }
```

| action | 触发时机 | payload → data |
|---|---|---|
| `normalize` | 录食谱时打了词表里没有的食材 | `{new: string[], known: string[]}` → `{suggestions: [{input, canonical, aliases[]}]}` |
| `parse` | 灵感页粘了一段自由文本 | `{text}` → `{ingredients: string[]}` |
| `suggest` | 点了 ✨ | `{have[], library: [{name, ingredients[]}], matched[]}` → `{text}` |

前端在 `recipe-ai.js` 里只认这个契约。三个 action 全部是可选路径——Edge Function 没部署、key 过期、供应商挂了，一期的所有功能照常工作。

### 供应商抽象

Edge Function 内部按 `PROVIDER` 环境变量（`gemini` | `anthropic`）分派到两个适配器，二者暴露同一个签名：

```ts
callLLM(systemPrompt: string, userPrompt: string): Promise<string>
```

- **Gemini 适配器**（先用）—— Google AI Studio 的免费层。具体 model id 在实现时去 AI Studio 确认当前免费层型号，不在文档里写死。免费层有速率限制，两个人的用量绰绰有余，但条款和额度 Google 随时可能改。
- **Anthropic 适配器**（备用）—— Claude Haiku 4.5（`claude-haiku-4-5`）。按每次 ✨ 约 2500 input + 400 output tokens 估算，约 $0.0045/次；100 次/月约 0.7 澳元。需要在 Anthropic Console 预充额度。

切换供应商 = 在 Supabase 改一个 secret + 重新部署 Edge Function，**前端一行不改**。

Secrets：`PROVIDER`、`GEMINI_API_KEY`、`ANTHROPIC_API_KEY`、`KITCHEN_PWD_HASH`。

### 安全与花费上限

Supabase 的 anon key 印在页面源码里是公开的，所以任何人找到这个站理论上都能调 Edge Function 消耗额度。两道防线：

**门锁（较弱）** —— 解锁时把明文密码存进 `sessionStorage`（新 key `hh_pw`），调用时作为 `x-kitchen-pw` header 发送，Edge Function 用 secrets 里的 `KITCHEN_PWD_HASH` 做 SHA-256 校验。

> 诚实说明：如果现有密码是纯数字短 PIN，源码里公开的 `PWD_HASH` 可被秒破，这道防线形同虚设。
>
> 另有一个边界情况：用户若从 index/shopping/activity 任一页解锁后跳转过来，`hh_pw` 不存在（那三页的 `unlock()` 只存 `'1'`）。处理方式是首次点 ✨ 时弹一次输入框补录，存进 `sessionStorage` 后续复用。**不修改另外三个页面**，把改动圈在 recipe.html 内。

**硬性花费上限（真正的防线）** —— Edge Function 用 service role key 在 `ai_usage` 表上做当日计数的原子自增，超过 **50 次/天** 直接返回 `{"ok": false, "error": "rate_limited"}`，不调供应商。这样即使门锁被绕过，最坏结果也只是当天的 ✨ 不可用，账单封顶。

两道都做，成本都很低。

## 购物清单联动（三期）

分桶结果里每条「再买 X + Y」右侧加 `+ 购物清单` 按钮：

- 弹出选择：写进某个已有 `shopping_lists`，或新建一张清单
- 缺的食材逐条 insert 进 `shopping_items`（`list_id` + `name` + `position`）
- 已存在同名条目则跳过，不重复添加

同仓库、同数据库、表都是现成的，实现成本极低，但把「想吃什么 → 要买什么」这条链路真正接通了。

## 单元边界

- **DB 层**（`recipe.js`）：`vocabGetAll / vocabInsert`、`recipeGetAll / recipeInsert / recipeUpdate / recipeDelete`、`uploadImage / deleteImage`
- **纯逻辑**（`recipe.js`，无 DOM 无网络，可用 node 单独跑）：`buildAliasMap(vocab)`、`toCanonical(text, aliasMap)`、`matchRecipes(have, recipes, staples)`、`searchRecipes(q, recipes, aliasMap)`
- **渲染**（`recipe.js`）：`renderList / renderDetail / renderEditor / renderIdea`，各自由内存状态生成，纯函数
- **AI**（`recipe-ai.js`）：`callKitchenAI(action, payload)` 单一出口，三个 action 各自的调用点在 UI 层

纯逻辑那一层刻意做成无副作用，因为这个仓库没有测试框架——验证时用 `node -e` 单跑这几个函数比起手工点页面可靠得多。

## 分期

| 期 | 内容 | 交付后状态 |
|---|---|---|
| **一期** | `recipe.html` + `assets/recipe.css` + `assets/recipe.js` + 两张表 + Storage bucket + 录入/浏览/搜索/分桶匹配 + 「复制 prompt」按钮 | **完整可用**，纯前端，零成本，零后端 |
| **二期** | `assets/recipe-ai.js` + Edge Function（Gemini 适配器 + 供应商抽象）+ `ai_usage` 表 + ✨ 创意层 + 新食材归一化助手 | 加上页面内 AI |
| **三期** | 购物清单联动 | 打通「想吃 → 要买」 |

一期即满足需求里的「记录、归档、食材搜索、做菜灵感建议」四件事——AI 是锦上添花，不是地基。

一期里的「📋 复制给 Claude 提问」按钮：把食谱库摘要 + 手头食材 + 算法已算出的结果拼成完整 prompt 塞进剪贴板，用户粘到 claude.ai 里问。零成本、用的是用户已有的订阅额度，二期上线后这个按钮可以保留作为兜底。

## 明确不做的事

记录在此，避免以后重新讨论：

- 评分 ⭐、心得笔记、烹饪时间、难度、来源链接 —— 用户明确只要分类标签
- 深色模式 —— 与 gourmet 视觉语言冲突
- 每个步骤配图 —— 录入负担太重，做菜时容易忘拍，最后一堆空位
- 「归档」独立功能 —— 用户语境下的「归档」即分类整理，由标签筛选覆盖，不做类似开支页的历史存档
- 用户身份区分（谁添加的）—— 两人共用一个密码，无身份概念，不加 `created_by`
- 食材用量的结构化（数值 + 单位）—— `amount` 存自由文本即可，不参与任何计算

## 验证方式

仓库无测试框架、无 package.json、无构建步骤。验证依赖：

- `node -e` 单跑纯逻辑函数（`toCanonical` / `matchRecipes` / `searchRecipes`），构造小数据集断言分桶结果
- `curl` 打 Supabase REST API 验证建表与读写
- 结构完整性用一次性 node 脚本检查 div / brace 平衡
- 页面行为在浏览器手工验证
