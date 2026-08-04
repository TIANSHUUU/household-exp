# household_exp 项目 Handoff

最后更新：2026-08-04

这份文档给「接手这个仓库的下一个人（或下一段对话）」看。目标是让你不用回读聊天记录就能继续干活。

---

## 一、这是什么

一个给两个人用的家庭工具站，纯静态，GitHub Pages 托管。

- **线上**：https://tianshuuu.github.io/household-exp/
- **仓库**：`TIANSHUUU/household-exp`（`git@github.com:TIANSHUUU/household-exp.git`）
- **部署**：推 `main` 即上线，1–2 分钟生效。没有 CI、没有构建步骤、没有 package.json、没有测试框架。
- **数据**：Supabase 项目 `mpvsbeghuueffkjdemcr`，全部走裸 PostgREST fetch，不用 SDK。匿名 key 直接写在页面源码里（公开的）。

### 四个页面

| 文件 | 名字 | 形态 |
|---|---|---|
| `index.html` | 家庭账单 | 单文件内联 CSS/JS，iOS 极简风 |
| `shopping.html` | 购物清单 | 同上 |
| `activity.html` | 活动安排 | 同上 |
| `recipe.html` | 家庭食谱 | **例外**：拆成 `assets/recipe.css` + `assets/recipe.js`，gourmet 编辑风，仅浅色 |

四页共用同一个登录（`assets/auth.js`），任一页登录则四页通行。**没有身份区分**——两人共用一个账号，数据库不记录谁改了什么。详见第九节。

---

## 二、食谱页现状

### 已完成

**一期（纯前端）** —— 食谱 CRUD、图片上传、食材搜索、冰箱分桶匹配、15 秒轮询同步。全部实测通过。

**双语（A + B）** —— 界面中英切换（82 个文案 key 两边对齐）、内容双语存储、编辑器中文/EN 双页签、缺失自动回退。已上线。

**双语（C）自动翻译** —— 已全部上线，Edge Function 2026-08-03 部署完成。见第四节。

**购物清单联动** —— 2026-08-03 上线。冰箱页「再买 N 样」每行可一键写进 `shopping_items`。见 `docs/superpowers/specs/2026-08-03-shopping-list-link-design.md`。

**✨ AI 灵感** —— 2026-08-03 上线。灵感页把 `buildPrompt()` 拼好的 prompt 送给 Edge Function 的 `suggest` action，结果就地展开。和「📋 复制给 Claude 提问」并排——后者免费且模型更强，前者胜在手机上一点就出。

### 未做（有意的）

- 评分、心得笔记、烹饪时间、难度、来源链接、每步配图、深色模式、第三种语言。用户明确砍掉的，别自作主张加回来。

### 关键文档

- `docs/superpowers/specs/2026-08-02-recipe-page-design.md` —— 一期设计
- `docs/superpowers/specs/2026-08-02-recipe-bilingual-design.md` —— 双语设计
- `docs/superpowers/plans/2026-08-02-recipe-page-phase1.md` —— 一期 18 任务实施计划

---

## 三、数据模型

```
recipes
  id, name_zh, name_en, ingredients_zh(jsonb), ingredients_en(jsonb),
  steps_zh(text[]), steps_en(text[]),
  tags(text[]), ingredient_keys(text[]), cover_url, image_urls(text[]), created_at

ingredient_vocab
  id, canonical(unique), aliases(text[]), staple(bool), created_at

tag_i18n
  id, zh(unique), en

ai_usage
  day(date pk), count        ← 只有 Edge Function 用 service role 访问，无 RLS policy

expenses
  id, date, amount, description, type, cycle_id,
  orig_currency, orig_amount, fx_rate    ← 2026-08-04 加的外币三列，老数据全 NULL

cycles
  id, label, start_date, status, carryover, transfer

storage bucket: recipe-images（public read，路径 recipes/<folder>/<随机名>）
```

### 四条不能破的约定

1. **`ingredient_keys` 永远是中文 canonical。** 它是匹配和搜索的机器键。双语化会让集合运算要跨语言对齐，凭空多一类 bug。英文搜索靠 `ingredient_vocab.aliases` 里的英文别名命中（`buttermilk → 酪乳` 实测可用）。

2. **`tags` 永远存中文 canonical**，英文显示走 `tag_i18n` 查表。标签在食谱间高度重复，存双份会冗余且筛选栏要按语言去重。

3. **`staple = true` 的食材在冰箱匹配时默认「你有」。** 盐、油、酱油、泡打粉、苏打粉等 20 条。**不标 staple，每道菜都会提示「再买 5 样」，超过 3 样上限后直接不显示——功能等于废掉。** 新增常备调料记得标。

4. **`expenses.amount` 永远是 AUD。** 2026-08-04 加了外币支持，但换算在写入时就做完了——`orig_currency` / `orig_amount` / `fx_rate` 只是留痕，三列全 NULL 表示这笔本来就是 AUD 记的。**任何汇总都不许从 `orig_amount` 现算**，否则汇率一变历史账目就会漂。详见第十节。

