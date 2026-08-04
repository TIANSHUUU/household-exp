// index.html 的 PURE LOGIC 段断言。必须从仓库根目录跑：
//   node scripts/verify-fx-logic.js
//
// 提取方式和 verify-recipe-logic.js 一样是 eval。注意非严格模式的直接 eval
// 里只有 function 声明会跨出作用域，const/let 不会——所以 PURE LOGIC 段里
// 对外可见的东西必须写成 function，CURRENCIES 靠 currencyList() 暴露。
const fs   = require('fs');
const src  = fs.readFileSync('index.html', 'utf8');
const pure = src.split('// ── PURE LOGIC START ──')[1].split('// ── PURE LOGIC END ──')[0];
eval(pure);

const assert = require('assert');

// ── 货币表 ──
const list = currencyList();
assert.strictEqual(list.length, 30, 'Frankfurter 支持 30 种货币（含 AUD）');
assert.strictEqual(list[0].code, 'AUD', 'AUD 必须置顶——日常记账不该多点一下');
assert.strictEqual(new Set(list.map(c => c.code)).size, 30, '货币代码不能重复');
assert.ok(list.every(c => /^[A-Z]{3}$/.test(c.code)), '代码必须是三个大写字母');
assert.ok(list.every(c => c.name && c.name.length <= 4),
  '中文名不超过 4 字，否则下拉框在手机上会被截断');

console.log('✅ currency list OK');

// ── 换算 ──
// 28.448 → 28.45：这是 spec 验收标准里的那笔拉面
assert.strictEqual(convertToAud(3200, 0.00889), 28.45, '3200 JPY @ 0.00889 = 28.45');
assert.strictEqual(convertToAud(5000, 0.00889), 44.45, '改成 5000 JPY 应重算成 44.45');
assert.strictEqual(convertToAud(1, 1), 1, 'AUD 自己换自己');
assert.strictEqual(convertToAud(10, 0.1), 1, '整数结果不应带浮点尾巴');

// 下面这些必须返回 null 而不是 NaN——NaN 会一路写进数据库，是最难查的一类脏数据
assert.strictEqual(convertToAud(NaN, 0.5),  null, '金额 NaN 应返回 null');
assert.strictEqual(convertToAud(100, NaN),  null, '汇率 NaN 应返回 null');
assert.strictEqual(convertToAud(100, null), null, '汇率为 null 应返回 null');
assert.strictEqual(convertToAud(100, ''),   null, '汇率为空串应返回 null');
assert.strictEqual(convertToAud(100, 0),    null, '汇率为 0 应返回 null');
assert.strictEqual(convertToAud(0, 0.5),    null, '金额为 0 应返回 null');
assert.strictEqual(convertToAud(-5, 0.5),   null, '负金额应返回 null');
assert.strictEqual(convertToAud(undefined, undefined), null, '全空应返回 null');

console.log('✅ conversion OK');

// ── 缓存 key ──
assert.strictEqual(fxCacheKey('2026-08-04', 'JPY'), '2026-08-04|JPY');
assert.strictEqual(fxCacheKey('2026-08-04', 'jpy'), '2026-08-04|JPY', '大小写要归一，否则同一天同一币种会缓存两份');

console.log('✅ cache key OK');

// ── 原币格式化 ──
// currencyDisplay 用 code 不用 narrowSymbol：narrowSymbol 会把 USD 和 SGD
// 都渲染成 $，跟同一行旁边的澳币撞车，而 ¥ 在 JPY 和 CNY 之间也有歧义。
assert.strictEqual(fmtOrig(3200, 'JPY'),   'JPY 3,200',  '日元没有小数位');
assert.strictEqual(fmtOrig(12000, 'KRW'),  'KRW 12,000', '韩元没有小数位');
assert.strictEqual(fmtOrig(450.5, 'THB'),  'THB 450.50', '泰铢两位小数');
assert.strictEqual(fmtOrig(12.3, 'USD'),   'USD 12.30');
assert.strictEqual(fmtOrig(20, 'SGD'),     'SGD 20.00',  '新元不能显示成 $，会跟澳币撞');
assert.strictEqual(fmtOrig(88, 'CNY'),     'CNY 88.00',  '人民币不能显示成 ¥，会跟日元撞');
assert.strictEqual(fmtOrig(100, ''),       '',           '没有币种就不显示');
assert.strictEqual(fmtOrig(null, 'JPY'),   '',           '没有金额就不显示');
assert.strictEqual(fmtOrig(100, 'ZZZ'),    'ZZZ 100',    '非法币种代码不能让整行渲染抛错');

