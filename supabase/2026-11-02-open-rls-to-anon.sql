-- ════════════════════════════════════════════════════════════════════════════
-- 2026-11-02：去掉登录，把 RLS 从「只认登录用户」放开给匿名
-- ════════════════════════════════════════════════════════════════════════════
--
-- 背景：2026-08-03 为了堵住「全部数据对公网可读可写」，八张表的策略收成了
-- `to authenticated`，网页用一个真实 Supabase 账号登录换令牌。2026-11-02 用户
-- 决定不要这道门了（两人自用，嫌每次登录麻烦），于是反向操作。
--
-- ⚠️ 执行完的后果，写明白免得以后有人以为是配错了：
--    仓库是公开的，publishable key 就写在 assets/auth.js 里，所以执行完
--    **任何人拿到网址都能读、改、删全部开支/活动/购物/食谱数据**。
--    这是明确选择的取舍，不是疏忽。想收回去见 docs/HANDOFF.md 第九节。
--
-- 怎么跑：Supabase 控制台 → SQL Editor → 整段粘进去 → Run
-- ════════════════════════════════════════════════════════════════════════════

-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ 第 0 步（可选）：先看现在有哪些策略，跑完好对照                        │
-- └────────────────────────────────────────────────────────────────────────┘
-- select tablename, policyname, roles, cmd from pg_policies
--  where schemaname = 'public' order by tablename;


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ 第 1 步：八张业务表                                                    │
-- │                                                                        │
-- │ 每张表两句：先删掉旧的 authed_all，再建一条谁都能用的 open_all。       │
-- │ 关键在于**不写 `to authenticated`**——不写就等于 `to public`，         │
-- │ 所有角色都匹配，包括没登录的 anon。                                   │
-- │ `if exists` 是为了让这段能重复跑，不会因为策略已经没了而报错。        │
-- └────────────────────────────────────────────────────────────────────────┘

drop   policy if exists authed_all on public.expenses;
create policy open_all on public.expenses        for all using (true) with check (true);

drop   policy if exists authed_all on public.cycles;
create policy open_all on public.cycles          for all using (true) with check (true);

drop   policy if exists authed_all on public.activities;
create policy open_all on public.activities      for all using (true) with check (true);

drop   policy if exists authed_all on public.shopping_lists;
create policy open_all on public.shopping_lists  for all using (true) with check (true);

drop   policy if exists authed_all on public.shopping_items;
create policy open_all on public.shopping_items  for all using (true) with check (true);

drop   policy if exists authed_all on public.recipes;
create policy open_all on public.recipes         for all using (true) with check (true);

drop   policy if exists authed_all on public.ingredient_vocab;
create policy open_all on public.ingredient_vocab for all using (true) with check (true);

drop   policy if exists authed_all on public.tag_i18n;
create policy open_all on public.tag_i18n        for all using (true) with check (true);


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ 第 2 步：Storage —— 菜谱照片的上传 / 删除 / 列目录                    │
-- │                                                                        │
-- │ 桶本身一直是 public，`/object/public/...` 端点根本不查策略，所以       │
-- │ <img src> 显示照片从来没受影响。这条策略管的只是上传、删除、列目录。   │
-- │ 不改这条的话：页面能看照片，但新增食谱传图会 400。                    │
-- └────────────────────────────────────────────────────────────────────────┘

drop   policy if exists "recipe images authed" on storage.objects;
create policy "recipe images open" on storage.objects
  for all
  using      (bucket_id = 'recipe-images')
  with check (bucket_id = 'recipe-images');


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ 第 3 步：ai_usage 故意不动                                             │
-- │                                                                        │
-- │ 它一条策略都没有，只有 Edge Function 用 service role 访问，而          │
-- │ service role 绕过 RLS。放开它等于把 AI 日限额的计数器交给公网改，      │
-- │ 那个 DAILY_CAP = 20 就白设了。                                        │
-- └────────────────────────────────────────────────────────────────────────┘


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ 跑完贴这句验收                                                         │
-- │ 期望：八行，policyname 都是 open_all，roles 都是 {public}             │
-- └────────────────────────────────────────────────────────────────────────┘
-- select tablename, policyname, roles, cmd from pg_policies
--  where schemaname = 'public' order by tablename;