---

## 四、Edge Function（2026-08-03 已部署上线 ✅）

代码：`supabase/functions/kitchen-ai/index.ts`

### 怎么重新部署

**用 CLI，别用控制台界面。** 界面上找函数名输入框那一步在不同版本的 dashboard 里位置不一样，容易卡住；CLI 一条命令搞定，而且 `--no-verify-jwt` 这个关键设置由参数指定，不会点错。

```bash
npx supabase login                     # 只需一次，会开浏览器授权
npx supabase functions deploy kitchen-ai \
  --project-ref mpvsbeghuueffkjdemcr --no-verify-jwt
```

`WARNING: Docker is not running` 可以无视，部署不需要 Docker。

（这个版本的 CLI **没有** `functions logs` 子命令，想看日志得去控制台。）

### 如果是从零建一个新项目

1. Supabase 控制台 → **Edge Functions** → **Deploy a new function**
2. 函数名 **`kitchen-ai`**（必须一字不差——前端 `FN_URL` 按这个名字请求）
3. 贴入 `supabase/functions/kitchen-ai/index.ts` 全部内容（`pbcopy < supabase/functions/kitchen-ai/index.ts`）
4. **关掉 Verify JWT** ⚠️ ——但理由和 2026-08-02 的旧版文档不一样，别照旧理由推断。

   **不能开的原因是 CORS 预检。** 网页在 `tianshuuu.github.io`，函数在 `supabase.co`，跨域；浏览器发正式请求前会先发一个 `OPTIONS` 预检，而**预检按规范不带 `Authorization` 头**。平台的 JWT 检查在函数之前执行，预检直接吃 401，浏览器判定跨域失败，正式请求根本不会发出去。函数里那行 `if (req.method === 'OPTIONS')` 救不了——请求到不了那儿。

   **鉴权没有丢**，只是搬进了函数：`verifyUser()` 拿 Bearer 令牌去问 `/auth/v1/user`，200 才放行。匿名 key 也长得像 Bearer 令牌，但它不是用户令牌，问出来会被拒。验不过一律 401，配置缺失也算验不过（失败即关门）。
5. 配 secrets：

   | 名称 | 值 |
   |---|---|
   | `PROVIDER` | `gemini` |
   | `GEMINI_API_KEY` | 用户在 Google AI Studio 申请的 |
   | `GEMINI_MODEL` | 可选，默认 `gemini-flash-latest`。**别填具体版本号**，理由见下 |

   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 平台自动注入。
   `KITCHEN_PWD_HASH` 不再需要，配了也不读。

### ⚠️ 免费档的模型换代很快，别写死版本号

2026-08-03 部署当天连撞两次：

| 填的模型 | 结果 |
|---|---|
| `gemini-2.0-flash`（当时的代码默认值） | **429** — 免费档配额被清零成 0/0，不是"用超了" |
| `gemini-2.5-flash` | **404** — "no longer available to new users" |
| `gemini-flash-latest` | ✅ 通 |

所以代码默认值已经改成别名 `gemini-flash-latest`，它跟着 Google 换代走。**填具体版本号等于埋定时炸弹**，几个月后同样会 429 或 404。

猜模型名是浪费时间，直接问 key 能用哪些（key 不回显、不进 shell 历史）：

```bash
read -rs -p "粘贴 API key: " GK && echo && \
curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GK" \
| python3 -c "import sys,json;[print(m['name'].replace('models/','')) for m in json.load(sys.stdin).get('models',[]) if 'generateContent' in m.get('supportedGenerationMethods',[])]"
```

### ⚠️ 日限额对齐的是 Google 的免费档，不是拍脑袋定的

`DAILY_CAP` 现在是 **20**，和免费档 Gemini Flash 的 RPD 一模一样（原来是 30）。设得比 Google 高没有意义：先撞墙的会是 Google，用户看到的是一段英文 429，而不是 `err_rate_limited` 那句友好提示。改这个数字时**记得同步改前端 `err_rate_limited` 文案里的次数**，中英两处。

**但对齐了也不保证提示一定准确**——那 20 次是和用户自己在 AI Studio / Antigravity 里的用量**共享同一个项目配额**的（2026-08-03 实测 Gemini 3.5 Flash 已经 23/20）。用户白天写代码用掉了，晚上翻译照样会吃 Google 的 429。

想彻底分开就在 AI Studio 里新建一个独立项目专门给这个站用。没做，等用户觉得碍事再说。开了付费档记得把 `DAILY_CAP` 往上调。

### 部署后怎么验

