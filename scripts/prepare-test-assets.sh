#!/usr/bin/env bash
# Menyiapkan fixture eksternal untuk Tahap 5-6 dari proyek rigPro (tidak didistribusikan).
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-../humanoid-studio/public/models/XBot.glb}"
if [ ! -f "$SRC" ]; then
  echo "XBot.glb tidak ditemukan di $SRC" >&2
  exit 1
fi
cp "$SRC" test-assets/XBot.glb
echo "XBot.glb disalin ($(stat -c%s test-assets/XBot.glb) byte)."
mkdir -p test-assets/external
for file in ../humanoid-studio/tests/fixtures/*.glb ../humanoid-studio/tests/fixtures/*.fbx ../humanoid-studio/tests/fixtures/*.vrm ../humanoid-studio/public/models/*.fbx ../humanoid-studio/public/models/*.vrm ../humanoid-studio/buns.vrm; do
  if [ -f "$file" ]; then
    cp "$file" test-assets/external/"$(basename "$file")"
  fi
done
echo "Fixtures eksternal disalin ($(ls -1 test-assets/external/ | wc -l) berkas di test-assets/external/)."
