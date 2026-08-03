# 冰箱页 → 购物清单联动设计

2026-08-03

一期 spec 里的「三期」，把「想吃什么 → 要买什么」接通。

## 交互

冰箱页的分桶结果里，**只有「再买 N 样」那些桶**的每行右侧加一个 `+ 🛒` 按钮。「现在就能做」那桶不加——没东西可买。

点按钮 → 弹一个选择框，列出现有清单 + 「+ 新建一张清单」→ 选中即写入 → 按钮原地变成 `✓ 已加入「周末采购」`，2.5 秒后恢复。

全部缺料都已经在清单里时显示「已经都在清单里了」，**不假装加成功**。

## 两个关键决定

### 写进去的是当前界面语言的词

中文界面写「番茄」，英文界面写 `tomato`。判据是**你看到什么就存什么**——点的时候显示 `tomato`、存进去变「番茄」会很突兀。

复用 `ingLabel(entry, lang)`（食材建议那次加的）。写进清单的英文名再读回来仍然解析得回中文 canonical（实测 `beef → 牛肉`），所以下次查重不会因为语言不同失效。

### 查重按 canonical 比，不按字符串

`missingNotInList(missing, existingNames, aliasMap)` 把两边都过一次 `toCanonical` 再比。清单里已经有 `tomato` 时再加「番茄」不该重复——**只比字符串会漏掉这种**，而这正是食材词表要解决的同一件事。

这条有专门的断言（`清单里的英文别名也算已有`），去掉 `toCanonical` 会立刻失败。

## 实现

| 位置 | 加了什么 |
|---|---|
| `assets/recipe.js` 纯逻辑段 | `missingNotInList()` |
| `assets/recipe.js` | `shopListsGet / shopItemsGet / shopListCreate / shopItemsInsert` |
| `assets/recipe.js` | `openShopPicker / closeShopPicker / addMissingToList / addMissingToNewList` |
| `assets/recipe.js` | `ingName(canonical)` —— canonical → 当前语言显示词，走 `canonMap` |
| `recipe.html` | `#shop-picker` 浮层 |
| `assets/recipe.css` | `.shop-add` / `.picker*` |
| i18n | 中英各 9 个 key |

购物清单的数据层在 `shopping.html` 里是内联的，没法复用，所以 `recipe.js` 里重写了一份。四个函数、二十来行，比把 shopping.html 拆成外部文件划算——那会牵动另一个页面的缓存版本号。

**position 接在清单末尾**：取现有条目的最大 position + 1。不给 position 的话购物页会把新条目排到最前面。

**z-index 层级**：登录页 9999 > 灯箱 9998 > 选择框 9997。登录页必须盖住一切。

## 验证

纯逻辑 8 条断言覆盖：空清单、不相干条目、同名、英文别名、中文别名、大小写空格、无缺料、清单为 null。

浏览器里用假数据驱动渲染层实测（不需要登录）：

- 「现在就能做」桶按钮数 = 0，「再买 1 样」桶 = 1
- 中文界面显示「牛肉」，英文界面显示 `beef`
- position 接在已有条目之后
- 清单里已有 `tomato` 时加「番茄」→ 写入 0 条，提示「已经都在清单里了」
- 手机 375px 下缺 3 样的行不被裁切

## 不做

- 不做「一键把整桶都加进去」——容易误加一堆。
- 不改购物清单页。它不需要知道条目从哪来。
- 不记录「这条是从哪道菜加的」。多一个字段换一点点信息，划不来。

## 顺带发现的既有 bug（未修）

**英文界面在手机上横向溢出 110px**，中文界面正好不溢出。原因是顶栏导航：`💰 Expenses / 🛒 Shopping / 📅 Schedule / 中文 / Lock` 共 335px，而视口 375px。`@media (max-width: 520px)` 已经缩了字号和内边距，但英文单词本身就比中文的「开支/购物/日程」长一倍。

和本次改动无关（2026-08-02 双语改造时就存在），实测有没有 `+ 🛒` 按钮溢出量都是 110px。

修法要动 `paintChrome`：把 emoji 和文字拆成两个 span，窄屏时只留 emoji。没做，因为不在本次范围内。