```bash
FN=https://mpvsbeghuueffkjdemcr.supabase.co/functions/v1/kitchen-ai
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5

# 先登录换一个令牌（网页密码）
TOK=$(curl -s -X POST "https://mpvsbeghuueffkjdemcr.supabase.co/auth/v1/token?grant_type=password" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"email":"home@household.local","password":"<网页密码>"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

# 1. 只带匿名 key（没登录）→ 应 401 unauthorized
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -d '{"action":"translate","payload":{}}'

# 1b. CORS 预检 → 必须 200。这条是 Verify JWT 有没有误开的试金石：
#     开着的话这里会 401，浏览器里整个翻译功能就用不了，但 curl 测正式
#     请求却一切正常——很容易查半天。
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$FN" \
  -H "Origin: https://tianshuuu.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, apikey, content-type"

# 2. 带令牌 + 错误 action → 应 400 unknown_action
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" -d '{"action":"nope","payload":{}}'

# 3. 真翻译
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $TOK" \
  -H "Content-Type: application/json" \
  -d '{"action":"translate","payload":{"from":"zh","to":"en","recipe":{"name":"番茄炒蛋","ingredients":[{"name":"番茄","amount":"2个"}],"steps":["热油炒蛋"],"tags":["中餐"]}}}'
```

然后去网页编辑「Bill 松饼」，点「🌐 翻译到英文」，**人工抽验计量单位和烹饪术语**——prompt 里明确要求数字和单位原样保留（180g 必须还是 180g，不许换算），这是最容易出错的地方。

### 两个 action

| action | 谁调 | 输入 → 输出 | LLM 参数 |
|---|---|---|---|
| `translate` | 编辑器的「🌐 翻译到…」 | `{from,to,recipe}` → 结构化 JSON | `json: true`, `temperature: 0.2` |
| `suggest` | 灵感页的「✨ AI 灵感」 | `{prompt}` → `{text}` 纯文本 | `json: false`, `temperature: 0.9` |

**`json` 这个开关必须有。** Gemini 适配器原来把 `responseMimeType: 'application/json'` 写死了——不关掉的话创意建议会被逼成 JSON，读起来像机器报表。

**`suggest` 收的是前端拼好的 prompt，不是结构化数据**（偏离了一期 spec 的原设计）。理由：那段 prompt 已经在 `buildPrompt()` 里写好且是双语的，函数里再拼一份的话，「📋 复制给 Claude」复制走的和 ✨ 送出去的会是两段不同的文字，改了一处忘了另一处就各说各话。发现成的 prompt 则天然一致，输出语言跟界面语言走也自动成立。代价是改 prompt 要动前端（记得 bump `?v=`）。

**两个 action 共用同一个 `DAILY_CAP` 计数器**，它护的是 API 账单，不分用途。所以 `err_rate_limited` 的文案是中性的，别改回「翻译次数用完了」。

---

## 五、待处理问题

### ✅ 手机端食材/步骤显示空白（2026-08-03 已确认并修复）

**症状**：同一条食谱，电脑端正常，手机端封面图、标签、区块标题都在，但菜名、食材、步骤全空（显示「还没记食材。」「还没记步骤。」）。

**结论**：缓存假设成立。用户在手机上再次刷新后显示恢复正常，无需其他处理。根治方案已落地——`recipe.html` 的两处资源链接加了 `?v=` 版本号（见下）。

**原因**：手机浏览器缓存的还是**旧版 `assets/recipe.js`**。双语改造把 `recipes` 的三列改名了：

```
name → name_zh,  ingredients → ingredients_zh,  steps → steps_zh
```

旧代码读 `r.name` / `r.ingredients` / `r.steps` → `undefined` → 显示空。而**标签、封面图、成品图正常，恰恰因为 `tags` / `cover_url` / `image_urls` 这三列没有改名**。症状与假设完全吻合。

**为什么会缓存**：`recipe.html` 里这样引资源，没有版本号：

```html
<link rel="stylesheet" href="assets/recipe.css">
<script src="assets/recipe.js"></script>
```

浏览器（尤其手机 Safari）会长期缓存。开发时我一直靠手动加 `?v=<时间戳>` 绕过，但真实用户不会这么做。

**已落地的根治方案**：`recipe.html` 里两处资源链接带版本号，每次改 `assets/` 就手动 bump：

```html
<link rel="stylesheet" href="assets/recipe.css?v=2026080312">
<script src="assets/recipe.js?v=2026080312"></script>
```

没有构建步骤，所以只能手动维护。**改 `assets/` 却忘了 bump 版本号 = 用户看到半新半旧的页面**，这个坑会反复踩，所以 `CLAUDE.md` 里也写了一条。约定用 `年月日+两位序号`，同一天改多次就 `01`→`02`。

四个页面现在都引了 `assets/auth.js`，所以四个都要管。CSS 只有 `recipe.html` 有。

**但 `?v=` 管不了 HTML 自己。** 它只能让 HTML 里**引用的资源**失效，`index.html` / `shopping.html` / `activity.html` / `recipe.html` 这四个文件本身是浏览器直接缓存的，没有构建步骤就没法给它们加指纹。GitHub Pages 给 HTML 设的是 `Cache-Control: max-age=600`（实测），所以**推上线后最多 10 分钟**各设备才会拿到新版。

这意味着：**凡是「前端和后端必须同时切换」的改动，都有一个最长 10 分钟的窗口，期间新旧版本同时在线。** 2026-08-03 上 Auth 时就撞上了——代码推上去后手机上仍是旧页面、旧密码照样能进。处理办法：

