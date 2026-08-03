# household_exp

接手先读 `docs/HANDOFF.md`，那份文档是这个仓库的完整交接说明（架构、数据模型、待办、踩过的坑）。

## 鉴权：所有请求必须走 `await H()`

`assets/auth.js` 管着登录令牌，四个页面共用，**必须在各页面自己的脚本之前加载**（它定义了 `KEY` 和 `H()`）。

数据库的 RLS 只认登录用户，所以每个 PostgREST / Storage 请求都要带令牌：

```js
fetch(url, { headers: await H() })
fetch(url, { method: 'POST', headers: { ...await H(), 'Prefer': 'return=representation' } })
```

**加新 fetch 时照抄这个形状。** 写成 `headers: H` 是把函数本身当 header 传出去，请求直接 401。详见 `docs/HANDOFF.md` 第九节。

## 改 `assets/` 必须 bump 版本号

四个页面都引了 `assets/auth.js`，`recipe.html` 另外还引了 `recipe.css` / `recipe.js`：

```html
<script src="assets/auth.js?v=2026080303"></script>
```

**改了 `assets/` 里任何文件，就要把引用它的页面的 `?v=` 一起 bump。** 格式是 `年月日+两位序号`，同一天改多次就 `01`→`02`。

仓库没有构建步骤，只能手动维护。忘了 bump 的后果是手机浏览器继续用缓存的旧文件——2026-08-02 双语改造后就这样踩过一次：数据库列改名成 `name_zh` / `ingredients_zh` / `steps_zh`，手机上跑的旧 JS 还在读 `name` / `ingredients` / `steps`，页面外壳正常但内容全空。

## 其他

- 回复用中文。
- 小改动（CSS 调色、文案微调、单元素调整）直接改直接推，不用每次问。
- 推 `main` 即上线，1–2 分钟生效。没有 CI，没有测试框架。
- 唯一的自动化验证是 `node scripts/verify-recipe-logic.js`（跑 `assets/recipe.js` 里 PURE LOGIC 段的断言），必须从仓库根目录跑。
- 建表、建 bucket、部署 Edge Function、改 RLS 策略都得用户在 Supabase 控制台自己操作，会话里没权限。SQL 和代码可以给现成的。
- **仓库是公开的**，不要提交任何含个人信息的文件（包括真实邮箱地址）。

## 改完跑这三个检查

```bash
node scripts/verify-recipe-logic.js    # recipe.js 的 PURE LOGIC 段断言
python3 scripts/verify-refs.py         # 有没有「调用了但没定义」的函数（跨文件断裂）
node -e 'new Function(require("fs").readFileSync("assets/auth.js","utf8"));console.log("ok")'
```

`verify-refs.py` 会有注释和文案造成的误报，逐个 grep 确认，别无脑信也别无脑忽略。
