// ── Supabase 请求头（四个页面共用）──
//
// 这个文件必须在各页面自己的脚本之前加载：它定义了 KEY 和 H()，
// 四个页面的所有 PostgREST / Storage 请求都靠 H() 拿请求头。
//
// 2026-11-02：登录整套拿掉了。这里原来管着一个真实 Supabase 账号的
// access_token / refresh_token，数据库 RLS 写的是 `to authenticated`，
// 没令牌就在数据库层面直接拒绝。现在 RLS 放开给 anon，请求只带下面这个
// publishable key 就够了。
//
// ⚠️ 这是一个被明确选择过的取舍，不是疏忽：仓库是公开的，key 就写在源码里，
// 所以任何人拿到网址都能读、改、删全部数据。换来的是两人用的时候一次密码
// 都不用输。想收回去的完整做法见 docs/HANDOFF.md 第九节。

const KEY = 'sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5';

// 保持 async 不变：四个页面有上百处 `await H()`，签名一动就得全改。
// apikey 和 Authorization 两个都要带——PostgREST 靠 Authorization 里的
// 令牌决定用哪个数据库角色，只给 apikey 在部分路径上会落不到 anon 上。
async function H() {
  return {
    'apikey': KEY,
    'Authorization': 'Bearer ' + KEY,
    'Content-Type': 'application/json',
  };
}