1. 别在这个窗口里改数据库策略。等所有设备都确认拿到新版再改，否则旧页面会立刻读不到数据，而且用户没法自救。
2. 想立刻验证某台设备，网址后面加个随便什么参数绕开缓存：`.../index.html?x=1`。
3. 想确认线上到底是不是新版：`curl -s <url>?cb=$(date +%s) | grep -c auth.js`。

### ✅ 全部数据对公网可读可写（2026-08-03 已修）

**曾经的问题**：仓库是 PUBLIC 的（GitHub Pages 免费版要求如此），四个页面的源码里都写着 Supabase URL 和匿名 key。配上 `for all using(true) with check(true)` 的 RLS 策略，结果是任何人都能读、改、删全部数据——2026-08-02 实测用公开信息读到了 `expenses` 107 条、`shopping_items` 39 条、`activities` 9 条。老密码门只挡 UI 不挡 API。

**修法**：换成 Supabase Auth 真登录，RLS 收成 `to authenticated`。细节见第九节。

**仓库仍然是公开的**，所以那条规矩不变：**不要把任何含个人信息的文件提交进仓库**（`requirement.md` 就是因此被 gitignore 的）。

### 🟡 别名表只自动长 canonical，不长别名

用户在网页上录新食材时，写入的是 `{canonical: '番茄', aliases: [], staple: false}`。所以录了「番茄」之后，输「西红柿」仍然被当成另一样东西。

- 种子里只有 20 条常备调料带别名
- 目前只能手工在 Supabase 表里补 `aliases`
- **Edge Function 部署后**可以加一个 `normalize` action（一期 spec 里设计过）：录入时遇到新词，让 LLM 判断「这是不是就是已有的某个？常见别名有哪些？」，用户确认才写入

### 🟡 iPhone HDR 照片在浏览器里发灰

**已确诊，非 bug，是浏览器能力边界。** iPhone 拍的是 Display P3 + **PQ** 编码。浏览器不做 PQ 传输函数转换，把 PQ 数值当普通 sRGB 渲染，结果饱和度和对比度都只剩一半。

实测数据（同一张图）：

| | 饱和度 | 对比度 |
|---|---|---|
| 原图（P3/PQ） | 0.2099 | 0.1282 |
| 转 sRGB 后 | **0.4266** | **0.2770** |

**canvas 也救不了**——实测 canvas 解出来的数值和原始基础层完全一致（0.4451/0.2080），所以网页端无解。

**解法**：上传前用 `scripts/to-srgb.sh` 转一次（macOS ColorSync），或者 iPhone 设置里关掉 HDR 照片。

```bash
./scripts/to-srgb.sh ~/Desktop/今天做的菜      # 支持单张或整个文件夹
```

`uploadImage` 现在对 4MB 以内的文件原样上传（不压缩），因为压缩既救不了 HDR，还会丢 ICC profile。

---

## 五点五、工作区里那些不进版本库的文件

以前 `git status` 会常驻显示四项未跟踪文件。**它们都不是遗漏也不是垃圾**，只是一直没人决定归属。2026-08-02 处理完了，工作区现在是干净的——再看到未跟踪文件就是真的新东西，值得看一眼。

| 路径 | 是什么 | 处理 |
|---|---|---|
| `recipe-details/` | 食谱录入的源料目录，见下 | `.gitignore` |
| `requirement.md` | 家庭账单页最初的需求描述，含房租金额、分账方式、一整月开支流水 | `.gitignore` ⚠️ **仓库是公开的，不要提交** |
| `shopping_list.md` | 购物清单页最初的需求描述 | `.gitignore`，同上 |
| `.claude/settings.json` | Claude Code 的项目级 Bash 权限白名单，无密钥 | ✅ 已提交 |

### `recipe-details/` 是录入工作流的一部分

结构是一个食谱一个文件夹：

```
recipe-details/
└── Bill Pancake/
    ├── Bill Pancake.md    ← 原始配方（frontmatter + 食材 + 步骤 + 小贴士）
    └── 1.jpg              ← 原始照片，iPhone 直出
```

用户把配方和照片丢进这里，然后录进网页。**这里的照片是母版**——Storage 里那份是转过 sRGB 的衍生品（见第五节 HDR 问题）。

**已决定走 `.gitignore`**，理由：照片母版本来就在用户的相册备份体系里，仓库没必要再存一份，各司其职。一个食谱约 732K，进了仓库会随食谱数量线性膨胀，而且提交过的大文件即使以后删掉也永远留在 git 历史里。

### 录入方式：Claude 直接读 md 上传，不要写解析器

用户把 md 和照片丢进 `recipe-details/<菜名>/`，说一声，**Claude 读 md → 转图 → curl 上传**。Bill Pancake 就是这么进去的。

