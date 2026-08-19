#!/bin/bash
# Provision an extracted SiYuan Linux release under $SIYUAN_RUNTIME so the
# real-siyuan harness can drive it. Several versions live side by side, which is
# what lets a repro be pinned to the version a user reported the bug on.
#
#   tests/real-siyuan/provision-runtime.sh 3.8.0
#   SIYUAN_VERSION=3.8.0 node tests/real-siyuan/run-sync-smoke.js
#
# Idempotent: an already-extracted version is left alone.
set -euo pipefail

VER="${1:-}"
if [ -z "$VER" ]; then
  echo "usage: $0 <version>   e.g. $0 3.8.0" >&2
  exit 2
fi

RUNTIME="${SIYUAN_RUNTIME:-/home/work/siyuan-runtime}"
DIR="$RUNTIME/siyuan-${VER}-linux"
TARBALL="$RUNTIME/siyuan-${VER}-linux.tar.gz"
KERNEL="$DIR/resources/kernel/SiYuan-Kernel"
URL="https://github.com/siyuan-note/siyuan/releases/download/v${VER}/siyuan-${VER}-linux.tar.gz"

mkdir -p "$RUNTIME"

if [ -x "$KERNEL" ]; then
  echo "[provision] v$VER already provisioned: $KERNEL"
  exit 0
fi

if [ ! -f "$TARBALL" ]; then
  echo "[provision] downloading $URL"
  curl -fL --retry 3 -o "$TARBALL.part" "$URL"
  mv "$TARBALL.part" "$TARBALL"
fi

echo "[provision] extracting -> $DIR"
tar xzf "$TARBALL" -C "$RUNTIME"

if [ ! -x "$KERNEL" ]; then
  echo "[provision] FAILED: $KERNEL missing after extract" >&2
  exit 1
fi
echo "[provision] OK  v$VER  ->  $KERNEL"
