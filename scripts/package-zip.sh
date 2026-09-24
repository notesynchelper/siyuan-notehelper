#!/usr/bin/env bash
# 统一打包 package.zip（双入口构建完成后执行）
# zip 内为 dist/ 全部内容平铺（与旧 ZipPlugin pathMapper 语义一致：
# 顶层含 plugin.json / index.js / index.css / kernel.js / icon.png / preview.png / README*.md）
set -euo pipefail
cd "$(dirname "$0")/.."
rm -f package.zip
(cd dist && zip -qr ../package.zip .)
unzip -l package.zip | tail -3
# grep 必须读完输入；-q 提前退出会在 pipefail 下偶发触发 unzip SIGPIPE。
if ! unzip -Z1 package.zip | grep -Fx "kernel.js" > /dev/null; then
  echo "package.zip 缺少 kernel.js" >&2
  exit 1
fi
if ! unzip -Z1 package.zip | grep -Fx "index.js" > /dev/null; then
  echo "package.zip 缺少 index.js" >&2
  exit 1
fi
echo "package.zip OK"