**md 不需要固定格式，这是有意的。** 看一眼 `Bill Pancake.md` 就知道为什么：frontmatter、emoji 标题、湿性/干性分组、括号里的替代方案、`14g - 28g` 这种区间用量——没有哪个解析器扛得住这种自由度，而 Claude 读起来毫无压力。**别为了"规范化"去写 md 解析器，那是把这条路最大的好处扔掉。**

顺带三个好处，都是网页端的 Gemini 翻译给不了的：

1. **翻译质量更高。** Gemini 拿到的是一段孤立 JSON 只能逐字翻；Claude 看得到整份食谱的上下文，遇到「一杯面粉」这种含糊的还能直接问用户。
2. **不烧配额。** 免费档那 20 次/天留给手机上临时录入。
3. **顺手补别名。** 录入时把 `番茄 ← 西红柿 / tomato` 一起写进 `ingredient_vocab.aliases`，还有 `tag_i18n` 的中英对照。这正是第五节 🟡 那条「别名表只自动长 canonical」想解决的问题——**这条路等于绕过了 `normalize` action 的必要性**。

网页上手动录入仍然走 Gemini 自动翻译。两条路各管各的场景，不冲突。

#### 上传前要先换令牌

数据库现在要登录才能写，但**密码不该出现在 Claude 会话里**。所以：

```bash
python3 scripts/get-token.py                              # 用户自己跑，密码不回显
curl ... -H "Authorization: Bearer $(cat .token)"          # Claude 这样引用
```

`.token` 已 gitignore（仓库是公开的），权限 0600，1 小时过期。Claude 全程看不到密码，也看不到令牌本身——用的是 shell 展开。

**照片记得先转 sRGB 再传**：`./scripts/to-srgb.sh recipe-details/<菜名>/`（理由见第五节 HDR 那条）。

### 三件必须说清楚的事

1. **删掉本地源料不影响网页。** 网页图片存在 Supabase Storage，是完全独立的一份拷贝。已实测确认：本地 720K 原图与 Storage 里 1186 KB 的 sRGB 版毫无关联。

2. **但 Storage 不是备份。** 项目被删、免费额度超了、账号出问题，图片一样会没。它只保证「网页能显示」，不保证「照片不会丢」。真正的照片备份在用户的相册系统里。

3. **母版没了就回不去了。** Storage 里是已经转过 sRGB 的衍生品，从它再加工只会越来越差。想重新裁切、换尺寸，或者以后浏览器支持 HDR 了想重新转一次，都需要母版。所以**录入完成后不要急着删本地源料，确认相册里有原片再说**。

---

## 六、防踩坑经验

### 代码结构

**`assets/recipe.js` 里的「启动块」必须在文件最末。** 上面用 `let` 声明的 `vocab` / `recipes` / `loaded` / `lastSig` 在求值到那几行之前处于暂时性死区，提前调 `initApp()` 会在 `if (loaded)` 上抛 `ReferenceError`——**页面外壳看起来完全正常、同步点还是绿的（那是 HTML 里的初始 class，不是成功信号），但内容区永远空白**。这个坑踩过一次，别再踩。

**纯逻辑段落是这个仓库唯一能自动验证的部分。** `assets/recipe.js` 里 `// ── PURE LOGIC START ──` / `// ── PURE LOGIC END ──` 之间的函数不碰 DOM 也不碰网络，`scripts/verify-recipe-logic.js` 会把这段切出来 eval 跑真断言。

```bash
node scripts/verify-recipe-logic.js     # 必须从仓库根目录跑
```

改这段代码时**保持它无副作用**。加新纯函数就顺手加断言——这是唯一的安全网。

**大范围重写函数时，检查有没有把别的函数一起删掉。** 我重写视图层时把 `initApp` 整个删了，页面直接白屏。事后加的交叉检查：

```bash
python3 - <<'PY'
import re
src = open('assets/recipe.js').read() + open('recipe.html').read()
called = set(re.findall(r'\bon(?:click|input|focus|blur|change|submit|keydown)="[^"]*?\b([a-zA-Z_]\w*)\(', src))
called |= set(re.findall(r'onmousedown="([a-zA-Z_]\w*)\(', src))
defined = set(re.findall(r'(?:async\s+)?function\s+(\w+)', open('assets/recipe.js').read()))
print("引用了但没定义:", sorted(called - defined - {'setTimeout','event','confirm','alert','render','getElementById','if'}) or "无 ✅")
PY
```

### 验证环境的坑

**浏览器 pane 隐藏时：**

- `canvas.toBlob()` 被节流到 **~21 秒一次**（40×20 的画布也一样），会直接撑爆 `javascript_tool` 的 30 秒超时。要拆成多次调用，中间状态挂 `window` 上。
- `document.visibilityState` 是 `'hidden'`，所有靠它 gate 的代码（比如 15 秒轮询）会**静默空转**。我第一次测轮询「全绿」其实三个断言全是空转的。用 `Object.defineProperty(document, 'visibilityState', {value:'visible', configurable:true})` 打桩再测。
- 自动化点击不一定能派发到元素上（`navigator.clipboard.writeText` 那个按钮就没测成）。

