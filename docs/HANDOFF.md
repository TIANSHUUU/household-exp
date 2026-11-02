# household_exp 项目 Handoff

最后更新：2026-08-04（第二次）

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

四页**都不需要登录**（2026-11-02 起）。`assets/auth.js` 还在，但只剩一个 `H()` 负责拼请求头，令牌那套全删了。**没有身份区分**——数据库不记录谁改了什么。为什么拿掉、代价是什么、怎么装回去，见第九节。

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

   **2026-11-02 起这个函数没有鉴权了。** 原来函数里有个 `verifyUser()`，拿 Bearer 令牌去问 `/auth/v1/user`。网页那套登录拿掉之后，页面只带 publishable key，而 publishable key 不是用户令牌——`verifyUser()` 会把它一律拒掉，翻译功能会整体 401。所以 `verifyUser()` 一起删了。

   **Verify JWT 仍然必须关着**，而且比以前更要紧：页面根本不再带用户令牌，开着的话每个请求都 401。

   现在剩两道防线，都不是鉴权但够用：`ALLOWED_ORIGINS`（只在浏览器里起作用，curl 绕得过）和 `DAILY_CAP = 20`（真正那道）。**最坏情况是有人每天替你烧掉 20 次免费额度，翻译当天不可用——不会产生账单**，Gemini 免费档没绑支付方式。
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

# 2026-11-02 起不需要令牌了，下面一律用 publishable key。

# 1. CORS 预检 → 必须 200。这条是 Verify JWT 有没有误开的试金石：
#     开着的话这里会 401，浏览器里整个翻译功能就用不了，但 curl 测正式
#     请求却一切正常——很容易查半天。
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS "$FN" \
  -H "Origin: https://tianshuuu.github.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization, apikey, content-type"

# 2. 错误 action → 应 400 unknown_action
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -d '{"action":"nope","payload":{}}'

# 3. 真翻译
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
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

### ⚠️ 全部数据对公网可读可写（2026-08-03 修好，2026-11-02 按用户要求重新打开）

**当初的问题**：仓库是 PUBLIC 的（GitHub Pages 免费版要求如此），四个页面的源码里都写着 Supabase URL 和匿名 key。配上 `for all using(true) with check(true)` 的 RLS 策略，结果是任何人都能读、改、删全部数据——2026-08-02 实测用公开信息读到了 `expenses` 107 条、`shopping_items` 39 条、`activities` 9 条。老密码门只挡 UI 不挡 API。

**2026-08-03 的修法**：换成 Supabase Auth 真登录，RLS 收成 `to authenticated`。

**2026-11-02 又改回去了。** 用户在被明确告知后果之后选择去掉登录（两人自用，嫌每次登录麻烦），于是 RLS 放开给 anon，和上面那段描述的状态基本一致。**所以这不是一个待修的 bug，是一个已知且被接受的取舍**——下一任接手的人别当成疏忽去"修"，先问用户。完整理由和装回去的办法见第九节。

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

#### 上传直接用 publishable key

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
curl ... -H "apikey: $K" -H "Authorization: Bearer $K"
```

2026-11-02 之前这里要先跑 `scripts/get-token.py` 用网页密码换一个 1 小时的令牌，写进 gitignore 的 `.token`，为的是不让密码进 Claude 会话。登录拿掉之后那个脚本没用了，已删（git 历史里还在）。如果工作区里还躺着一个旧的 `.token`，那是过期的死文件，`rm .token` 掉就行。

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
node scripts/verify-recipe-logic.js     # assets/recipe.js 的，必须从仓库根目录跑
node scripts/verify-fx-logic.js         # index.html 的（2026-08-04 加）
```

**`index.html` 2026-08-04 起也有 PURE LOGIC 段了**，装的是外币换算那一套纯函数。以前这仓库只有 `assets/recipe.js` 能自动验，账单页动了只能靠手点。

改这段代码时**保持它无副作用**。加新纯函数就顺手加断言——这是唯一的安全网。而且**断言写完先让它失败一次**再改对，否则你不知道它是真在测代码还是空转通过。

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
node scripts/verify-recipe-logic.js      # assets/recipe.js 的
node scripts/verify-fx-logic.js          # index.html 的（2026-08-04 加）

# 共用小函数有没有在页面之间悄悄分化（2026-08-04 加，理由见第十一节）
python3 scripts/verify-shared-fns.py

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
7. ~~去掉登录~~ ✅ 2026-11-02 完成，见第九节

