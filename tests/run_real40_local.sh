#!/usr/bin/env bash
# Run the *actual* 40-design source sheet through the browser app locally.
# Usage: bash tests/run_real40_local.sh original-40-sheet.png [output-directory]
# Requires Node 22, Playwright Chromium, Python Pillow and OpenCV.
set -euo pipefail
if [[ $# -lt 1 || ! -f "$1" ]]; then
  echo "Usage: bash tests/run_real40_local.sh original-40-sheet.png [output-directory]" >&2
  exit 2
fi
source_image="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
out="${2:-/tmp/stamp-real40-evidence}"
mkdir -p "$out"
python3 tests/check_distinct_40_sheet.py "$source_image"
port="${STAMP_TEST_PORT:-4174}"
python3 -m http.server "$port" --bind 127.0.0.1 >"$out/http.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    echo "FAIL: local HTTP server exited; see $out/http.log" >&2
    exit 1
  fi
  if (echo > /dev/tcp/127.0.0.1/"$port") 2>/dev/null; then break; fi
  sleep .25
done
if ! kill -0 "$server_pid" 2>/dev/null; then
  echo "FAIL: local HTTP server did not stay running; see $out/http.log" >&2
  exit 1
fi
STAMP_TEST_URL="http://127.0.0.1:$port" \
STAMP_TEST_IMAGE="$source_image" \
STAMP_TEST_ARTIFACTS="$out" \
STAMP_REQUIRE_DISTINCT_OUTPUT=1 \
node tests/single-sheet-40-browser.cjs
python3 tests/verify_40_zip.py "$out/40.zip" "$out/expected.json"
python3 tests/audit_real40_mapping.py "$source_image" "$out/40.zip" >"$out/source-mapping.csv"
echo "PASS: real 40-sheet browser/ZIP technical regression; manually inspect $out/iphone40-editor.png and all ZIP stickers."
echo "NOTE: Chromium iPhone emulation is NOT physical iPhone Safari."