**Supabase Storage 公开 URL 走 CDN 缓存。** 删掉的对象仍可能返回 200。要判断是否真删了，用带 cache-buster 的 URL，或查 bucket listing / 认证端点。

**改了 `assets/` 之后本地测试要加 cache-buster**：`recipe.html?v=<时间戳>`，否则浏览器给你旧文件。（这也正是第五节那个手机 bug 的根源。）

**写 `until` 轮询条件时当心匹配过宽。** 我写过 `grep -q 'margin-bottom: 22px;$'` 来等新 CSS 上线，结果旧的那行也以它结尾，循环提前退出、误报「已部署」。

### 测试自己的断言

**写完断言先让它失败一次。** 计划里每个纯逻辑任务都有一步「先跑一次确认它报错」，这不是仪式——它是唯一能证明断言真的在测代码、而不是空转通过的方法。

**断言写错比没写更糟。** 我有两次断言写错导致误报：一次拿整个 recipe 对象去匹配调料名（`ingredient_keys` 里当然有），一次在同步循环里连设 `location.hash` 而 `hashchange` 是异步的。看到意外的失败，先怀疑断言。

### 与用户协作

- **小改动直接推**，不要每次都问。CSS 调色、文案微调、单元素调整这类。
- **视觉方向不明确时给 2–4 个带 ASCII 预览的选项**，用户对这个反馈很好。不要用浏览器可视化伴侣（用户明确嫌太耗 token）。
- **回复用中文。**
- **API key 绝不要让用户发过来**，让他们直接贴进 Supabase secrets。
- 建表、建 bucket、部署函数**都得用户自己操作**，会话里没有控制台权限。SQL 和代码可以给现成的。

---

## 七、常用命令

```bash
# 纯逻辑验证（改了 PURE LOGIC 段就跑）
node scripts/verify-recipe-logic.js

# 解析检查
node -e 'new Function(require("fs").readFileSync("assets/recipe.js","utf8"));console.log("ok")'

# CSS 括号平衡
node -e 'const s=require("fs").readFileSync("assets/recipe.css","utf8");const o=(s.match(/{/g)||[]).length,c=(s.match(/}/g)||[]).length;console.log(o===c?"ok "+o:"MISMATCH "+o+"/"+c)'

# i18n 中英 key 对齐检查
python3 - <<'PY'
import re
src = open('assets/recipe.js').read()
zhb = src[src.index('  zh: {'):src.index('  en: {')]
ens = src.index('  en: {'); enb = src[ens:src.index('\n};', ens)]
kr = re.compile(r'(?:[{,]\s*|^\s+)([a-zA-Z_]\w*)\s*:')
zh, en = set(kr.findall(zhb))-{'zh','en'}, set(kr.findall(enb))-{'zh','en'}
print(f"zh {len(zh)} / en {len(en)}  差集: {sorted(zh ^ en) or '无'}")
PY

# 本地预览
python3 -m http.server 8765      # 然后开 localhost:8765/recipe.html?v=$(date +%s)

# 看数据
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
B=https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1
curl -s "$B/recipes?select=id,name_zh,name_en,tags" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$B/ingredient_vocab?select=canonical,aliases,staple" -H "apikey: $K" -H "Authorization: Bearer $K"
curl -s "$B/tag_i18n?select=zh,en" -H "apikey: $K" -H "Authorization: Bearer $K"

# 照片转 sRGB（上传前）
./scripts/to-srgb.sh <照片或文件夹>
```

---

## 八、下一步建议顺序

0. ~~和用户确认数据公开可读这件事~~ ✅ 2026-08-03 完成，换成了 Supabase Auth（第九节）
1. ~~验证并修复手机端空白~~ ✅ 2026-08-03 完成
2. ~~部署 Edge Function~~ ✅ 2026-08-03 完成
3. ~~加 `normalize` action~~ —— **降级不做**。2026-08-03 改成补了一份 145 条的食材词表（`supabase/seed-ingredient-vocab.sql`），零配额零风险地覆盖了绝大多数情况；md 录入那条路本来也会顺手补别名。理由见 `docs/superpowers/specs/2026-08-03-ingredient-vocab-seed-design.md`。
4. ~~购物清单联动~~ ✅ 2026-08-03 完成
5. ~~`suggest` action~~ ✅ 2026-08-03 完成
6. ~~外币开支按记账日汇率折算~~ ✅ 2026-08-04 完成，见第十节

**清单已清空，目前没有待办。** 下一步做什么由用户决定。

用户明确砍掉、别自作主张加回来的：评分、心得笔记、烹饪时间、难度、来源链接、每步配图、深色模式、第三种语言。

**目前没有待办。** 下一步做什么由用户决定。

---

## 九、登录是怎么工作的（2026-08-03 起）

### 一句话

网页密码现在是一个**真实 Supabase 账号**的密码。登录成功换回令牌，数据库的 RLS 只认登录用户——**没有令牌 = 数据库层面直接拒绝**，而不是像以前那样只把界面藏起来。

### 账号