8. ~~加定时 ping 防止免费档自动暂停~~ ✅ 2026-11-02 完成，见 `.github/workflows/keepalive.yml`（filmfest 那边还差一份，见第十二节）

**目前没有待办。** 下一步做什么由用户决定。

用户明确砍掉、别自作主张加回来的：评分、心得笔记、烹饪时间、难度、来源链接、每步配图、深色模式、第三种语言。

---

## 九、为什么没有登录（2026-11-02 起）

### 一句话

**四个页面不需要任何密码，打开网址就能用。** 数据库的 RLS 对匿名角色全开，页面只带一个写在源码里的 publishable key。

### 这是一个取舍，不是疏忽

2026-08-03 到 2026-11-02 之间，这里是一道**真门**：网页密码是一个真实 Supabase 账号的密码，登录换回令牌，RLS 写的是 `to authenticated`，没令牌在数据库层面直接拒绝。

2026-11-02 用户要求拿掉，理由是两人自用、嫌每次登录麻烦。**后果在动手前已经明确告知**：

> 仓库是 PUBLIC 的，publishable key 就写在 `assets/auth.js` 里，所以任何人拿到网址都能**读、改、删**全部开支/活动/购物/食谱数据。

用户确认后执行。**下一任接手的人：别把这个当 bug 去"修"，先问用户。**

### 代价具体是什么

| | 现在 |
|---|---|
| 读数据 | 任何人，只要有网址 |
| 改 / 删数据 | 任何人，只要有网址 |
| 传 / 删菜谱照片 | 任何人 |
| AI 翻译 | 任何人，但被 `DAILY_CAP = 20` 挡着，最坏是替你烧掉当天额度，不产生账单 |
| 列 Storage 目录 | 任何人 |

挡在前面的只剩「没人知道这个网址」。搜索引擎可能收录 GitHub Pages，仓库本身也是公开可搜的。

### 代码

`assets/auth.js` 还在，**仍然必须在各页面自己的脚本之前加载**——它定义了 `KEY` 和 `H()`。但里面只剩这些：

| 函数 | 干什么 |
|---|---|
| `H()` | **所有** PostgREST / Storage 请求的请求头。async，但不再做任何网络请求 |

`signIn` / `signOut` / `resumeSession` / `refreshTok` / `saveTok` / `loadTok` / `clearTok` / `tokenReq` 全部删除。

**`H()` 保持 async 是刻意的**——四个页面有 30 多处 `await H()`，签名一动就得全改。调用形状一个字都没变：

```js
fetch(url, { headers: await H() })
fetch(url, { method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' } })
```

**加新的 fetch 时照抄这个形状。** 写成 `headers: H` 是把函数本身当 header 传出去。

### RLS 策略长什么样

八张业务表统一是这一条：

```sql
create policy open_all on public.<表名> for all using (true) with check (true);
```

**关键在于没有 `to authenticated`**——不写 `to` 就等于 `to public`，所有角色都匹配，包括没登录的 `anon`。

Storage：

```sql
create policy "recipe images open" on storage.objects
  for all
  using      (bucket_id = 'recipe-images')
  with check (bucket_id = 'recipe-images');
```

`ai_usage` **故意没有任何策略**：只有 Edge Function 用 service role 访问，service role 绕过 RLS。放开它等于把 AI 日限额的计数器交给公网改。

执行用的 SQL 存档在 `supabase/2026-11-02-open-rls-to-anon.sql`。

### ⚠️ 验证时只看 HTTP 状态码会误判

这条在两个方向上都成立，**调试时最容易栽在这儿**：

**被 RLS 挡住的读取返回 `200` + 空列表 `[]`，不是 401。** 数据库的语义是「把你有权看的行给你」，没权看就是零行，不算错误。只有**写入**才会 401。

所以验证要看**条数**，不是状态码：

```bash
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5
B=https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1
for t in expenses cycles activities shopping_lists shopping_items recipes ingredient_vocab tag_i18n; do
  n=$(curl -s -D - -o /dev/null -H "apikey: $K" -H "Authorization: Bearer $K" \
      -H 'Prefer: count=exact' -H 'Range: 0-0' "$B/$t?select=*" \
      | grep -i '^content-range' | tr -d '\r' | sed 's|.*/||')
  printf '%-18s %s\n' "$t" "$n"
done
```

