// 检查中英词条表的 key 有没有对齐。必须从仓库根目录跑：
//     node scripts/verify-i18n.js
//
// 为什么需要它：少一个 key 不会报错，只会在英文界面上露出一句中文——
// 而且往往藏在某个很少打开的弹窗里，自己用很久都发现不了。
//
// 为什么用大括号配对 + eval 而不是正则：词条表一行写多个 key
// （`appTitle: 'x', navDrawer: 'y',`），按行匹配的正则每行只能抓到第一个，
// 会漏掉大半还报「对齐」——那比没有检查更糟。写这个脚本时先用正则试过，
// 对 assets/recipe.js 数出 87 个里的一部分就停了，是实测踩出来的。
//
// 两个文件都查。index.html 和 assets/recipe.js 各有一份独立词条表，引擎也
// 各有一份——这是 HANDOFF 第十一节记录过的刻意选择。verify-shared-fns.py
// 只扫三个页面的内联 script，看不到 assets/recipe.js，所以那两份引擎分化了
// 没有任何检查能发现。这个脚本至少把词条表这一半盯住。
const fs = require('fs');

const TARGETS = ['index.html', 'assets/recipe.js'];

function extractI18N(path) {
  let src = fs.readFileSync(path, 'utf8');
  if (path.endsWith('.html')) {
    src = (src.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [])
            .join('\n').replace(/<\/?script[^>]*>/g, '');
  }
  const start = src.indexOf('const I18N = {');
  if (start < 0) return null;

  // 从第一个 { 开始配对，跳过字符串里和注释里的括号
  let i = src.indexOf('{', start), depth = 0, end = -1, inStr = null, esc = false;
  for (; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  return new Function('return ' + src.slice(src.indexOf('{', start), end))();
}

let bad = false;
for (const path of TARGETS) {
  let obj;
  try { obj = extractI18N(path); }
  catch (e) { console.log(`\u274c ${path}: 词条表解析失败 — ${e.message}`); bad = true; continue; }
  if (!obj || !obj.zh || !obj.en) {
    console.log(`\u274c ${path}: 找不到 const I18N = { zh: {...}, en: {...} };`);
    bad = true; continue;
  }
  const onlyZh = Object.keys(obj.zh).filter(k => !(k in obj.en));
  const onlyEn = Object.keys(obj.en).filter(k => !(k in obj.zh));
  if (onlyZh.length || onlyEn.length) {
    bad = true;
    console.log(`\u274c ${path}: zh ${Object.keys(obj.zh).length} 个 / en ${Object.keys(obj.en).length} 个`);
    if (onlyZh.length) console.log(`   只在 zh: ${onlyZh.join(', ')}`);
    if (onlyEn.length) console.log(`   只在 en: ${onlyEn.join(', ')}`);
  } else {
    console.log(`\u2705 ${path}: ${Object.keys(obj.zh).length} 个 key 完全对齐`);
  }
}
process.exit(bad ? 1 : 0);