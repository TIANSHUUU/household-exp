# household_exp 项目 Handoff

最后更新：2026-08-02

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

四页共用同一个密码门（`PWD_HASH` + `sessionStorage['hh_auth']`），任一页解锁则四页通行。**没有身份区分**——两人权限完全相同，数据库不记录谁改了什么。

---

## 二、食谱页现状

### 已完成

**一期（纯前端）** —— 食谱 CRUD、图片上传、食材搜索、冰箱分桶匹配、购物清单联动（未做，见下）、15 秒轮询同步。全部实测通过。

**双语（A + B）** —— 界面中英切换（82 个文案 key 两边对齐）、内容双语存储、编辑器中文/EN 双页签、缺失自动回退。已上线。

**双语（C）自动翻译** —— 代码全部上线，**但 Edge Function 还没部署**。见第四节待办。

### 未做（有意的）

- **购物清单联动**（原三期）：分桶结果里「再买 X + Y」一键写进 `shopping_items`。设计在一期 spec 里，没实现。
- **✨ 创意建议**：Edge Function 的 `suggest` action。目前只实现了 `translate`。替代方案是灵感页的「📋 复制给 Claude 提问」按钮（已上线可用）。
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

storage bucket: recipe-images（public read，路径 recipes/<folder>/<随机名>）
```

### 三条不能破的约定

1. **`ingredient_keys` 永远是中文 canonical。** 它是匹配和搜索的机器键。双语化会让集合运算要跨语言对齐，凭空多一类 bug。英文搜索靠 `ingredient_vocab.aliases` 里的英文别名命中（`buttermilk → 酪乳` 实测可用）。

2. **`tags` 永远存中文 canonical**，英文显示走 `tag_i18n` 查表。标签在食谱间高度重复，存双份会冗余且筛选栏要按语言去重。

3. **`staple = true` 的食材在冰箱匹配时默认「你有」。** 盐、油、酱油、泡打粉、苏打粉等 20 条。**不标 staple，每道菜都会提示「再买 5 样」，超过 3 样上限后直接不显示——功能等于废掉。** 新增常备调料记得标。

---

## 四、待办：部署 Edge Function ⚠️

这是唯一卡住的事。**只能由拥有 Supabase 控制台的人做，Claude 会话里做不了。**

代码已就位：`supabase/functions/kitchen-ai/index.ts`

### 步骤

1. Supabase 控制台 → **Edge Functions** → **Deploy a new function**
2. 函数名 **`kitchen-ai`**（必须一字不差——前端 `FN_URL` 按这个名字请求）
3. 贴入 `supabase/functions/kitchen-ai/index.ts` 全部内容（`pbcopy < supabase/functions/kitchen-ai/index.ts`）
4. **关掉 Verify JWT** ⚠️ ——项目用的是新版 `sb_publishable_` 密钥，它不是 JWT，开着会被直接拒绝。鉴权由函数自己做（`x-kitchen-pw` 头 + 服务端比 hash + 日限额）。
5. 配 secrets：

   | 名称 | 值 |
   |---|---|
   | `PROVIDER` | `gemini` |
   | `GEMINI_API_KEY` | 用户在 Google AI Studio 申请的 |
   | `KITCHEN_PWD_HASH` | `9c2e571eb60385be3ced6e5d4bd7d34837f5219d693e679cd324d5e12b83c4eb` |
   | `GEMINI_MODEL` | 可选，默认 `gemini-2.0-flash`。模型名 Google 会变，不对就填这个覆盖，别改代码 |

   `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 平台自动注入。

### 部署后怎么验

```bash
FN=https://mpvsbeghuueffkjdemcr.supabase.co/functions/v1/kitchen-ai
K=sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5

# 1. 无密码 → 应 401 unauthorized
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "Content-Type: application/json" -d '{"action":"translate","payload":{}}'

# 2. 错误 action → 应 400 unknown_action（带正确密码）
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "x-kitchen-pw: <网页密码>" -H "Content-Type: application/json" \
  -d '{"action":"nope","payload":{}}'

# 3. 真翻译
curl -s -X POST "$FN" -H "apikey: $K" -H "Authorization: Bearer $K" \
  -H "x-kitchen-pw: <网页密码>" -H "Content-Type: application/json" \
  -d '{"action":"translate","payload":{"from":"zh","to":"en","recipe":{"name":"番茄炒蛋","ingredients":[{"name":"番茄","amount":"2个"}],"steps":["热油炒蛋"],"tags":["中餐"]}}}'
```

然后去网页编辑「Bill 松饼」，点「🌐 翻译到英文」，**人工抽验计量单位和烹饪术语**——prompt 里明确要求数字和单位原样保留（180g 必须还是 180g，不许换算），这是最容易出错的地方。

日限额 30 次/天写死在函数里的 `DAILY_CAP`。

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
<link rel="stylesheet" href="assets/recipe.css?v=2026080301">
<script src="assets/recipe.js?v=2026080301"></script>
```

没有构建步骤，所以只能手动维护。**改 `assets/` 却忘了 bump 版本号 = 用户看到半新半旧的页面**，这个坑会反复踩，所以 `CLAUDE.md` 里也写了一条。约定用 `年月日+两位序号`，同一天改多次就 `01`→`02`。

只有 `recipe.html` 需要管这件事——另外三个页面 CSS/JS 全部内联在 HTML 里，改动随 HTML 一起失效，天然没有这个问题。

### 🔴 全部数据对公网可读可写（既有问题，非本次引入）

**仓库是 PUBLIC 的**（`gh repo view` 确认；GitHub Pages 免费版要求如此）。四个页面的源码里都写着 Supabase URL 和匿名 key，任何人查看网页源码即可提取。

配上 `for all using(true) with check(true)` 的 RLS 策略，结果是：**任何人都能读、改、删全部数据。**

2026-08-02 实测（只用公开页面里能提取到的信息）：

| 表 | 可读记录数 |
|---|---|
| `expenses` | 107 |
| `cycles` | 3 |
| `shopping_lists` / `shopping_items` | 2 / 39 |
| `activities` | 9 |
| `recipes` | 1 |

**密码门只挡 UI，不挡 API。** 它把界面藏起来了，数据接口是完全敞开的。这是四个页面从第一天起的设计，不是食谱页引入的。

现实风险取决于有没有人找到这个站——但仓库在 GitHub 上公开可搜，源码里就写着 Supabase 地址。

**可选的收敛方向**（都需要用户决策，别擅自动手，会影响全部四个页面）：

1. **仓库转私有** —— 但 GitHub Pages 免费版要求公开仓库，需要 Pro 订阅。挡住了源码搜索，挡不住已经看过页面的人。
2. **换成 Supabase Auth 真登录**，RLS 策略改成 `auth.uid() is not null`。最彻底，但要给两人建账号，四个页面的密码门全部重写。
3. **接受现状** —— 数据是两个人的家庭开支和菜谱，不是信用卡号。评估过认为可接受也是一种有效选择，但应当是**知情后的选择**，而不是默认。

在用户明确表态前，**不要把任何含个人信息的文件提交进仓库**（`requirement.md` 就是因此被 gitignore 的）。

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

0. **和用户确认数据公开可读这件事**（第五节 🔴）——这是唯一涉及隐私的问题，值得先摆到台面上，即使结论是「接受现状」
1. ~~验证并修复手机端空白~~ ✅ 2026-08-03 完成
2. **部署 Edge Function**（第四节），部署后实际翻一次「Bill 松饼」并人工校对计量单位
3. 加 `normalize` action，解决别名表不自动长别名的问题
4. 购物清单联动（原三期）
5. `suggest` action（✨ 创意建议）
