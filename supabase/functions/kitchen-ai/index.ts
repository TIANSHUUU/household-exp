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

// 对齐 Google 免费档 Gemini Flash 的 RPD（20 次/天）。设得比它高没有意义：
// 先撞墙的是 Google，用户看到的会是一段英文 429，而不是 err_rate_limited
// 那句友好提示。注意这 20 次是**和用户自己在 AI Studio / Antigravity 里的
// 用量共享同一个项目配额的**，所以实际能用的往往更少。
// 哪天开了付费档，这个数字要跟着往上调。
const DAILY_CAP = 20;

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

// opts.json = true 时要求模型只吐 JSON（translate 用），false 时要自由文本
// （suggest 用）。这个开关必须有——responseMimeType 写死成 application/json
// 的话，创意建议会被逼成 JSON，读起来像机器报表。
type LLMOpts = { json?: boolean; temperature?: number };

async function callGemini(system: string, user: string, opts: LLMOpts = {}): Promise<string> {
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
        generationConfig: {
          ...(opts.json === false ? {} : { responseMimeType: 'application/json' }),
          temperature: opts.temperature == null ? 0.2 : opts.temperature,
        },
      }),
    },
  );
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 返回了空内容');
  return text;
}

async function callAnthropic(system: string, user: string, opts: LLMOpts = {}): Promise<string> {
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
      temperature: opts.temperature == null ? 0.2 : opts.temperature,
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

function callLLM(system: string, user: string, opts: LLMOpts = {}): Promise<string> {
  return (Deno.env.get('PROVIDER') || 'gemini') === 'anthropic'
    ? callAnthropic(system, user, opts)
    : callGemini(system, user, opts);
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

  const raw = await callLLM(TRANSLATE_SYSTEM, user, { json: true, temperature: 0.2 });
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

// ── suggest ──
// 前端把拼好的 prompt 直接发过来（`assets/recipe.js` 的 buildPrompt），
// 这里只负责调模型。**一份 prompt 两个去处**：复制到剪贴板给 Claude 的，
// 和送进这里的，是同一段文字。函数里再拼一份的话，改了一处忘了另一处
// 就会各说各话，而这种不一致很难被发现。
//
// 代价是改 prompt 要动前端（要 bump 缓存版本号）而不是只重部署函数。
// 这个仓库两者都是一条命令，不构成问题。

const SUGGEST_SYSTEM = `You are a practical home-cooking companion helping a couple decide what to cook.

Rules:
- Reply in the SAME language as the user's message. If they write Chinese, answer in Chinese.
- PLAIN TEXT ONLY. No markdown: no **bold**, no #headings, no leading - or * bullets, no tables.
  Separate ideas with blank lines. When naming a dish, put it at the start of its own line
  followed by a colon and a one or two sentence description.
- Be concrete and cookable. Name real dishes, say roughly how they're made in one or two sentences.
- Prefer ideas that genuinely use what they already have. Don't suggest something that needs
  five things they don't have.
- If one or two cheap extra purchases would open up a lot more options, say so at the end.
- Keep the whole reply under about 350 words. They are reading this on a phone.`;

async function doSuggest(payload: any) {
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt.trim() : '';
  if (!prompt) throw new Error('没有收到 prompt');
  // 上限防呆：食谱库再大也不该有这么长，超了多半是前端出了问题
  if (prompt.length > 20000) throw new Error('prompt 过长');
  // temperature 比翻译高得多——这里要的是发散，不是精确复述
  return { text: await callLLM(SUGGEST_SYSTEM, prompt, { json: false, temperature: 0.9 }) };
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

  const action = body?.action;
  if (action !== 'translate' && action !== 'suggest') {
    return json({ ok: false, error: 'unknown_action' }, 400);
  }

  // 两个 action 共用同一个日限额计数器——它护的是 API 账单，不分用途。
  const usage = await bumpUsage();
  if (!usage.ok) return json({ ok: false, error: 'rate_limited' }, 429);

  try {
    const data = action === 'translate'
      ? await doTranslate(body.payload)
      : await doSuggest(body.payload);
    return json({ ok: true, data });
  } catch (e) {
    return json({ ok: false, error: 'provider_error', detail: String((e as Error).message).slice(0, 300) }, 502);
  }
});