**现在期望看到真实条数**（`expenses` 应该是 107 上下）。如果全是 `0` 或 `*/0`，说明 RLS 还没放开——SQL 那步没跑或没跑成。

### 想装回去怎么办

账号**没有删**，还在 Authentication → Users 里（`home@household.local`），公开注册也仍然关着。所以装回去不用重建账号：

1. 把这次的改动 revert 掉（`git log` 找 2026-11-02 那个 commit）
2. SQL Editor 里把八张表 + storage 的策略改回 `to authenticated`
3. Edge Function 把 `verifyUser()` 加回去并重新部署
4. 控制台 Authentication → Users 重设一个密码（用户自己来，会话里没权限）

⚠️ **顺序很重要**：先部署前端，确认所有设备都拿到新版，再改数据库策略。反过来做的话，旧页面会立刻读不到数据而且用户没法自救——理由见第五节的缓存窗口那条。

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
- ⚠️ **这是整个仓库唯一一处不带 `H()` 的 fetch。** 它是第三方，没理由把我们的 apikey 送过去。（2026-11-02 之前更严重：那时 `H()` 带的是真的登录令牌。）
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


---

## 十一、四个页面之间的代码重复（2026-08-04）

### 现状：有意为之，不是欠账

四个页面各自把 CSS 和 JS 内联在自己的 HTML 里。这带来了可测量的重复：

- **18 个同名函数**在多个页面里各写了一遍
- **41 个 CSS class 选择器**在多个页面里各定义了一遍

**这是有意的取舍，不要一看到就想抽模块。** 换来的是：没有构建步骤、推 `main` 即上线、双击 HTML 就能打开、十年后依然跑得动。

### 2026-08-04 发现的真问题

`escHtml`（把用户输入拼进 HTML 前的转义）在 `index.html` 里还是旧版本：

```js
// index.html 的旧版：不转义单引号，也没有 String() 兜底
function escHtml(s) { return s.replace(/&/g,'&amp;')... }

// shopping.html / activity.html 的改进版
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({...}[c])); }
```

**改进只传播到了 3 个页面里的 2 个**，而且没有任何机制会告诉你漏了。

（当时**不构成漏洞**——`index.html` 里两处用法都在标签之间的文本位置，不在属性里，少转义单引号不影响。但这正是重复代码的典型形态：修复只走到一半，静悄悄的。）

已统一。`setSyncDot` 顺手也统一了写法（三个页面行为本来就相同，只是 `index.html` 拆成了三行，留着会让检测脚本永远报它）。

### 选的方案：检测，而不是抽取

加了 `scripts/verify-shared-fns.py`。它盯 `WATCH` 里登记的 7 个函数，多个页面都定义了就必须字节相同（忽略空白）。

**为什么不抽成 `assets/common.js`：**

1. **规模不够。** 真正"应该完全一样"的只有 7 个小函数，且都不长。
2. **一半的重复是合理的。** `render` / `itemRowHtml` / `startPolling` / `showLoading` 在各页面本来就该不同——账单的行和活动的行不是一回事，三个页面的 DOM 结构也不同。硬统一会造出塞满 `if (页面 === 'xxx')` 的怪物，比重复更难维护。
3. **风险不对称。** 那是横跨 3 个页面的重构，而 `shopping.html` / `activity.html` **没有任何自动化测试**，改坏了只能靠手点发现。
4. **抽取会继承 `?v=` 维护负担**（见第五节）。为几个小函数背这个负担不划算。

**什么时候该重新考虑抽取**：下次要大改这几个页面的时候顺手做——那时本来就要动这些代码，边际成本接近零。或者当 `WATCH` 长到十几二十个的时候。

**为什么不上 `import` / `export`**：四个页面有 **74 处内联事件处理器**（`onclick=` 54 处、`onkeydown` 8 处、`onchange`/`oninput`/`onblur`/拖拽等 12 处）。`<script type="module">` 里的函数是模块作用域的、不挂全局，`onclick="openAdd()"` 会直接报未定义。要转就得把 74 处全改成 `addEventListener`——纯风险没收益。而且 `import` 需要 HTTP 服务，双击打开 HTML 就用不了了。

### 加新的共用函数时

如果它确实该在各页面保持一致，往 `verify-shared-fns.py` 的 `WATCH` 里加一个名字和**理由**。`WATCH` 是主动登记的清单，不是「除了这些都要管」——不登记的重复函数它一概不看。

