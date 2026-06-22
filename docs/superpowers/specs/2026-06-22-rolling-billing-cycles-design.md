# 滚动账期 + 往期记录 设计文档

日期：2026-06-22

## 背景

家庭账单当前只维护"本期"一份记录。租金日（每月 22 日）结算后，"开始新账期"会直接清空全部记录。需求变更：

1. 结算后无需立即清账，本期结余/欠款应**自动滚入下一期**冲抵。
2. "开始新账期"不再删除记录，而是**归档**当前账期到可查询的历史区。
3. 通过左侧抽屉菜单"往期记录"查看历史账期的**完整明细**（B 方案：逐笔，非仅摘要）。

## 数据模型

### 新增 `cycles` 表（Supabase）

| 列 | 类型 | 说明 |
|---|---|---|
| id | bigint identity pk | 账期主键 |
| label | text | 账期名称，如"5–6月账期" |
| start_date | date | 账期开始日 |
| end_date | date | 账期结束日（归档时写入） |
| carryover | numeric default 0 | 上期滚入的结余/欠款 |
| transfer | numeric | 本期最终结算额（归档时写入） |
| status | text default 'active' | active \| archived |
| created_at | timestamptz default now() | |

RLS 开启，沿用现有"全允许"策略。

### `expenses` 表新增列

`cycle_id bigint` —— 每笔开支归属的账期。当前活跃账期 = `cycles` 中 `status='active'` 的唯一一行。

### 迁移 SQL

```sql
create table cycles (
  id          bigint generated always as identity primary key,
  label       text,
  start_date  date,
  end_date    date,
  carryover   numeric default 0,
  transfer    numeric,
  status      text default 'active',
  created_at  timestamptz default now()
);
alter table cycles enable row level security;
create policy "all cycles" on cycles for all using (true) with check (true);

alter table expenses add column cycle_id bigint;

insert into cycles (label, start_date, status) values ('首期账单', '2026-05-22', 'active');
update expenses set cycle_id = (select id from cycles limit 1);
```

## 计算逻辑

新公式增加 carryover 项：

```
应转给宝宝 = carryover + myRent − shared/2 − partner_personal + partner_paid
```

- carryover = 上一账期归档时的最终 `transfer` 值，原样滚入。
- 符号约定：transfer 正 = 我转给宝宝；负 = 宝宝欠我。
- 例：本期 transfer = −17.55（宝宝欠我），归档后滚入下期 carryover = −17.55，下期我少转 17.55，符号自动正确。
- 摘要新增一行"上期结余/欠款"：carryover < 0 显示"宝宝欠你 $X"（绿色，抵减）；> 0 显示"你欠宝宝 $X"（红色，增加）；= 0 不显示。

## "开始新账期" 流程（归档而非删除）

1. 计算当前账期最终 transfer（含 carryover）。
2. 当前账期行：`status='archived'`、`end_date=今天`、`transfer=最终值`。
3. 新建账期行：`status='active'`、`start_date=今天`、`carryover=刚才的最终 transfer`、自动 label。
4. 现有开支保持 `cycle_id` 指向归档账期，不动。
5. 界面重置为新账期（空明细 + "上期结余"行）。

确认弹窗文案改为"归档本期并开始新账期"，不再提"清空"。

## UI：往期记录

- 顶栏新增 ☰ 菜单按钮。
- 点击 → 左侧滑入抽屉，列出全部 `archived` 账期，倒序：每行显示日期范围 · 笔数 · 结算额。
- 点某一期 → 只读详情视图（复用现有 list 渲染样式），显示该期逐笔开支 + 当时摘要（含 carryover、最终 transfer）。只读，无编辑/删除/添加按钮。
- 关闭详情返回抽屉；关闭抽屉返回当前账期。

## 数据加载变更

- 启动时先取 active 账期；`loadExpenses` 改为 `expenses?cycle_id=eq.<activeId>`。
- 新增开支、撤销、编辑均带上 active `cycle_id`。
- 30 秒轮询只比对当前账期数据。
- 首次启动若无 active 账期（迁移未跑），降级提示。

## 单元边界

- DB 层：新增 `dbGetCycles`、`dbGetActiveCycle`、`dbInsertCycle`、`dbUpdateCycle`，沿用 fetch 风格。
- calc()：增加 carryover 入参。
- 渲染：summary 增加 carryover 行；新增 drawer 渲染 + 历史详情渲染（只读）。
- newCycle()：重写为归档流程。

## 兼容性

迁移 SQL 把现有 19 笔归入"首期账单"活跃账期，无数据丢失。前端在 active 账期缺失时给出可读错误而非崩溃。
