#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <request-file>" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REQ_SRC="$1"
SHARE_ROOT="${OS4TB_SHARE_ROOT:-}"
INCOMING="$SHARE_ROOT/incoming"
PROCESSED="$SHARE_ROOT/processed"
VALIDATOR="$ROOT/build/host/os4tb_validate"

if [[ ! -f "$REQ_SRC" ]]; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=request_file_missing"
  exit 1
fi

if [[ -z "$SHARE_ROOT" ]]; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=share_root_unset"
  exit 1
fi

if [[ ! -x "$VALIDATOR" ]]; then
  cc -std=c11 -Wall -Wextra -Werror "$ROOT/host/os4tb_validate.c" -o "$VALIDATOR"
fi

if ! "$VALIDATOR" --check-request "$REQ_SRC" >/tmp/os4tb_submit_validate.out 2>/tmp/os4tb_submit_validate.err; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=request_invalid"
  cat /tmp/os4tb_submit_validate.out
  rm -f /tmp/os4tb_submit_validate.out /tmp/os4tb_submit_validate.err
  exit 1
fi
rm -f /tmp/os4tb_submit_validate.out /tmp/os4tb_submit_validate.err

request_id="$(awk -F= '$1=="request_id"{print $2; exit}' "$REQ_SRC")"
if [[ -z "${request_id:-}" ]]; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=request_id_missing"
  exit 1
fi

mkdir -p "$INCOMING" "$PROCESSED"
dest="$INCOMING/request_${request_id}.req"
tmp="$INCOMING/request_${request_id}.req.tmp.$$"

if [[ -e "$dest" ]]; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=collision_ready_exists"
  exit 1
fi

if compgen -G "$PROCESSED/request_${request_id}.req*" >/dev/null; then
  echo "OS4TB_SUBMIT=FAIL"
  echo "OS4TB_FAILURE_REASON=duplicate_processed_exists"
  exit 1
fi

cp "$REQ_SRC" "$tmp"
mv "$tmp" "$dest"

echo "OS4TB_SUBMIT=PASS"
echo "OS4TB_REQUEST_ID=$request_id"
echo "OS4TB_DEST_PATH=$dest"
