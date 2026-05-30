#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
AGE_GROUP="${AGE_GROUP:-50+}"
SEED="${SEED:-1}"
OUT_DIR="${OUT_DIR:-/tmp/oba-elevenlabs-demo}"

mkdir -p "$OUT_DIR"

echo "== health =="
curl -s "$BASE_URL/health" | python -m json.tool

echo "== generate Korean sample =="
curl -s -X POST "$BASE_URL/demo/random-age-voice/audio" \
  -H 'content-type: application/json' \
  -d "{\"age_group\":\"$AGE_GROUP\",\"language\":\"ko\",\"seed\":$SEED}" \
  -o "$OUT_DIR/${AGE_GROUP}_ko.mp3"
file "$OUT_DIR/${AGE_GROUP}_ko.mp3"

echo "== analyze Korean sample =="
curl -s -F "file=@$OUT_DIR/${AGE_GROUP}_ko.mp3" "$BASE_URL/analyze" | tee "$OUT_DIR/${AGE_GROUP}_ko.analyze.json"
echo

echo "== generate English sample =="
curl -s -X POST "$BASE_URL/demo/random-age-voice/audio" \
  -H 'content-type: application/json' \
  -d "{\"age_group\":\"$AGE_GROUP\",\"language\":\"en\",\"seed\":$SEED,\"text\":\"Latte, please.\"}" \
  -o "$OUT_DIR/${AGE_GROUP}_en.mp3"
file "$OUT_DIR/${AGE_GROUP}_en.mp3"

echo "== analyze English sample =="
curl -s -F "file=@$OUT_DIR/${AGE_GROUP}_en.mp3" "$BASE_URL/analyze" | tee "$OUT_DIR/${AGE_GROUP}_en.analyze.json"
echo

echo "Wrote files to $OUT_DIR"