console.log('✅ orig formatting OK');

// ── 解析汇率 API 响应 ──
assert.deepStrictEqual(
  parseFxResponse({ amount:1.0, base:'JPY', date:'2026-07-31', rates:{ AUD:0.00889 } }),
  { rate:0.00889, date:'2026-07-31' });
assert.strictEqual(parseFxResponse({ rates:{} }),        null, '没有 AUD 这一项应返回 null');
assert.strictEqual(parseFxResponse({ rates:{ AUD:0 } }), null, '汇率为 0 是坏数据');
assert.strictEqual(parseFxResponse({}),                  null, '没有 rates 应返回 null');
assert.strictEqual(parseFxResponse(null),                null, 'null 不应抛错');
assert.strictEqual(parseFxResponse({ rates:{ AUD:'0.00889' } }), null, '字符串汇率视为坏数据');

console.log('✅ fx response parsing OK');

// ── 周末回退提示 ──
assert.strictEqual(fxNoteDate('2026-08-04', '2026-08-04'), null, '同一天不提示');
assert.strictEqual(fxNoteDate('2026-08-01', '2026-07-31'), '2026-07-31', '回退了要把真实日期报出来');
assert.strictEqual(fxNoteDate('2026-08-04', ''),           null, '响应没给日期就别瞎提示');

console.log('✅ weekend fallback note OK');

// ── 提交前校验 ──
const V = o => validateExpenseInput(Object.assign(
  { date:'2026-08-04', desc:'ramen', origAmount:3200, ccy:'JPY', rate:0.00889 }, o));

assert.strictEqual(V({}).ok, true, '齐全的输入应通过');
assert.strictEqual(V({ ccy:'AUD', rate:1 }).ok, true, 'AUD 也应通过');
assert.strictEqual(V({ date:'' }).ok,       false, '缺日期应拦下');
assert.strictEqual(V({ desc:'' }).ok,       false, '缺描述应拦下');
assert.strictEqual(V({ origAmount:0 }).ok,  false, '金额 0 应拦下');
assert.strictEqual(V({ origAmount:-3 }).ok, false, '负金额应拦下');
assert.strictEqual(V({ origAmount:NaN }).ok,false, '金额 NaN 应拦下');

// 这三条是「不产生 NaN 记录」这个验收标准的核心
assert.strictEqual(V({ rate:NaN }).ok, false, '外币但汇率为 NaN 必须拦下');
assert.strictEqual(V({ rate:'' }).ok,  false, '外币但汇率为空必须拦下');
assert.strictEqual(V({ rate:0 }).ok,   false, '外币但汇率为 0 必须拦下');
assert.ok(V({ rate:NaN }).error.includes('汇率'), '错误提示要指出是汇率的问题');

// AUD 不该被汇率卡住——它根本不用汇率
assert.strictEqual(V({ ccy:'AUD', rate:NaN }).ok, true, 'AUD 不看汇率');
assert.strictEqual(V({ ccy:'AUD', rate:'' }).ok,  true, 'AUD 不看汇率');

console.log('✅ input validation OK');

// ── 轮询签名 ──
// 只改原币、AUD 恰好没变的编辑，另一台设备也要能刷出来
const base = { id:1, amount:28.45, description:'ramen', type:'shared', date:'2026-08-04',
               orig_currency:'JPY', orig_amount:3200, fx_rate:0.00889 };
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base)), '同一条记录签名必须稳定');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:3300 })),
  '原币金额变了签名必须变');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_currency:'THB' })),
  '原币币种变了签名必须变');

// PostgREST 可能把 numeric 回成字符串，两边必须归一，否则每 15 秒无脑重渲染
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { amount:'28.45' })),
  '字符串和数字形态的同一个金额必须同签名');
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:'3200' })),
  '字符串和数字形态的同一个原币金额必须同签名');

// 老数据：三列全 NULL
const old = { id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22',
              orig_currency:null, orig_amount:null, fx_rate:null };
assert.strictEqual(expenseSig(old), expenseSig(Object.assign({}, old)), '老数据签名也要稳定');
assert.strictEqual(
  expenseSig(old),
  expenseSig({ id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22' }),
  '三列缺失和三列为 null 必须同签名——否则老数据每 15 秒重渲染一次');

console.log('✅ polling signature OK');
console.log('\n全部通过 ✅');
