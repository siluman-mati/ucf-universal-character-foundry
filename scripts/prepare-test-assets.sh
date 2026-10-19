#!/usr/bin/env bash
# Menyiapkan fixture uji XBot.glb dari proyek rigPro (tidak didistribusikan).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-../humanoid-studio/public/models/XBot.glb}"
if [ ! -f "$SRC" ]; then
  echo "XBot.glb tidak ditemukan di $SRC" >&2
  exit 1
fi
cp "$SRC" test-assets/XBot.glb
echo "XBot.glb disalin ($(stat -c%s test-assets/XBot.glb) byte)."
