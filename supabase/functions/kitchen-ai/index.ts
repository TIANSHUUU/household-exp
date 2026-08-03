// 食谱页的 AI 后端。部署到 Supabase Edge Functions（Deno 运行时）。
//
// 存在的唯一理由：把 API key 挡在浏览器之外。前端只认下面这个契约，
// 换供应商 = 改 PROVIDER 这个 secret + 重新部署，前端一行都不用动。
//
// 需要的 secrets：
//   PROVIDER          gemini | anthropic     （默认 gemini）
//   GEMINI_API_KEY    Google AI Studio 申请
//   GEMINI_MODEL      可选，默认 gemini-flash-latest（别名，跟着 Google 换代走）
//   ANTHROPIC_API_KEY 备用供应商，暂时可以不填
//
// SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY 由平台自动注入，不用手动配。
//
// 鉴权：**部署时把 Verify JWT 关掉**，函数自己验（见 verifyUser）。
//
// 为什么不用平台的 Verify JWT——它会连浏览器的 CORS 预检一起拦掉。网页在
// tianshuuu.github.io，函数在 supabase.co，跨域；浏览器发正式请求前先发一个
// OPTIONS 预检探路，而**预检按规范不带 Authorization 头**。平台的 JWT 检查在
// 函数之前执行，预检拿 401，浏览器就判定跨域失败，正式请求根本不会发出去。
// 下面第一行的 OPTIONS 处理救不了——请求到不了这儿。
//
// 所以鉴权放在函数里：拿到 Bearer 令牌后问一次 auth 服务「这是谁」，验不过
// 就 401。匿名 key 也长得像 Bearer 令牌，但它不是用户令牌，问出来会被拒。

const DAILY_CAP = 30;

const ALLOWED_ORIGINS = [
  'https://tianshuuu.github.io',
  'http://localhost:8765',
  'http://127.0.0.1:8765',
];

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// ── 鉴权 ──
// 令牌拿去问 auth 服务，200 才算数。**验不过一律拒绝**——和下面的日限额
// 相反，那个拿不到环境变量时选择放行（宁可多花几次额度也别误伤用户），
// 这个必须失败即关门，否则配置一出问题就等于没有鉴权。
async function verifyUser(req: Request): Promise<boolean> {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;

  const url = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svc) return false;

  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: auth, apikey: svc },
    });
    return r.ok;
  } catch {
    return false;
  }
}

// ── 供应商适配器：同一个签名，换供应商不影响调用方 ──

async function callGemini(system: string, user: string): Promise<string> {
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY 未配置');
  // 默认用别名而不是具体版本号。免费档的模型换代很快——2026-08-03 实测
  // gemini-2.0-flash 配额被清零（429）、gemini-2.5-flash 对新账号关闭（404），
  // 写死版本号等于埋一颗定时炸弹。要钉死某个版本再配 GEMINI_MODEL 覆盖。
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 返回了空内容');
  return text;
}

async function callAnthropic(system: string, user: string): Promise<string> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('ANTHROPIC_API_KEY 未配置');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
  if (!text) throw new Error('Anthropic 返回了空内容');
  return text;
}

function callLLM(system: string, user: string): Promise<string> {
  return (Deno.env.get('PROVIDER') || 'gemini') === 'anthropic'
    ? callAnthropic(system, user)
    : callGemini(system, user);
}

// ── 日限额 ──
// 真正的防线是这个，不是密码——匿名 key 是公开的，密码是短 PIN 就形同虚设。
// 就算有人绕进来，最坏结果也只是当天的翻译不可用，账单封顶。
async function bumpUsage(): Promise<{ ok: boolean; count: number }> {
  const url = Deno.env.get('SUPABASE_URL');
  const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !svc) return { ok: true, count: -1 };   // 拿不到就别拦，宁可放行也别误伤
  const h = { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' };
  const day = new Date().toISOString().slice(0, 10);

  const cur = await fetch(`${url}/rest/v1/ai_usage?day=eq.${day}&select=count`, { headers: h });
  const rows = cur.ok ? await cur.json() : [];
  const count = rows.length ? rows[0].count : 0;
  if (count >= DAILY_CAP) return { ok: false, count };

  await fetch(`${url}/rest/v1/ai_usage`, {
    method: 'POST',
    headers: { ...h, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify([{ day, count: count + 1 }]),
  });
  return { ok: true, count: count + 1 };
}

// ── translate ──

const TRANSLATE_SYSTEM = `You translate home-cooking recipes between Chinese and English.

Rules:
- Output ONLY JSON matching: {"name": string, "ingredients": [{"name": string, "amount": string}], "steps": [string], "tags": {"<original tag>": "<translated tag>"}}
- Produce a clean, MONOLINGUAL result in the target language. If the input mixes languages, keep the parts already in the target language and translate the rest. Never output a bilingual side-by-side.
- Keep all numbers, weights, temperatures and times EXACTLY as given. 180g stays 180g. Do not convert units.
- Use natural home-cook vocabulary, not literal word-for-word translation. "小火慢炖" is "simmer gently", not "small fire slow stew".
- Preserve the step count and their order, one translated string per input step.
- Preserve the ingredient count and order.
- If a field is empty in the input, return it empty.`;

async function doTranslate(payload: any) {
  const to = payload?.to === 'zh' ? 'zh' : 'en';
  const recipe = payload?.recipe || {};
  const target = to === 'en' ? 'English' : 'Simplified Chinese';
  const user = `Translate this recipe into ${target}.\n\n${JSON.stringify({
    name: recipe.name || '',
    ingredients: recipe.ingredients || [],
    steps: recipe.steps || [],
    tags: recipe.tags || [],
  }, null, 2)}`;

  const raw = await callLLM(TRANSLATE_SYSTEM, user);
  let parsed: any;
  try {
    parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  } catch {
    throw new Error('模型没有返回合法 JSON');
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    ingredients: Array.isArray(parsed.ingredients)
      ? parsed.ingredients.map((i: any) => ({ name: String(i?.name ?? ''), amount: String(i?.amount ?? '') }))
      : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps.map((s: any) => String(s)) : [],
    tags: parsed.tags && typeof parsed.tags === 'object' ? parsed.tags : {},
  };
}

// ── 入口 ──

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get('origin'));
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  // 注意顺序：OPTIONS 预检必须在鉴权之前放行，它按规范不带 Authorization。
  if (!await verifyUser(req)) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  if (body?.action !== 'translate') return json({ ok: false, error: 'unknown_action' }, 400);

  const usage = await bumpUsage();
  if (!usage.ok) return json({ ok: false, error: 'rate_limited' }, 429);

  try {
    return json({ ok: true, data: await doTranslate(body.payload) });
  } catch (e) {
    return json({ ok: false, error: 'provider_error', detail: String((e as Error).message).slice(0, 300) }, 502);
  }
});
