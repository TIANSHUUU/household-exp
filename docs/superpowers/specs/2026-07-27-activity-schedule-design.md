# 活动安排页 设计文档

日期：2026-07-27

## 背景

我们一周中各个时段可能有各种活动（周末和朋友吃饭、周中傍晚打网球等）。需要一个和开支页、购物页风格一致的日程页面，两端实时同步，区分「待定（proposed）」和「已确认（confirmed）」两种状态，两人都能把活动在两个状态间互相移动。

## 决策（已与用户确认）

1. **具体日期 + 选填时段** —— 每个活动挂在具体某一天，不做「每周固定时段」的重复模板。
2. **时段粗粒度 + 精确时间都支持，且都选填** —— 时段从「上午/下午/傍晚/晚上」里选，另外可以选填精确时间（HH:MM）作补充说明。
3. **字段**：标题 + 日期 + 时段（选填）+ 精确时间（选填）+ 地点/备注（选填）+ 状态。
4. **待定/已确认分两个区块展示**，不是混合时间线打标签。
5. **过期活动自动隐藏，不保留历史** —— 前端过滤日期早于今天的活动，数据库不删除、不归档。
6. **添加时状态可选** —— 默认「待定」，但如果一开口就是定下来的事，也可以直接选「已确认」。
7. **复用密码** —— 与开支页、购物页同一 `SESSION_KEY` / `PWD_HASH`，同标签页跳转免再次输入。

## 形态

- 新文件 `activity.html`，与 `index.html`、`shopping.html` 同仓库、同 Supabase 项目、同密码门。
- 三页顶栏互加跳转：开支页 `🛒 购物` `📅 日程`，购物页 `💰 开支` `📅 日程`，日程页 `💰 开支` `🛒 购物`。

## 数据模型（Supabase，需手动建表）

`activities`：id (identity pk)、title text、date date、period text（'morning'|'afternoon'|'evening'|'night'，选填）、time text（'HH:MM'，选填）、note text（选填）、status text（'proposed'|'confirmed'，默认 'proposed'）、created_at。

开 RLS + 全允许策略，与其余两张表一致。

```sql
create table activities (
  id bigint generated always as identity primary key,
  title text not null,
  date date not null,
  period text,
  time text,
  note text,
  status text not null default 'proposed',
  created_at timestamptz default now()
);
alter table activities enable row level security;
create policy "all activities" on activities for all using (true) with check (true);
```

## 交互

- **顶部「+ 添加活动」**：打开底部表单 —— 标题、日期（默认今天）、时段（不选/上午/下午/傍晚/晚上）、精确时间（选填）、地点备注（选填）、状态（待定/已确认 分段选择，默认待定）。
- **两个区块**：「待定」在上、「已确认」在下，各自内部按日期分组（复用开支页 date-group 卡片样式），组内按日期升序、同日内按时段先后排序。过期（日期 < 今天）的活动前端过滤掉，不展示。
- **状态切换**：待定行右侧「✓ 确认」按钮，已确认行右侧「↩ 转待定」按钮。点击即时 PATCH `status` 字段并本地刷新，无需二次确认（可逆操作）。
- **编辑**：点击 ✎ 复用添加表单，预填现有值，保存时 PATCH。
- **删除**：点击 × → 原生 `confirm()` 二次确认 → 立即 DELETE，不做撤销 toast（与购物清单页的删除风格一致，保持轻量）。
- **空状态**：两个区块分别有各自的空状态提示（"暂无待定活动" / "暂无已确认活动"）。
- **同步**：15 秒轮询（`document.visibilityState === 'visible'` 时才请求），签名比对仅在数据变化时重渲染，参考开支页实现。

## 单元边界

- DB 层：`actGetAll / actInsert / actUpdate / actDelete`。
- 渲染：`render → sectionHtml(status) → dateGroupHtml → itemRowHtml`，纯函数由 `activities` 状态 + 今天日期过滤生成。
- 交互：`openAdd / openEdit / submitActivity / toggleStatus / askDel / confirmDel`。
