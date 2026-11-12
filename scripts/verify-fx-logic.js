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
assert.strictEqual(new Set(list.map(c => c.code)).size, list.length, '货币代码不能重复');
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
// 为什么是 currencyDisplay:'code' 见 index.html 里 fmtOrig 定义处的注释。
assert.strictEqual(fmtOrig(3200, 'JPY'),   'JPY 3,200',  '日元没有小数位');
assert.strictEqual(fmtOrig(12000, 'KRW'),  'KRW 12,000', '韩元没有小数位');
assert.strictEqual(fmtOrig(450.5, 'THB'),  'THB 450.50', '泰铢两位小数');
assert.strictEqual(fmtOrig(12.3, 'USD'),   'USD 12.30');
assert.strictEqual(fmtOrig(20, 'SGD'),     'SGD 20.00',  '新元不能显示成 $，会跟澳币撞');
assert.strictEqual(fmtOrig(88, 'CNY'),     'CNY 88.00',  '人民币不能显示成 ¥，会跟日元撞');
assert.strictEqual(fmtOrig(100, ''),       '',           '没有币种就不显示');
assert.strictEqual(fmtOrig(null, 'JPY'),   '',           '没有金额就不显示');
// 空串必须和 null 一样什么都不显示。少了这条守卫，'' 会被 Number() 变成 0、
// 渲染成「JPY 0」——而 convertToAud('') 返回的是 null，两边对空的理解就分家了。
assert.strictEqual(fmtOrig('', 'JPY'),     '',           '空串金额和 null 一样不显示');
// ICU 插的是 U+00A0，fmtOrig 归一成普通空格。这条守着那个归一——去掉 replace
// 就会挂，而肉眼看输出是看不出区别的。
assert.ok(!fmtOrig(3200, 'JPY').includes('\u00A0'), '输出里不能残留不换行空格');
// 三个字母但查无此币：Intl 不抛错，不崩就达到目的了——两位小数是 ICU 默认行为，不是我们的约定。
assert.ok(fmtOrig(100, 'ZZZ').includes('ZZZ'), '查无此币的合法格式代码照常渲染，不崩就行');
// 格式非法（不是三个字母）才会抛 RangeError，走 catch 兜底。这条才是真在测 catch 分支。
assert.strictEqual(fmtOrig(100, 'ZZ'),     'ZZ 100',     '格式非法的代码走兜底，不能让整行渲染抛错');

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
// 2026-11-12 起 validateExpenseInput 返回的是词条 key 而不是中文句子——
// 它在 PURE LOGIC 段里，不该知道界面说什么语言。文案由调用方 t(key) 取。
assert.strictEqual(V({ rate:NaN }).errorKey, 'errNoRate', '外币缺汇率要给出 errNoRate');
assert.strictEqual(V({ date:'' }).errorKey, 'errNoDate', '缺日期给 errNoDate');
assert.strictEqual(V({ desc:'' }).errorKey, 'errNoDesc', '缺描述给 errNoDesc');
assert.strictEqual(V({ origAmount:0 }).errorKey, 'errBadAmount', '金额非法给 errBadAmount');
assert.strictEqual(V({}).errorKey, '', '通过时 errorKey 为空串');

// AUD 不该被汇率卡住——它根本不用汇率
assert.strictEqual(V({ ccy:'AUD', rate:NaN }).ok, true, 'AUD 不看汇率');
assert.strictEqual(V({ ccy:'AUD', rate:'' }).ok,  true, 'AUD 不看汇率');

console.log('✅ input validation OK');

// ── 轮询签名 ──
// 只改原币、AUD 恰好没变的编辑，另一台设备也要能刷出来
const base = { id:1, amount:28.45, description:'ramen', type:'shared', date:'2026-08-04',
               orig_currency:'JPY', orig_amount:3200, fx_rate:0.00889 };
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:3300 })),
  '原币金额变了签名必须变');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_currency:'THB' })),
  '原币币种变了签名必须变');
assert.notStrictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { fx_rate:0.008891 })),
  '手改汇率后即使 AUD 舍入结果不变，签名也必须变——否则另一台设备永远刷不到这次修改');

// 数字归一的理由见 index.html 里 expenseSig 定义处的注释
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { amount:'28.45' })),
  '字符串和数字形态的同一个金额必须同签名');
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { orig_amount:'3200' })),
  '字符串和数字形态的同一个原币金额必须同签名');
assert.strictEqual(expenseSig(base), expenseSig(Object.assign({}, base, { fx_rate:'0.00889' })),
  '字符串和数字形态的同一个汇率必须同签名');