---

## 十二、项目被暂停过一次（2026-11-02）

### 症状

四个页面全部「登录失败，请检查密码和网络」，密码明明是对的。家庭电影节（另一个项目）的片单和观看记录看起来全没了，页面一片空白。

### 真正的原因

**Supabase 免费档：项目不活动 7 天就自动暂停。** 最后一次提交是 2026-08-03/04，到 11-02 整整 90 天没人碰，两个项目（`household-exp` 和 filmfest 的 `ponlziluphtwopmvzrgd`）都被暂停了。

暂停不是删除——数据、备份、Storage 全部完好，控制台点 Resume 就回来。但**暂停会把基础设施拆掉，连 DNS 记录一起没**，所以从外面看跟项目被删了一模一样。

### 怎么一眼确诊

```bash
dig +short @8.8.8.8 mpvsbeghuueffkjdemcr.supabase.co A
```

- **有 IP** → 项目活着，问题在别处
- **NXDOMAIN** → 项目没在运行。**别去查密码、别去查代码**

⚠️ **NXDOMAIN 区分不了「暂停」和「已删除」**，这一步只能人去 https://supabase.com/dashboard 看。标着 Paused 就点 Resume；项目不见了才是真没了。

Resume 之后 DNS 大约一两分钟生效，但 Postgres 还要再起一会儿——这期间 REST 会返回 `503 PGRST002 Could not query the database for the schema cache`，**这是正常的启动过程，再等 30 秒**。

### 为什么界面把人带偏了

当时 `assets/auth.js` 的 `tokenReq()` 长这样：

```js
return r.ok ? await r.json() : null;   // 服务器说「不行」→ null
} catch (e) {
  return null;                          // 根本连不上 → 也是 null
}
```

两种完全不同的失败被压成同一个 `null`，四个页面又都印同一句「登录失败，请检查密码和网络」。于是「后端没了」和「密码打错了」在屏幕上长得一模一样，用户照着提示反复试密码，试了三个月。

电影节那边同理：请求失败被渲染成空列表，看起来像数据被清空了。**页面不会告诉你它没连上，只是显示空的。**

登录现在整个拿掉了，这个具体的文案 bug 跟着消失了。但**教训是通用的**：任何「失败」路径都该让人分得清是哪一种失败，否则排查时会照着错误的方向走很远。

### 怎么防止再来一次

免费档会**反复**暂停，7 天一次。这次运气好（90 天内还能 Resume），Supabase 的提示写的是可恢复到 **2027-10-20**，过了那个线就只能下载数据、不能恢复项目了。

解法是 `.github/workflows/keepalive.yml`（2026-11-02 加）。有三个不显眼但关键的地方，都踩过才知道：

**一、必须真的查一张表。** `/auth/v1/health` 只摸到网关、不碰 Postgres，用它 ping 等于没 ping，项目照样会被判定不活跃。所以 ping 打的是 `rest/v1/expenses?select=id&limit=1`。

**二、一周两次，不是一次。** 暂停线就是 7 天，而 GitHub 的定时任务在高峰期会被延迟甚至跳过（官方明说不保证准点）。卡着 7 天跑等于赌运气，跳过一次就暂停。周一 + 周四，留 3–4 天余量。cron 的分钟数也避开整点——整点最拥堵。

**三、GitHub 自己也会睡。** **超过 60 天没有仓库活动，GitHub 会自动停用定时任务**——而这个任务存在的全部意义就是应付「几个月没人碰」，不处理的话它会在最需要它的时候先自己死掉，两层保护一起失效。所以每次 ping 完顺手推一个时间戳制造仓库活动。推到独立的 `keepalive` 分支，不污染 `main` 的历史也不触发 Pages 重建；每次都是全新 orphan 分支 + 强推，那个分支永远只有一个提交；用内置 `GITHUB_TOKEN` 推送不会触发其他 workflow（GitHub 刻意的防循环设计），所以不会自我触发。

**ping 失败会让整个 workflow 红掉**，GitHub 随即发邮件。这是免费的早期预警——比三个月后自己发现页面打不开强得多。本地验过两个方向：对活着的项目退出码 0，把 URL 换成不存在的项目会打印 `::error::` 并非零退出。

⚠️ **filmfest 仓库还缺一份。** 两个项目各自暂停、各自恢复，一份管不了两个。内容见本节末尾。
