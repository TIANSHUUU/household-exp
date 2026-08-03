#!/usr/bin/env python3
"""检查线上食材词表有没有冲突，并跑几组已知断言。

先跑 `python3 scripts/get-token.py` 换令牌，再跑这个。

为什么需要它：`assets/recipe.js` 的 buildAliasMap 用 Map.set 建查找表，
**同一个词指向两个 canonical 时会静默覆盖**——症状是搜索和冰箱匹配莫名
其妙认错食材，不主动查根本发现不了。

种子表（supabase/seed-ingredient-vocab.sql）只是把起点垫高了，挡不住
以后网页手动录入引入新的冲突词条，所以这个检查值得反复跑。
"""
import json
import os
import re
import sys
import urllib.request

KEY = 'sb_publishable_al2tSxbN67a8_frUBnEzYg_dmGNU5g5'
API = 'https://mpvsbeghuueffkjdemcr.supabase.co/rest/v1'

# 期望成立的映射。前两组是这次种子表要解决的原始问题，
# 后两组盯着英文搜索——它完全依赖别名命中。
EXPECTED = [
    ('西红柿', '番茄'),
    ('tomato', '番茄'),
    ('马铃薯', '土豆'),
    ('buttermilk', '酪乳'),
    ('salt', '盐'),
    ('spring onion', '葱'),
]


def norm_key(s):
    """和 assets/recipe.js 的 normKey 保持一致"""
    return re.sub(r'\s+', '', str(s if s is not None else '').strip().lower())


def main():
    if not os.path.exists('.token'):
        sys.exit('没找到 .token，先跑：python3 scripts/get-token.py')
    token = open('.token').read().strip()

    req = urllib.request.Request(
        f'{API}/ingredient_vocab?select=canonical,aliases,staple&order=canonical.asc',
        headers={'apikey': KEY, 'Authorization': f'Bearer {token}'},
    )
    try:
        with urllib.request.urlopen(req) as r:
            vocab = json.load(r)
    except Exception as e:
        sys.exit(f'读词表失败（令牌过期了？重跑 get-token.py）：{e}')

    print(f'词表 {len(vocab)} 条，staple {sum(1 for v in vocab if v["staple"])} 条\n')

    # 按 recipe.js 的顺序重建查找表，同时记录冲突
    alias_map, owner, clashes = {}, {}, []
    for v in vocab:
        canon = v['canonical']
        for term in [canon] + list(v.get('aliases') or []):
            k = norm_key(term)
            if k in owner and owner[k] != canon:
                clashes.append((term, owner[k], canon))
            owner[k] = canon
            alias_map[k] = canon

    failed = False

    if clashes:
        failed = True
        print('❌ 有词同时属于两个 canonical（后者会静默覆盖前者）：')
        for term, a, b in clashes:
            print(f'   「{term}」→ 既属于「{a}」又属于「{b}」')
    else:
        print(f'✅ {len(alias_map)} 个查找键，无冲突')

    print()
    for src, want in EXPECTED:
        got = alias_map.get(norm_key(src))
        ok = got == want
        failed = failed or not ok
        print(f'{"✅" if ok else "❌"} {src:<14} → {got or "（查不到，会被当成新食材）"}'
              + ('' if ok else f'   期望「{want}」'))

    # 非中文 canonical 会破坏「机器键永远是中文」这条约定
    bad = [v['canonical'] for v in vocab if not re.search(r'[一-鿿]', v['canonical'])]
    if bad:
        failed = True
        print(f'\n❌ canonical 不是中文（违反 HANDOFF 第三节铁律）：{bad}')

    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