// 老数据：三列全 NULL
const old = { id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22',
              orig_currency:null, orig_amount:null, fx_rate:null };
assert.strictEqual(
  expenseSig(old),
  expenseSig({ id:2, amount:40.78, description:'wine', type:'shared', date:'2026-05-22' }),
  '三列缺失和三列为 null 必须同签名——否则老数据每 15 秒重渲染一次');

console.log('✅ polling signature OK');
// ── 房租行 id ──
// id 用日期派生的理由见 index.html 里 rentRowId 定义处的注释：现有 id 只有
// Date.now() 的 13 位毫秒戳和种子数据的 1–19 两种来源，8 位日期 id 和两者
// 都不会撞，所以重复插入必然违反主键约束 —— 补登的幂等性是白送的。
assert.strictEqual(rentRowId('2026-09-22'), 20260922, '日期转成 8 位整数 id');
assert.strictEqual(rentRowId('2026-10-22'), 20261022, '跨月');
assert.strictEqual(rentRowId('2027-01-05'), 20270105, '个位数月日要补零');

// isRentRow 必须能把房租行和另外两种 id 区分开
assert.strictEqual(isRentRow({ id: 20260922 }), true,  '8 位日期 id 是房租行');
assert.strictEqual(isRentRow({ id: 1793592786771 }), false, 'Date.now() 毫秒戳不是');
assert.strictEqual(isRentRow({ id: 5 }), false, '种子数据的小 id 不是');
assert.strictEqual(isRentRow({ id: 19 }), false, '种子数据最大的 id 也不是');
assert.strictEqual(isRentRow({}), false, '没有 id 不是');
assert.strictEqual(isRentRow(null), false, 'null 不该抛异常');

console.log('✅ rent row id OK');

// ── 租金日序列 ──
// 区间是左开右闭 (after, to]。左端开是关键：after 要么是账期起始日
// （当天及以前属于上一期的结算范围），要么是最后一笔已存在房租行的日期
// （已经记过了）。两种情况都不能再记一次。
assert.deepStrictEqual(
  rentDatesBetween('2026-08-24', '2026-11-02', 22),
  ['2026-09-22', '2026-10-22'],
  '当前账期的真实场景：08-24 起到今天，应补 09-22 和 10-22 两笔');

assert.deepStrictEqual(rentDatesBetween('2026-09-22', '2026-11-02', 22), ['2026-10-22'],
  '已经补过 09-22 之后再跑，只剩 10-22');
assert.deepStrictEqual(rentDatesBetween('2026-10-22', '2026-11-02', 22), [],
  '全补完了就该是空的——这条就是幂等性');

// 左端点严格排除
assert.deepStrictEqual(rentDatesBetween('2026-09-22', '2026-09-22', 22), [],
  'after 和 to 同一天且正好是租金日，必须为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-22', '2026-09-30', 22), ['2026-09-22'],
  'after 当天是租金日，只能从下个月开始');

// 右端点闭合
assert.deepStrictEqual(rentDatesBetween('2026-09-30', '2026-10-22', 22), ['2026-10-22'],
  'to 当天是租金日，要算进来');

// 月末钳制：不能跳过，跳过那个月的租金就永远不进账
assert.deepStrictEqual(rentDatesBetween('2027-01-01', '2027-03-05', 31),
  ['2027-01-31', '2027-02-28'],
  '2 月落到 28 号（2027 不是闰年）；3-31 超出 to 所以不在内');
assert.deepStrictEqual(rentDatesBetween('2028-01-31', '2028-02-29', 31), ['2028-02-29'],
  '闰年 2 月落到 29 号');
assert.deepStrictEqual(rentDatesBetween('2026-03-31', '2026-04-30', 31), ['2026-04-30'],
  '4 月只有 30 天');

// 跨年
assert.deepStrictEqual(rentDatesBetween('2026-11-30', '2027-01-31', 22),
  ['2026-12-22', '2027-01-22'], '跨年要连续');

// 坏输入一律返回空数组，绝不抛异常也绝不返回 undefined——
// 调用方会直接 .map()，返回 undefined 就是白屏
assert.deepStrictEqual(rentDatesBetween(null, '2026-11-02', 22), [], 'after 为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', null, 22), [], 'to 为空');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', 0),  [], '租金日 0 非法');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', 32), [], '租金日 32 非法');
assert.deepStrictEqual(rentDatesBetween('2026-08-24', '2026-11-02', null), [], '租金日为空');
assert.deepStrictEqual(rentDatesBetween('2026-11-02', '2026-08-24', 22), [], 'to 早于 after');