| | |
|---|---|
| 邮箱 | `home@household.local`（写死在 `assets/auth.js`，**故意用收不到信的假地址**——仓库是公开的，写真实邮箱等于把它送去被爬） |
| 密码 | 只在用户手里和 Supabase 里，仓库里没有 |
| 数量 | **一个，两人共用**。数据库本来就不记录谁改了什么，两个账号换不来任何东西，只会让登录框多一个邮箱输入框 |
| 忘了密码 | 控制台 Authentication → Users 直接重设。用不着邮件找回——项目 owner 就是用户自己 |

**⚠️ 公开注册必须保持关闭**（Authentication → Sign In / Providers → Email → Allow new users to sign up）。策略是「登录用户可读写」，一旦谁都能自助注册，注册完就有了和两人一样的权限，整套改造归零。验证方法：

```bash
curl -s -X POST 'https://mpvsbeghuueffkjdemcr.supabase.co/auth/v1/signup' \
  -H 'apikey: sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5' \
  -H 'Content-Type: application/json' \
  -d '{"email":"probe@evil.test","password":"Whatever12345!"}'
# 期望：{"code":422,"error_code":"signup_disabled",...}
```

### 代码

`assets/auth.js` 是四个页面共用的唯一一份登录代码，**必须在各页面自己的脚本之前加载**——它定义了 `KEY` 和 `H()`。

| 函数 | 干什么 |
|---|---|
| `signIn(password)` | 登录页调用，换令牌，成功返回 true |
| `resumeSession()` | 启动块调用，本地有令牌就续一次；返回 true 才进 app |
| `H()` | **所有** PostgREST / Storage 请求的鉴权头。令牌过期会先自动续 |
| `signOut()` | `lockApp()` 调用，清掉令牌 |

`H()` 是 async 的，所以调用点长这样——32 处全是这个形状：

```js
fetch(url, { headers: await H() })
fetch(url, { method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' } })
```

**加新的 fetch 时照抄这个形状。** 写成 `headers: H` 会把函数本身当 header 传出去，请求直接 401。

### 两个不显眼但重要的地方

**续期请求做了去重**（`auth.js` 里的 `refreshing`）。Supabase 每次续期都会作废旧的 refresh_token，几个请求同时续会有人拿到 `invalid_grant`，然后把登录态清掉——症状是「用着用着突然被踢回登录页」。四个页面都有 15 秒轮询 + 用户操作并发，这个坑一定会踩到。

**令牌存 `localStorage['hh_tok']`，不是 sessionStorage。** 登录态该跨会话保持，否则手机上每次切回来都要重输密码。（对比：语言偏好也在 localStorage，见 `recipe.js` 的 `LANG_KEY`。）

### RLS 策略长什么样

八张业务表统一是这一条：

```sql
create policy authed_all on public.<表名> for all to authenticated using (true) with check (true);
```

`to authenticated` 是关键——没登录的请求走 `anon` 角色，没有任何策略匹配，直接拒绝。`ai_usage` 故意没有策略：只有 Edge Function 用 service role 访问，service role 绕过 RLS。

Storage 的 `recipe-images` 桶原来有三条 `{public}` 策略（read / insert / delete），2026-08-03 合并成一条：

```sql
create policy "recipe images authed" on storage.objects
  for all to authenticated
  using      (bucket_id = 'recipe-images')
  with check (bucket_id = 'recipe-images');
```

**桶本身仍然是 public，这是有意的。** 公开桶的 `/object/public/...` 端点根本不查策略——实测不带任何 key 也能下到图，所以 `<img src>` 照常工作。把 SELECT 收成 `authenticated` 影响的只是**列目录**（`/object/list/...`），不是显示。

所以这条策略挡住的是：匿名上传、匿名删除、以及枚举文件名。**挡不住的是**：已经拿到某张图 URL 的人还能看那张图。文件名是随机生成的（`randomName()`），列目录堵上之后只能靠猜。想连这个也挡住，得把桶改私有 + 前端改用签名 URL——评估过，照片不敏感，不值得。

2026-08-03 实测：匿名列目录返回 `[]`（改之前能看到 `bill-pancake/…`），匿名上传 400，匿名删一张真实存在的图 400 且文件完好（同一 URL 仍下得到 1214097 字节），公开 URL 200。登录状态下在食谱页传图和删图都正常——`uploadImage` / `deleteImage` 现在走 `await H()`，会话里没有密码验不了，是用户手工确认的。

### 想验证有没有真的锁上

**⚠️ 只看 HTTP 状态码会误判。** 被 RLS 挡住的**读取**返回的是 `200` + 空列表 `[]`，不是 401——数据库的语义是「把你有权看的行给你」，你没权看就是零行，不算错误。只有**写入**才会 401。所以要看条数：

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
B=https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1
for t in expenses cycles shopping_lists shopping_items activities recipes ingredient_vocab tag_i18n; do
  printf '%-18s ' "$t"
  curl -s -I "$B/$t?select=*" -H "apikey: $K" -H "Authorization: Bearer $K" \
    -H "Prefer: count=exact" -H "Range: 0-0" | grep -i content-range | tr -d '\r'
