# 购物清单页 设计文档

日期：2026-06-26

## 背景

来源 `shopping_list.md`：两人去超市前商量采购清单，常因多轮聊天漏记。需要一个和家庭开支页风格一致的购物清单页，两端实时同步，采购完即清除、不存档。

## 决策（已与用户确认）

1. **多清单并存** —— 按超市分多张卡片（wws、coles、维妈市场…）。
2. **逐项打勾 + 整单采购完毕** —— 采购时点掉已拿的（划线置灰）；整单结束点「采购完毕」清除。
3. **复用密码 house87** —— 与开支页同一 `SESSION_KEY`，同标签页跳转免再次输入。

## 形态

- 新文件 `shopping.html`，与 `index.html` 同仓库、同 Supabase 项目、同密码门。
- 两页顶栏互加跳转：开支页 `🛒 购物` ⇄ 购物页 `💰 开支`。

## 数据模型（Supabase，需手动建表）

`shopping_lists`：id (identity pk)、name text、created_at。
`shopping_items`：id (identity pk)、list_id bigint、name text、checked boolean default false、created_at。

两表开 RLS + 全允许策略。无外键约束，前端取两表后按 `list_id` 合并。

```sql
create table shopping_lists (
  id bigint generated always as identity primary key,
  name text not null,
  created_at timestamptz default now()
);
create table shopping_items (
  id bigint generated always as identity primary key,
  list_id bigint not null,
  name text not null,
  checked boolean default false,
  created_at timestamptz default now()
);
alter table shopping_lists enable row level security;
alter table shopping_items enable row level security;
create policy "all sl" on shopping_lists for all using (true) with check (true);
create policy "all si" on shopping_items for all using (true) with check (true);
```

## 交互

- **新建清单**：顶部按钮 / FAB → 弹窗输入名称 → 生成空卡片并聚焦其加物品输入框。
- **卡片**：🛒 名称 + 剩余/总数 + 「✓ 采购完毕」；逐行物品（圆形勾选 + 名称 + 删除 ×）；底部内联「添加物品」输入，回车连续加。
- **打勾**：乐观更新（先本地翻转并渲染，再 PATCH 落库），划线置灰。
- **采购完毕**：原生确认 → 删除该 list 及其全部 items（先删 items 再删 list），不存档。
- **同步**：30 秒轮询，签名比对仅在变化时重渲染；正在输入新物品时跳过该次轮询，避免清空输入。

## 种子

首次打开（无任何清单）自动建 `wws` 清单 + `shopping_list.md` 列出的 18 项。

## 单元边界

- DB 层：`slGetLists / siGetItems / loadAll / slInsertList / slDeleteList / siInsertItem(s) / siToggle / siDeleteItem`。
- 渲染：`render → listCardHtml`，纯函数由 `lists` 状态生成。
- 交互：`openNewList / submitNewList / addItem / toggleItem / deleteItem / doneList`。