console.log('✅ rent date sequence OK');

// ── 结算公式 ──
// 这是全仓库唯一直接决定钱的公式，2026-11-02 之前一条断言都没有。
// 旧公式是 carryover + cfg.myRent - shared/2 - pp + cp，那个 myRent 按
// 「每个活跃账期一次」计而不是按月——账期跑了 2.3 个月也只加一笔 1250，
// 把宝宝欠款多算了 1250 且每月增长。详见 spec。
const _rows = [
  { type: 'shared',           amount: 100 },   // 各付 50
  { type: 'partner_personal', amount: 30  },   // 我替宝宝垫，全额抵扣
  { type: 'partner_paid',     amount: 20  },   // 宝宝替我垫，全额增加
];
const t1 = calcTotals(_rows, 0);
assert.strictEqual(t1.shared, 100, 'shared 汇总');
assert.strictEqual(t1.pp, 30, 'pp 汇总');
assert.strictEqual(t1.cp, 20, 'cp 汇总');
assert.strictEqual(t1.transfer, 0 - 50 - 30 + 20, 'transfer = carry - shared/2 - pp + cp');
assert.strictEqual(t1.transfer, -60, '展开算一遍防止上面那行写成恒等式');

// **公式里不能再有租金项。** 这条断言的存在就是为了钉死这件事：
// 如果有人把 myRent 加回来，房租既在 cp 里又在公式里，就是双重计算。
assert.strictEqual(calcTotals([], 0).transfer, 0,
  '空账 + 零结余 = 0。如果公式里还藏着租金项，这里会是 1250');

assert.strictEqual(calcTotals([], -6984.63).transfer, -6984.63, '没有开支时结余原样带过');

// 字符串金额（PostgREST 的 numeric 列回来可能是字符串）
assert.strictEqual(
  calcTotals([{ type: 'shared', amount: '100' }], '0').transfer, -50,
  '字符串金额和结余必须和数字一样算');

// 脏数据不能污染结果
assert.strictEqual(calcTotals([{ type: 'shared', amount: null }], 0).transfer, 0, 'null 金额当 0');
assert.strictEqual(calcTotals([{ type: 'unknown', amount: 999 }], 0).transfer, 0, '未知类型忽略');
assert.strictEqual(calcTotals(null, null).transfer, 0, '全空不抛异常');

