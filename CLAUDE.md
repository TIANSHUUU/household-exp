# household_exp

接手先读 `docs/HANDOFF.md`，那份文档是这个仓库的完整交接说明（架构、数据模型、待办、踩过的坑）。

## 改 `assets/` 必须 bump 版本号

`recipe.html` 是唯一有外部资源的页面：

```html
<link rel="stylesheet" href="assets/recipe.css?v=2026080301">
<script src="assets/recipe.js?v=2026080301"></script>
```

**改了 `assets/recipe.css` 或 `assets/recipe.js`，就要把这两处的 `?v=` 一起 bump。** 格式是 `年月日+两位序号`，同一天改多次就 `01`→`02`。

仓库没有构建步骤，只能手动维护。忘了 bump 的后果是手机浏览器继续用缓存的旧文件——2026-08-02 双语改造后就这样踩过一次：数据库列改名成 `name_zh` / `ingredients_zh` / `steps_zh`，手机上跑的旧 JS 还在读 `name` / `ingredients` / `steps`，页面外壳正常但内容全空。

## 其他

- 回复用中文。
- 小改动（CSS 调色、文案微调、单元素调整）直接改直接推，不用每次问。
- 推 `main` 即上线，1–2 分钟生效。没有 CI，没有测试框架。
- 唯一的自动化验证是 `node scripts/verify-recipe-logic.js`（跑 `assets/recipe.js` 里 PURE LOGIC 段的断言），必须从仓库根目录跑。
- 建表、建 bucket、部署 Edge Function 都得用户在 Supabase 控制台自己操作，会话里没权限。
- **仓库是公开的**，不要提交任何含个人信息的文件。
