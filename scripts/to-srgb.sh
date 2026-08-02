#!/bin/bash
# 把 iPhone 的 HDR 照片转成 sRGB，再上传到食谱页。
#
# 为什么需要这一步：iPhone 拍的照片是 Display P3 + PQ（HDR）编码的。浏览器
# 普遍不做 PQ 传输函数的转换，会把 PQ 数值当普通 sRGB 直接渲染，结果就是
# 发灰发平——实测饱和度和对比度都只有正常值的一半。网页端修不了这个：
# canvas 解码出来的也是同样的原始数值（已实测验证），所以只能在上传前
# 用 macOS 的 ColorSync 转一次。
#
# 用法：
#   scripts/to-srgb.sh <照片或文件夹> [输出目录]
#
# 例：
#   scripts/to-srgb.sh ~/Desktop/今天做的菜
#   scripts/to-srgb.sh photo.jpg /tmp/out

set -euo pipefail

SRC="${1:?用法: scripts/to-srgb.sh <照片或文件夹> [输出目录]}"
OUT="${2:-}"
PROFILE="/System/Library/ColorSync/Profiles/sRGB Profile.icc"

[ -f "$PROFILE" ] || { echo "找不到 sRGB profile，这个脚本只能在 macOS 上跑" >&2; exit 1; }

if [ -d "$SRC" ]; then
  OUT="${OUT:-$SRC/srgb}"
  mkdir -p "$OUT"
  found=0
  # -print0 / read -d '' 处理带空格的文件名
  while IFS= read -r -d '' f; do
    found=1
    base=$(basename "$f")
    sips -m "$PROFILE" "$f" --out "$OUT/$base" >/dev/null
    printf '  ✓ %s\n' "$base"
  done < <(find "$SRC" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' \) -print0)
  [ "$found" = 1 ] || { echo "没找到图片文件" >&2; exit 1; }
  echo "转好了 → $OUT"
else
  [ -f "$SRC" ] || { echo "找不到文件: $SRC" >&2; exit 1; }
  OUT="${OUT:-$(dirname "$SRC")/srgb}"
  mkdir -p "$OUT"
  base=$(basename "$SRC")
  sips -m "$PROFILE" "$SRC" --out "$OUT/$base" >/dev/null
  echo "转好了 → $OUT/$base"
fi