// 线上真实数据回归（2026-11-02 取自数据库）
//
// ⚠️ 用容差比，不要用 Math.round(x*100)/100 === -6716.91。
// 真实值是 -6716.905，正好卡在进位分界线上，round 的结果完全取决于浮点
// 表示落在哪一侧（实测是 -6716.905000000001 所以刚好进位）。
// 那种断言能过是运气不是设计，换个输入就可能翻车。
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}（实际 ${a}）`);

const live = calcTotals(
  [{ type: 'shared', amount: 1135.21 }, { type: 'partner_personal', amount: 274.63 },
   { type: 'partner_paid', amount: 1109.96 }], -6984.63);
near(live.transfer, -6716.905, '去掉租金项后的裸值');

const withRent = calcTotals(
  [{ type: 'shared', amount: 1135.21 }, { type: 'partner_personal', amount: 274.63 },
   { type: 'partner_paid', amount: 1109.96 + 2500 }], -6984.63);
near(withRent.transfer, -4216.905,
  '两笔房租进 cp 之后 = 宝宝欠你 4216.91（显示值经 fmt 四舍五入），和 spec 对得上');

console.log('✅ settlement formula OK');

// ── 货币下拉框的显示文字 ──
// 英文版只显示代码，不显示名字。两个理由：
// 1. 下拉框很窄——上面那条 name.length <= 4 的断言就是为这个存在的，
//    'Malaysian Ringgit' 这种英文全名根本塞不下
// 2. 货币代码对英文读者本来就是通用词汇，比截断的全名更有用
assert.strictEqual(currencyOptionLabel({ code:'AUD', name:'澳元' }, 'zh'), 'AUD 澳元', '中文显示代码+名字');
assert.strictEqual(currencyOptionLabel({ code:'AUD', name:'澳元' }, 'en'), 'AUD', '英文只显示代码');
assert.strictEqual(currencyOptionLabel({ code:'MYR', name:'林吉特' }, 'en'), 'MYR', '英文下长名字也只剩代码');
assert.strictEqual(currencyOptionLabel({ code:'MYR', name:'林吉特' }, 'zh'), 'MYR 林吉特', '中文下保持原样');
// 未知语言当中文处理——宁可多显示信息也别丢信息
assert.strictEqual(currencyOptionLabel({ code:'JPY', name:'日元' }, undefined), 'JPY 日元', '语言未知回退中文');
// 没有 name 的脏数据不能渲染出 'AUD undefined'
assert.strictEqual(currencyOptionLabel({ code:'AUD' }, 'zh'), 'AUD', '缺 name 时只显示代码');

console.log('✅ currency option label OK');

// ── 日期格式化 ──
// 星期下标从 0=周日 开始，差一位是这里最经典的错，所以两端都要断言。
assert.strictEqual(fmtDateIn('2026-11-12', 'zh'), '11月12日 · 周四', '中文：月日 + 星期');
assert.strictEqual(fmtDateIn('2026-11-12', 'en'), 'Nov 12 · Thu', '英文：月缩写 + 日 + 星期缩写');

// 两端边界：下标 0（周日）和下标 6（周六）
assert.strictEqual(fmtDateIn('2026-11-15', 'zh'), '11月15日 · 周日', '周日是下标 0');
assert.strictEqual(fmtDateIn('2026-11-15', 'en'), 'Nov 15 · Sun', '周日是下标 0（英文）');
assert.strictEqual(fmtDateIn('2026-11-14', 'zh'), '11月14日 · 周六', '周六是下标 6');
assert.strictEqual(fmtDateIn('2026-11-14', 'en'), 'Nov 14 · Sat', '周六是下标 6（英文）');

// 月份两端：1 月（下标 0）和 12 月（下标 11）
assert.strictEqual(fmtDateIn('2027-01-01', 'zh'), '1月1日 · 周五', '1 月是下标 0');
assert.strictEqual(fmtDateIn('2027-01-01', 'en'), 'Jan 1 · Fri', '1 月是下标 0（英文）');
assert.strictEqual(fmtDateIn('2026-12-31', 'zh'), '12月31日 · 周四', '12 月是下标 11');
assert.strictEqual(fmtDateIn('2026-12-31', 'en'), 'Dec 31 · Thu', '12 月是下标 11（英文）');

// 语言未知回退中文
assert.strictEqual(fmtDateIn('2026-11-12', undefined), '11月12日 · 周四', '语言未知回退中文');

console.log('✅ date formatting OK');

// ── 英文版的 balance 视角 ──
// 中文版的方向写在标签里（「本月宝宝需还给你」vs「本月应转给宝宝」），
// 金额永远是正数。英文版换成中性的 balance 模型，方向只靠正负号，
// 约定是「正数 = Tianshu 是债权方」。
//
// 代码里 transfer 负数表示宝宝欠你，所以 Balance(Tianshu) = -transfer。
// 这个翻转必须贯穿整张卡，不能只翻 hero —— spec 初稿就栽在这，
// 只翻了 hero、明细照抄中文符号，结果明细加起来对不上 hero。
const bv = balanceView({ carryover: -6984.63, shared: 1135.21, pp: 274.63, cp: 3609.96 });
const nearBV = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.001, `${msg}（实际 ${a}）`);

nearBV(bv.balance,    4216.905, 'Balance(Tianshu) 为正 = 你是债权方（4216.905 是真实值，4216.91 是 fmt 四舍五入后的显示值）');
nearBV(bv.carry,      6984.63, '上期结余取反');
nearBV(bv.halfShare,   567.605, '共同开支的一半取反为正');
nearBV(bv.pp,          274.63, 'TS pays for XC 取反为正');
nearBV(bv.cp,        -3609.96, 'XC pays for TS 取反为负');

// 明细必须加得出 hero。只断言 hero 的符号挡不住「hero 翻了明细没翻」。
nearBV(bv.carry + bv.halfShare + bv.pp + bv.cp, bv.balance,
  '明细四项之和必须严格等于 Balance');

// 反向：你欠宝宝 100 的情况
nearBV(balanceView({ carryover: 100, shared: 0, pp: 0, cp: 0 }).balance, -100,
  'transfer 为正（你要付钱）时 Balance 为负');

nearBV(balanceView({ carryover: 0, shared: 0, pp: 0, cp: 0 }).balance, 0, '全零');

// 脏数据：字符串和 null 都不能变成 NaN
nearBV(balanceView({ carryover: '-6984.63', shared: '1135.21', pp: null, cp: undefined }).balance,
  6984.63 + 567.605, '字符串照算，null/undefined 当 0');

console.log('✅ balance view OK');

console.log('\n全部通过 ✅');
