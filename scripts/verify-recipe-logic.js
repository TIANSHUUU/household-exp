const fs = require('fs');
const src = fs.readFileSync('assets/recipe.js', 'utf8');
const pure = src.split('// ── PURE LOGIC START ──')[1].split('// ── PURE LOGIC END ──')[0];
eval(pure);

const assert = require('assert');
const vocab = [
  { canonical: '番茄', aliases: ['西红柿', 'tomato'], staple: false },
  { canonical: '盐',   aliases: ['食盐'],             staple: true  },
];
const m = buildAliasMap(vocab);

assert.strictEqual(toCanonical('番茄', m),   '番茄', 'canonical 自身应命中');
assert.strictEqual(toCanonical('西红柿', m), '番茄', '中文别名应映射到 canonical');
assert.strictEqual(toCanonical('Tomato', m), '番茄', '别名匹配应大小写不敏感');
assert.strictEqual(toCanonical(' 番茄 ', m), '番茄', '应忽略首尾空格');
assert.strictEqual(toCanonical('牛肉', m),   '牛肉', '词表没有的词应原样返回');
assert.strictEqual(toCanonical('', m),       '',     '空字符串应返回空');
assert.strictEqual(toCanonical(null, m),     '',     'null 应返回空而不是抛错');

const st = stapleSet(vocab);
assert.strictEqual(st.has('盐'), true,   '盐应在 staple 集合里');
assert.strictEqual(st.has('番茄'), false, '番茄不应在 staple 集合里');

console.log('✅ normalization OK');

const staples = stapleSet([
  { canonical: '盐', aliases: [], staple: true },
]);
const recipes = [
  { id: 1, name: '番茄炒蛋',   ingredient_keys: ['番茄', '鸡蛋', '盐'] },
  { id: 2, name: '番茄牛腩',   ingredient_keys: ['番茄', '牛腩', '土豆', '盐'] },
  { id: 3, name: '牛肉三明治', ingredient_keys: ['牛肉', '面包', '生菜'] },
  { id: 4, name: '佛跳墙',     ingredient_keys: ['鲍鱼', '海参', '花胶', '瑶柱', '火腿'] },
];

const res = matchRecipes(['番茄', '鸡蛋', '牛腩'], recipes, staples);

assert.strictEqual(res.length, 3, '缺 5 样的佛跳墙应被 maxMissing 剔除');
assert.strictEqual(res[0].recipe.id, 1, '零缺口的应排最前');
assert.deepStrictEqual(res[0].missing, [], '盐是 staple，不应算进 missing');
assert.strictEqual(res[1].recipe.id, 2);
assert.deepStrictEqual(res[1].missing, ['土豆']);
assert.strictEqual(res[2].recipe.id, 3);
assert.strictEqual(res[2].missing.length, 3);

// 同桶内食材少的排前面
const tie = matchRecipes([], [
  { id: 10, name: '多料', ingredient_keys: ['a', 'b', 'c'] },
  { id: 11, name: '少料', ingredient_keys: ['d'] },
], new Set(), 3);
assert.strictEqual(tie[0].recipe.id, 11, '同桶内 need 少的应排前');

console.log('✅ matching OK');

const sm = buildAliasMap([
  { canonical: '番茄', aliases: ['西红柿', 'tomato'], staple: false },
]);

const s1 = searchRecipes('西红柿', recipes, sm);
assert.strictEqual(s1.byName.length, 0, '没有菜名叫西红柿');
assert.deepStrictEqual(s1.byIngredient.map(r => r.id), [1, 2], '别名应经 canonical 命中食材');

const s2 = searchRecipes('番茄', recipes, sm);
assert.deepStrictEqual(s2.byName.map(r => r.id), [1, 2], '菜名命中优先');
assert.strictEqual(s2.byIngredient.length, 0, '同一道菜不应两组都出现');

const s3 = searchRecipes('牛', recipes, sm);
assert.deepStrictEqual(s3.byName.map(r => r.id), [2, 3], '子串应匹配菜名');

const s4 = searchRecipes('   ', recipes, sm);
assert.deepStrictEqual(s4, { byName: [], byIngredient: [] }, '空查询应返回两个空数组');

console.log('✅ search OK');