done
```

**每一行都必须是 `*/0`。** 任何一张表出现非零条数，就是那张表漏了策略——回去核对上面 SQL 的表名列表。

2026-08-03 实测：8 张表全部 `*/0`（改之前 `expenses` 是 107），写入全部 401，登录后读回来仍是完整的 107 条。

---

## 十、外币开支（2026-08-04 起）

### 一句话

家庭账单页记一笔外币开支时选货币和金额，页面按**那一天**的汇率折算成 AUD 存进 `amount`，同时把原币金额和用掉的汇率一并留痕。

设计和实施计划：
- `docs/superpowers/specs/2026-08-04-multi-currency-expense-design.md`
- `docs/superpowers/plans/2026-08-04-multi-currency-expense.md`

### 支点：`amount` 的语义一个字都没改

这是整个改动能做得这么小的原因。分账、hero 结算、`newCycle()` 结转、往期记录合计——全部代码一行没动，因为它们读的还是同一个 `amount`。

- 三列全 NULL = 这笔本来就是 AUD 记的。107 条老数据**没有迁移**。
- 不变式：`amount = round(orig_amount × fx_rate, 2)`。
- **冲突时以 `amount` 为准**，`orig_*` 是留痕，不是真相来源。

`fx_rate` 的方向定死为「**1 单位原币值多少 AUD**」（日元是 0.00889 这种小数）。反向存看着好读，但换算要做除法，四舍五入的坑更多。

### 汇率从哪来

`https://api.frankfurter.dev/v1/<日期>?base=<币种>&symbols=AUD`

- 欧央行口径，**30 种货币**，免费、不要 key、支持按日期查历史。
- **浏览器直连**——实测返回 `access-control-allow-origin: *`，不用 Edge Function 代理，也就不吃 Gemini 那 20 次/天的配额。
- ⚠️ **这是整个仓库唯一一处不带 `H()` 的 fetch。** 它是第三方，带上等于把登录令牌送给 frankfurter.dev。
- 旧域名 `api.frankfurter.app` 现在 301 跳转，别用。
- 缺越南盾、新台币、迪拉姆——走手填汇率那条路。

**拿不到当天牌价时会回退到上一个有牌价的日子**，响应里的 `date` 是真实日期。回退了界面会标一句「取的是 X 的收盘价（当天还没有牌价）」，不闷声换掉。

⚠️ **回退是常态，不是边角情况。** 欧央行每天欧洲时间下午才发布当日牌价，而澳洲比欧洲快 8–10 小时——**在澳洲白天记当天的账，几乎必然拿到前一天的牌价**。2026-08-04 验收时就是这样（周二，没有任何休市，照样回退到 08-03）。所以那句提示原来写的「当天休市」是错的，2026-08-04 改掉了；周末休市只是触发回退的原因之一，别再把文案写死成休市。

缓存在 localStorage `hh_fx`（`{"2026-08-04|JPY":0.00889}`）。历史汇率不可变，只增不删，不用做淘汰。上次用的货币存在 `hh_last_ccy`。

### 三个容易踩的地方

**1. `toLocal` / `toDB` / `expenseSig` 必须一起改。** 漏一处就是一类静默 bug：漏 `toLocal` 原币读不回来；漏 `toDB` 轮询签名两边永远不等、每 15 秒无脑重渲染；漏 `expenseSig` 则只改原币的编辑同步不过去。

`expenseSig` 里 `fx_rate` 也必须在——手改汇率 `0.00889 → 0.008891`，3200 日元两次都算出 A$28.45，不带 `fx_rate` 的话签名不变，另一台设备永远刷不到这次修改。

**2. `submitExpense` 写内存对象时必须带上 `origCcy` / `origAmount` / `fxRate`。** 它们是手写的对象字面量，不走 `toDB`。少了的话除了当场显示不出原币，更糟的是：`confirmDel` 走 `toDB(e)`、`undoDel` 再插回去，删一下再撤销就会把 NULL 盖到好数据上。

**3. `currencyDisplay` 用 `'code'` 不能用 `'narrowSymbol'`。** 后者把 USD 和 SGD 都渲染成 `$`，跟同一行旁边的澳币撞车；`¥` 在日元和人民币之间也有歧义。另外 ICU 在代码和数字之间插的是 **U+00A0 不换行空格**不是普通空格，`fmtOrig` 里归一成普通空格，否则断言在不同 ICU 版本之间会飘。

### 验证

`index.html` 现在也有 PURE LOGIC 段了（以前只有 `assets/recipe.js` 有）：

```bash
node scripts/verify-fx-logic.js     # 必须从仓库根目录跑
```

`scripts/verify-refs.py` 这次也扩了：以前对 HTML 只扫 `<script>` 里的内容，标签上的 `onclick="openAdd()"` 完全看不见。现在两边都扫，并且用 `PAGE_DEPS` 登记了「哪个页面 `<script src>` 进了哪个文件」，否则 `recipe.html` 会永久报 5 个假阳性。
