# household_exp

接手先读 `docs/HANDOFF.md`，那份文档是这个仓库的完整交接说明（架构、数据模型、待办、踩过的坑）。

## 请求头：所有请求必须走 `await H()`

`assets/auth.js` 四个页面共用，**必须在各页面自己的脚本之前加载**（它定义了 `KEY` 和 `H()`）。

**没有登录**（2026-11-02 起，理由见 `docs/HANDOFF.md` 第九节）。`H()` 现在只是拼一个带 publishable key 的请求头，不做网络请求——但它**仍然是 async**，因为四个页面有 30 多处 `await H()`，签名一动就得全改。所以调用形状一个字都没变：

```js
fetch(url, { headers: await H() })
fetch(url, { method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' } })
```

**加新 fetch 时照抄这个形状。** 写成 `headers: H` 是把函数本身当 header 传出去，请求直接失败。

⚠️ **数据库对公网可读可写是已知且被用户接受的取舍，不是待修的 bug。** 别自作主张"修"回去，先问用户。详见 `docs/HANDOFF.md` 第九节。

## 加界面文案要同时加中英两条

账单页和食谱页都有中英切换（2026-11-12 起，共用 `localStorage['hh_lang']`）。详见 `docs/HANDOFF.md` 第十四节。

- `I18N.zh` 和 `I18N.en` **同时**加 key，然后跑 `node scripts/verify-i18n.js`。少一个不会报错，只会在英文界面上露出一句中文。
- 写死在 HTML 里的静态文案要在 `paintChrome()` 里刷，否则切语言时不会变。
- **局部变量不要叫 `t`** —— 会遮蔽 `t()` 词条函数，调用时直接 TypeError。
- 购物页和日程页**只有中文**，不要以为全站都国际化了。

## 改 `assets/` 必须 bump 版本号

四个页面都引了 `assets/auth.js`，`recipe.html` 另外还引了 `recipe.css` / `recipe.js`：

```html
<script src="assets/auth.js?v=2026110201"></script>
```

**改了 `assets/` 里任何文件，就要把引用它的页面的 `?v=` 一起 bump。** 格式是 `年月日+两位序号`，同一天改多次就 `01`→`02`。

⚠️ **「一起」是字面意思——四个页面都引了 `auth.js`。** 实际的出错方式不是忘记 bump，而是**只 bump 了自己正在调试的那个页面**，别的页面继续用缓存的旧文件。2026-11-12 就出现过这个状态（recipe.html 单独超前）。跑 `node scripts/verify-asset-versions.js` 能抓到。

仓库没有构建步骤，只能手动维护。忘了 bump 的后果是手机浏览器继续用缓存的旧文件——2026-08-02 双语改造后就这样踩过一次：数据库列改名成 `name_zh` / `ingredients_zh` / `steps_zh`，手机上跑的旧 JS 还在读 `name` / `ingredients` / `steps`，页面外壳正常但内容全空。

## 其他

- 回复用中文。
- 小改动（CSS 调色、文案微调、单元素调整）直接改直接推，不用每次问。
- 推 `main` 即上线，1–2 分钟生效。没有 CI，没有测试框架。
- 没有测试框架，自动化验证全靠 `scripts/` 下那几个脚本（见下），**必须从仓库根目录跑**。
- 建表、建 bucket、部署 Edge Function、改 RLS 策略都得用户在 Supabase 控制台自己操作，会话里没权限。SQL 和代码可以给现成的。
- **页面打不开、登录失败、数据像是消失了——先 `dig +short @8.8.8.8 mpvsbeghuueffkjdemcr.supabase.co A`。** NXDOMAIN = 免费档项目被暂停了（7 天不活动就暂停），不是代码问题。2026-11-02 栽过一次，白查了很久。见 `docs/HANDOFF.md` 第十二节。
- **仓库是公开的**，不要提交任何含个人信息的文件（包括真实邮箱地址）。

## 改完跑这七个检查

```bash
node scripts/verify-recipe-logic.js    # recipe.js 的 PURE LOGIC 段断言
node scripts/verify-fx-logic.js        # index.html 的 PURE LOGIC 段断言（汇率换算那套）
python3 scripts/verify-refs.py         # 有没有「调用了但没定义」的函数（跨文件断裂）
python3 scripts/verify-shared-fns.py   # 共用小函数在几个页面之间有没有悄悄分化
node scripts/verify-i18n.js         # 中英词条表 key 有没有对齐（index.html + assets/recipe.js）
node scripts/verify-asset-versions.js  # 同一个 assets/ 文件在各页面的 ?v= 是否一致
node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("ok")'
```

- `verify-refs.py` 会有注释和文案造成的误报，逐个 grep 确认，别无脑信也别无脑忽略。**`index.html` 的正常输出是 `['Balance', 'REST', 'expenses', 'half']`**，多出别的名字就要查。
  - 后三个是 2026-11-12 加中英切换时进来的：英文词条里有 `Balance (Tianshu)`、`Shared expenses (total)`、`XC's half (÷2)`，脚本把「单词 + 左括号」当成了函数调用。它们全在 `I18N` 的字符串值里，是误报。
  - **别为了让这个脚本闭嘴去改界面文案。** 要根治得让脚本跳过字符串字面量，那是另一件事。
- `verify-shared-fns.py` 只盯它 `WATCH` 里登记的那几个函数。`render` / `itemRowHtml` / `startPolling` 这些在各页面本来就该不一样，**不要**为了让它们"统一"而硬合并。

**加新的纯函数就顺手加断言。** PURE LOGIC 段是这仓库唯一能自动验的部分，不加断言等于多一个盲区。写完的断言**先让它失败一次**再改对——这是唯一能证明断言真在测代码、而不是空转通过的办法。
