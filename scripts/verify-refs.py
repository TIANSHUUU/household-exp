#!/usr/bin/env python3
"""检查有没有「调用了但哪里都没定义」的函数。必须从仓库根目录跑。

存在的理由：2026-08-03 上 Supabase Auth 时，四个页面的 lockApp() 都调用了
signOut()，而 assets/auth.js 里压根没定义它——点「锁定」直接抛 ReferenceError。
当时的交叉检查只看 HTML 的 onclick=，看不见 JS 内部的调用，所以漏了。
四个页面共用 auth.js 之后，这种跨文件断裂只会更多。

已知会误报：注释和界面文案里的英文单词后面跟着括号，比如
「Name matches ({0})」。所以输出是给人看的，不是 exit code——
**看到陌生名字先去 grep 一下再下结论**。

用法：python3 scripts/verify-refs.py
"""
import re
import sys

FILES = ['index.html', 'shopping.html', 'activity.html', 'recipe.html', 'assets/recipe.js']
SHARED = 'assets/auth.js'

# 注意：这里刻意**不**剥离注释。JS 里的正则字面量（比如 /\*/）会伪造出
# 块注释的开头，naive 的剥离器会顺手吃掉后面几百行真代码，然后报出一堆
# 根本不存在的「未定义」。宁可让注释里的单词误报。

def source(path):
    s = open(path, encoding='utf-8').read()
    if not path.endswith('.js'):
        # 只取内联 <script>，带 src 的是另一个文件
        scripts = re.findall(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', s, re.S)
        # 再加上标签上的内联事件属性：onclick="openAdd()" 这类调用不在 <script>
        # 里，光扫脚本体是看不见的。少一个 handler 定义就是点了没反应的哑按钮。
        handlers = re.findall(r'\son\w+\s*=\s*"([^"]*)"', s)
        s = '\n'.join(scripts + handlers)
    return s

def defined_in(src):
    d = set(re.findall(r'(?:async\s+)?function\s+(\w+)', src))
    d |= set(re.findall(r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function|[\w$]+\s*=>)', src))
    return d

KEYWORDS = set('''
if for while switch catch return typeof await async var of in new delete void yield
fetch parseInt parseFloat String Number Boolean Array Object JSON Math Date Set Map Promise
setTimeout setInterval clearTimeout clearInterval alert confirm prompt console isNaN isFinite
encodeURIComponent decodeURIComponent atob btoa RegExp Error createImageBitmap URL Intl
'''.split())

shared = defined_in(source(SHARED))
print(f'{SHARED} 对外提供: {sorted(shared)}\n')

suspects = 0
for path in FILES:
    src = source(path)
    called = set(re.findall(r'(?<![.\w$])([a-zA-Z_]\w*)\s*\(', src))
    unknown = sorted(called - defined_in(src) - shared - KEYWORDS)
    suspects += len(unknown)
    print(f'{path:20} {unknown or "✅"}')

print(f'\n共 {suspects} 个待人工确认。逐个 grep 一下：是代码就是真 bug，'
      f'是注释或文案里的英文单词就无视。')
sys.exit(0)
