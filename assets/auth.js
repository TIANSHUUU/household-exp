// ── 登录与令牌管理（四个页面共用）──
//
// 这个文件必须在各页面自己的脚本之前加载：它定义了 KEY 和 H()，
// 四个页面的所有 PostgREST / Storage 请求都靠 H() 拿鉴权头。
//
// 工作方式：网页密码是一个真实 Supabase 账号的密码，登录成功换回
// access_token（1 小时有效）+ refresh_token（长期）。数据库的 RLS 策略
// 只认登录用户，所以没有令牌 = 数据库层面直接拒绝，而不是只把界面藏起来。
//
// 账号邮箱写死在这里是有意的——它不是秘密，密码才是凭证。刻意用一个
// 收不到信的假地址：仓库是公开的，写真实邮箱等于把它送去被爬。密码忘了
// 从 Supabase 控制台直接重设，用不着邮件找回。

const KEY  = 'sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5';
const AUTH = 'https://mpvsbeghuueffkjdemcr.supabase.co/auth/v1';
const ACCOUNT_EMAIL = 'home@household.local';
const TOK_KEY = 'hh_tok';

// 用 localStorage 而不是 sessionStorage：登录态该跨会话保持，
// 否则手机上每次切回来都要重输密码。
let tok = null;          // { access_token, refresh_token, expires_at }

function loadTok() {
  try { tok = JSON.parse(localStorage.getItem(TOK_KEY)) || null; }
  catch (e) { tok = null; }
  return tok;
}

function saveTok(d) {
  if (!d || !d.access_token) { clearTok(); return false; }
  tok = {
    access_token:  d.access_token,
    refresh_token: d.refresh_token,
    // 提前 60 秒当作过期，免得请求发出去的路上刚好失效
    expires_at: Date.now() + ((d.expires_in || 3600) - 60) * 1000,
  };
  localStorage.setItem(TOK_KEY, JSON.stringify(tok));
  return true;
}

function clearTok() {
  tok = null;
  localStorage.removeItem(TOK_KEY);
}

async function tokenReq(query, body) {
  try {
    const r = await fetch(`${AUTH}/token?${query}`, {
      method: 'POST',
      headers: { 'apikey': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;                       // 断网等同于登录失败，交给调用方提示
  }
}

async function signIn(password) {
  return saveTok(await tokenReq('grant_type=password', { email: ACCOUNT_EMAIL, password }));
}

// 同一时刻只允许一个续期请求在飞。
// Supabase 每次续期都会作废旧的 refresh_token，几个请求同时续会有人拿到
// invalid_grant，然后把登录态清掉——表现就是「用着用着突然被踢回登录页」。
let refreshing = null;

function refreshTok() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    if (!tok || !tok.refresh_token) return false;
    const d = await tokenReq('grant_type=refresh_token', { refresh_token: tok.refresh_token });
    if (!d) { clearTok(); return false; }    // refresh_token 也失效了，只能重新登录
    return saveTok(d);
  })();
  return refreshing.finally(() => { refreshing = null; });
}

// 各页面的 lockApp() 调用：退出登录。
function signOut() { clearTok(); }

// 页面打开时调用：本地有令牌就续一次。返回 true 表示可以直接进 app。
async function resumeSession() {
  if (!loadTok()) return false;
  if (Date.now() < tok.expires_at) return true;
  return refreshTok();
}

// 所有 PostgREST / Storage 请求的鉴权头。令牌过期就先换新的。
// 拿不到令牌就弹回登录页并抛错——调用方本来就有 try/catch 或 r.ok 检查。
async function H() {
  if (!tok) loadTok();
  if (tok && Date.now() >= tok.expires_at) await refreshTok();
  if (!tok) {
    if (typeof lockApp === 'function') lockApp();
    throw new Error('not_authenticated');
  }
  return {
    'apikey': KEY,
    'Authorization': 'Bearer ' + tok.access_token,
    'Content-Type': 'application/json',
  };
}
