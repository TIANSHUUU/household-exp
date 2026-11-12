// 同一个 assets/ 文件在各个页面上的 ?v= 必须一致。必须从仓库根目录跑：
//     node scripts/verify-asset-versions.js
//
// 为什么需要它：assets/auth.js 被四个页面共用。CLAUDE.md 的规矩是「改了
// assets/ 里任何文件，就要把引用它的页面的 ?v= 一起 bump」，但实际出错的
// 方式是**只 bump 了自己正在调试的那个页面**——比如为食谱页改 auth.js，
// 顺手 bump 了 recipe.html，另外三个页面还停在旧版本号上。
//
// 后果很隐蔽：文件内容已经变了，但账单页的浏览器拿着旧的 ?v= 命中缓存，
// 继续跑旧的 auth.js。页面外壳正常，内容可能全空或行为不对。2026-08-02
// 双语改造时踩过一模一样的坑（见 docs/HANDOFF.md 第五节）。
//
// 2026-11-12 实测：当时 auth.js 在 index/shopping/activity 上是 2026110201，
// 在 recipe.html 上是 2026111201 —— 雷已经埋好了，只是还没炸。
const fs = require('fs');

const PAGES = ['index.html', 'shopping.html', 'activity.html', 'recipe.html'];

// 文件 -> { 版本号 -> [引用它的页面] }
const seen = new Map();

for (const page of PAGES) {
  let src;
  try {
    src = fs.readFileSync(page, 'utf8');
  } catch (e) {
    console.log(`❌ 读不到 ${page} —— 必须从仓库根目录跑`);
    process.exit(1);
  }
  for (const m of src.matchAll(/(?:src|href)="(assets\/[^"?]+)\?v=([^"]+)"/g)) {
    const [, file, ver] = m;
    if (!seen.has(file)) seen.set(file, new Map());
    const byVer = seen.get(file);
    if (!byVer.has(ver)) byVer.set(ver, []);
    byVer.get(ver).push(page);
  }
  // 没带 ?v= 的引用同样是问题：改了文件就刷不掉缓存
  for (const m of src.matchAll(/(?:src|href)="(assets\/[^"?]+)"/g)) {
    console.log(`❌ ${page}: ${m[1]} 没有 ?v= —— 改了这个文件就刷不掉浏览器缓存`);
    process.exitCode = 1;
  }
}

let bad = false;
for (const [file, byVer] of [...seen].sort()) {
  const vers = [...byVer.keys()];
  if (vers.length === 1) {
    console.log(`✅ ${file}  ${vers[0]}  (${byVer.get(vers[0]).length} 个页面一致)`);
    continue;
  }
  bad = true;
  console.log(`❌ ${file} 在不同页面上版本号不一致：`);
  for (const [ver, pages] of [...byVer].sort()) {
    console.log(`     ${ver}  <-  ${pages.join(', ')}`);
  }
  console.log(`     改了这个文件但只 bump 了一部分页面，没 bump 的那些会继续用缓存的旧版本。`);
}

if (bad) process.exitCode = 1;
if (!bad && !process.exitCode) console.log('\n所有 assets 的版本号在各页面之间一致 ✅');
