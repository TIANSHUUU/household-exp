#!/usr/bin/env python3
"""换一个登录令牌，写进 .token（1 小时有效）。

存在的理由：2026-08-03 上了 Auth 之后，写数据库要登录。但录食谱这类活儿
是 Claude 在会话里用 curl 干的，而**密码不该出现在会话里**。

这个脚本把密码这一环隔开：密码只在你自己的终端出现一次（不回显、不进
shell 历史），换来的令牌落到 .token 文件。之后的命令一律用
`$(cat .token)` 引用——Claude 从头到尾看不到密码，也看不到令牌本身。

用法：
    python3 scripts/get-token.py
    curl ... -H "Authorization: Bearer $(cat .token)"

令牌 1 小时过期，过期了重跑一次。用完 `rm .token` 更干净。
"""
import getpass
import json
import os
import sys
import urllib.error
import urllib.request

KEY = 'sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5'
URL = 'https://mpvsbeghuueffkjdemcr.supabase.co/auth/v1/token?grant_type=password'
EMAIL = 'home@household.local'          # 和 assets/auth.js 里的 ACCOUNT_EMAIL 一致
OUT = '.token'

pw = getpass.getpass('网页密码（不回显）：')
if not pw:
    sys.exit('没输密码，取消。')

req = urllib.request.Request(
    URL,
    method='POST',
    data=json.dumps({'email': EMAIL, 'password': pw}).encode('utf-8'),
    headers={'apikey': KEY, 'Content-Type': 'application/json'},
)

try:
    with urllib.request.urlopen(req) as r:
        data = json.load(r)
except urllib.error.HTTPError as e:
    sys.exit(f'登录失败（HTTP {e.code}）：密码不对，或者账号被停用了。')
except Exception as e:
    sys.exit(f'登录失败：{e}')

token = data.get('access_token')
if not token:
    sys.exit('服务端没返回令牌，响应格式不对。')

# 0600：只有你自己读得了。O_TRUNC 保证不会残留上一次的内容。
fd = os.open(OUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write(token)

print(f'✅ 令牌已写入 {OUT}（1 小时后过期）。')
print('   后续命令这样用：curl ... -H "Authorization: Bearer $(cat .token)"')
