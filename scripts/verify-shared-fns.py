#!/usr/bin/env python3
"""检查「本该完全一样的共用函数」有没有在页面之间悄悄分化。必须从仓库根目录跑。

存在的理由：2026-08-04 发现 `escHtml` 在 `index.html` 里还是旧版本——不转义单引号、
也没有 `String()` 兜底，而 `shopping.html` / `activity.html` 早就改进过了。
**改进只传播到了 3 个页面里的 2 个，而且没有任何机制会告诉你漏了。**

四个页面各自内联写 JS 是这个仓库有意的选择（没有构建步骤，推 main 即上线，
双击 HTML 就能打开）。代价就是这类重复。与其为了几个小函数去抽模块、再背上
`?v=` 版本号的维护负担，不如**承认重复存在，但不让它悄悄漂移**。

## WATCH 是什么

只盯 WATCH 里列的函数：哪个页面定义了它，就必须和别的页面**字节相同**
（忽略缩进和换行的差异）。

**不在 WATCH 里的重复函数一概不管。** `render` / `itemRowHtml` / `startPolling`
/ `showLoading` 这些在各页面本来就该长得不一样——账单的行和活动的行不是一回事，
硬统一会造出一个塞满 `if (页面 === 'xxx')` 的怪物，比重复更难维护。

所以这是一份**主动登记**的清单，不是「除了这些都要管」。加新的共用小工具时，
如果它确实该在各页面保持一致，就往 WATCH 里加一个名字。

用法：python3 scripts/verify-shared-fns.py
退出码 0 = 没有分化，1 = 有分化（是真 bug，去看输出里的 diff）
"""
import re
import sys
import difflib

PAGES = ['index.html', 'shopping.html', 'activity.html']

# 这些函数在多个页面里必须一模一样。每条都写清楚为什么。
WATCH = {
    'escHtml':      '把用户输入拼进 HTML 前的转义。各页面不一致 = 有的页面防得住有的防不住',
    'setSyncDot':   '右上角同步状态小圆点，三个页面共用同一套 CSS class',
    'overlayClick': '点浮层空白处关闭，交互手感必须一致',
    'lockApp':      '锁定退出，涉及清登录令牌，逻辑不该有分支',
    'unlock':       '登录，涉及令牌，同上',
    'closeAdd':     '关闭添加面板并复位编辑状态',
    'fmtDate':      '日期显示格式，各页面不一致会很突兀',
}


def inline_js(path):
    """只取内联 <script> 的内容，带 src= 的是另一个文件。"""
    html = open(path, encoding='utf-8').read()
    return '\n'.join(
        re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', html, re.S))


def extract(src, name):
    """按大括号配对切出整个函数体。正则数不清嵌套的括号，只能手动数。"""
    m = re.search(r'(?:async\s+)?function\s+' + re.escape(name) + r'\s*\([^)]*\)\s*\{', src)
    if not m:
        return None
    i, depth = m.end(), 1
    while i < len(src) and depth:
        if src[i] == '{':
            depth += 1
        elif src[i] == '}':
            depth -= 1
        i += 1
    return src[m.start():i]


def normalize(body):
    """把连续空白压成一个空格——只在意行为，不在意排版。"""
    return re.sub(r'\s+', ' ', body).strip()


sources = {p: inline_js(p) for p in PAGES}
drifted = 0

for name in sorted(WATCH):
    found = {}
    for p in PAGES:
        body = extract(sources[p], name)
        if body:
            found[p] = body

    if len(found) < 2:
        where = list(found) or ['哪儿都没有']
        print(f'{name:14} ⚠️  只在 {", ".join(where)} 里定义，没有可比对的对象'
              f'——要么是删过，要么该从 WATCH 里拿掉')
        continue

    shapes = {normalize(b) for b in found.values()}
    if len(shapes) == 1:
        print(f'{name:14} ✅ {len(found)} 个页面一致')
        continue

    drifted += 1
    print(f'{name:14} ❌ {len(found)} 个页面里分化成了 {len(shapes)} 个版本')
    print(f'{"":16}理由：{WATCH[name]}')
    base_page = PAGES[0] if PAGES[0] in found else sorted(found)[0]
    for p, body in sorted(found.items()):
        if p == base_page:
            continue
        if normalize(body) == normalize(found[base_page]):
            continue
        diff = difflib.unified_diff(
            found[base_page].splitlines(), body.splitlines(),
            fromfile=base_page, tofile=p, lineterm='', n=1)
        for line in diff:
            print(f'{"":16}{line}')
    print()

if drifted:
    print(f'\n{drifted} 个共用函数分化了。**这类分化不会自己暴露**——'
          f'页面照常工作，只是有的页面拿到的是旧行为。请统一它们。')
    sys.exit(1)

print(f'\n{len(WATCH)} 个共用函数全部一致 ✅')
sys.exit(0)
