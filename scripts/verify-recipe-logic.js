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
  { id: 1, name_zh: '番茄炒蛋',   ingredient_keys: ['番茄', '鸡蛋', '盐'] },
  { id: 2, name_zh: '番茄牛腩',   ingredient_keys: ['番茄', '牛腩', '土豆', '盐'] },
  { id: 3, name_zh: '牛肉三明治', ingredient_keys: ['牛肉', '面包', '生菜'] },
  { id: 4, name_zh: '佛跳墙',     ingredient_keys: ['鲍鱼', '海参', '花胶', '瑶柱', '火腿'] },
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
  { id: 10, name_zh: '多料', ingredient_keys: ['a', 'b', 'c'] },
  { id: 11, name_zh: '少料', ingredient_keys: ['d'] },
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

// ── 双语字段回退 ──
const R = (o) => Object.assign({ name_zh:'', name_en:'', steps_zh:[], steps_en:[] }, o);
assert.strictEqual(pickField(R({name_zh:'番茄炒蛋', name_en:'Tomato Egg'}), 'name', 'en'), 'Tomato Egg');
assert.strictEqual(pickField(R({name_zh:'番茄炒蛋', name_en:'Tomato Egg'}), 'name', 'zh'), '番茄炒蛋');
assert.strictEqual(pickField(R({name_zh:'番茄炒蛋'}), 'name', 'en'), '番茄炒蛋', '英文缺失应回退中文');
assert.strictEqual(pickField(R({name_en:'Tomato Egg'}), 'name', 'zh'), 'Tomato Egg', '中文缺失应回退英文');
assert.strictEqual(pickField(R({name_zh:'   '}), 'name', 'zh'), '', '纯空格视为空');
assert.strictEqual(pickField(R({name_zh:'  ', name_en:'X'}), 'name', 'zh'), 'X', '纯空格应回退');
assert.deepStrictEqual(pickField(R({steps_zh:['一','二']}), 'steps', 'en'), ['一','二'], '数组也要回退');
assert.deepStrictEqual(pickField(R({}), 'steps', 'zh'), [], '两版都空返回空数组而非 undefined');
assert.strictEqual(pickField(R({}), 'name', 'zh'), '', '两版都空返回空串而非 undefined');

// 搜索跨语言：中文界面搜英文名也该命中
const bm = buildAliasMap([]);
const br = [{ id:1, name_zh:'番茄炒蛋', name_en:'Tomato & Egg', ingredient_keys:['番茄'], ingredients_zh:[{name:'番茄'}], ingredients_en:[{name:'tomato'}] }];
assert.strictEqual(searchRecipes('Tomato', br, bm).byName.length, 1, '应能用英文名搜到');
assert.strictEqual(searchRecipes('番茄炒', br, bm).byName.length, 1, '应能用中文名搜到');
assert.strictEqual(searchRecipes('tomato', br, bm).byName.length, 1, '大小写不敏感');

console.log('✅ bilingual OK');

// ── 食材建议的显示语言 ──
// 2026-08-03 的 bug：EN 页签点建议会把 canonical（中文）写进 ingredients_en，
// 英文版食谱于是显示「盐」。ingLabel 负责按页签挑显示词。
const saltEntry = { canonical: '盐',     aliases: ['食盐', 'salt'],            staple: true  };
const tomEntry  = { canonical: '番茄',   aliases: ['西红柿', 'tomato'],        staple: false };
const dbjEntry  = { canonical: '豆瓣酱', aliases: ['郫县豆瓣'],                staple: false };

assert.strictEqual(ingLabel(saltEntry, 'zh'), '盐',    'zh 页签显示 canonical');
assert.strictEqual(ingLabel(saltEntry, 'en'), 'salt',  'en 页签显示英文别名');
assert.strictEqual(ingLabel(tomEntry,  'en'), 'tomato','en 页签跳过中文别名');
assert.strictEqual(ingLabel(dbjEntry,  'en'), '豆瓣酱','没有英文别名时退回 canonical');
assert.strictEqual(ingLabel(tomEntry,  undefined), '番茄', '页签缺失按中文处理');

// 显示成英文不能影响机器键——这是这个改动成立的前提
const m2 = buildAliasMap([saltEntry, tomEntry]);
assert.strictEqual(toCanonical(ingLabel(saltEntry, 'en'), m2), '盐',
  'EN 页签插入的英文词保存时必须映射回中文 canonical');
assert.strictEqual(toCanonical(ingLabel(tomEntry, 'en'), m2), '番茄',
  'EN 页签插入的英文词保存时必须映射回中文 canonical');

console.log('✅ ingredient label OK');

// ── 加进购物清单：挑出清单里还没有的 ──
const m3 = buildAliasMap([
  { canonical: '番茄', aliases: ['西红柿', 'tomato'], staple: false },
  { canonical: '鸡蛋', aliases: ['egg'],             staple: false },
]);

assert.deepStrictEqual(
  missingNotInList(['番茄', '鸡蛋'], [], m3), ['番茄', '鸡蛋'], '空清单应全部加入');
assert.deepStrictEqual(
  missingNotInList(['番茄', '鸡蛋'], ['牛奶'], m3), ['番茄', '鸡蛋'], '不相干条目不影响');
assert.deepStrictEqual(
  missingNotInList(['番茄', '鸡蛋'], ['番茄'], m3), ['鸡蛋'], '同名应跳过');
// 这条是整个查重的意义所在：只比字符串会重复加一次番茄
assert.deepStrictEqual(
  missingNotInList(['番茄', '鸡蛋'], ['tomato'], m3), ['鸡蛋'], '清单里的英文别名也算已有');
assert.deepStrictEqual(
  missingNotInList(['番茄'], ['西红柿'], m3), [], '清单里的中文别名也算已有');
assert.deepStrictEqual(
  missingNotInList(['番茄', '鸡蛋'], ['tomato', 'EGG '], m3), [], '大小写和空格不影响');
assert.deepStrictEqual(
  missingNotInList([], ['番茄'], m3), [], '没有缺料时不加任何东西');
assert.deepStrictEqual(
  missingNotInList(['番茄'], null, m3), ['番茄'], '清单为 null 时不应抛错');

console.log('✅ shopping list dedupe OK');
