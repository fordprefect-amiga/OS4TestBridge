#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: $0 [--timeout <seconds>] <request-file>" >&2
}

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHARE_ROOT="${OS4TB_SHARE_ROOT:-}"
VALIDATOR="$ROOT/build/host/os4tb_validate"
SUBMIT_CMD="${OS4TB_RUN_SUBMIT_CMD:-$ROOT/host/os4tb_submit.sh}"
REQUEST_FILE=""
TIMEOUT_SEC=30
POLL_INTERVAL_SEC="${OS4TB_RUN_POLL_INTERVAL_SEC:-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --timeout)
      shift
      [[ $# -gt 0 ]] || { usage; exit 6; }
      TIMEOUT_SEC="$1"
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$REQUEST_FILE" ]]; then
        usage
        exit 6
      fi
      REQUEST_FILE="$1"
      ;;
  esac
  shift
done

if [[ -z "$REQUEST_FILE" ]]; then
  usage
  exit 6
fi

if ! [[ "$TIMEOUT_SEC" =~ ^[0-9]+$ ]] || [[ "$TIMEOUT_SEC" -lt 1 ]]; then
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=invalid_timeout"
  exit 6
fi

if ! [[ "$POLL_INTERVAL_SEC" =~ ^[0-9]+$ ]] || [[ "$POLL_INTERVAL_SEC" -lt 1 ]]; then
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=invalid_poll_interval"
  exit 6
fi

if [[ -z "$SHARE_ROOT" ]]; then
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=share_root_unset"
  exit 6
fi

if [[ ! -x "$VALIDATOR" ]]; then
  cc -std=c11 -Wall -Wextra -Werror "$ROOT/host/os4tb_validate.c" -o "$VALIDATOR"
fi

if ! "$VALIDATOR" --check-request "$REQUEST_FILE" >/tmp/os4tb_run_reqcheck.out 2>/tmp/os4tb_run_reqcheck.err; then
  echo "OS4TB_RUN_REQUEST_VALIDATE=FAIL"
  cat /tmp/os4tb_run_reqcheck.out
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=request_invalid"
  rm -f /tmp/os4tb_run_reqcheck.out /tmp/os4tb_run_reqcheck.err
  exit 1
fi
rm -f /tmp/os4tb_run_reqcheck.out /tmp/os4tb_run_reqcheck.err

request_id="$(awk -F= '$1=="request_id"{print $2; exit}' "$REQUEST_FILE")"
operation="$(awk -F= '$1=="operation"{print $2; exit}' "$REQUEST_FILE")"
artifact_name="$(awk -F= '$1=="expected_artifact_name"{print $2; exit}' "$REQUEST_FILE")"

if [[ -z "${request_id:-}" || -z "${operation:-}" || -z "${artifact_name:-}" ]]; then
  echo "OS4TB_RUN_REQUEST_VALIDATE=FAIL"
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=request_metadata_missing"
  exit 6
fi

incoming="$SHARE_ROOT/incoming"
results="$SHARE_ROOT/results"
logs="$SHARE_ROOT/logs"
processed="$SHARE_ROOT/processed"
ready_path="$incoming/request_${request_id}.req"
claimed_path="$incoming/claimed_${request_id}.req"
result_path="$results/result_${request_id}.res"
artifact_path="$results/$artifact_name"
log_path="$logs/log_${request_id}.txt"
processed_done="$processed/request_${request_id}.req.done"
processed_rejected="$processed/request_${request_id}.req.rejected"

echo "OS4TB_RUN_REQUEST_ID=$request_id"
echo "OS4TB_RUN_OPERATION=$operation"
echo "OS4TB_RUN_TIMEOUT_SECONDS=$TIMEOUT_SEC"
echo "OS4TB_LOG_PATH=$log_path"
echo "OS4TB_ARTIFACT_PATH=$artifact_path"

if [[ -e "$processed_done" || -e "$processed_rejected" ]]; then
  echo "OS4TB_RUN_STALE_GUARD=FAIL"
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=duplicate_or_processed_request_id"
  exit 2
fi

if [[ -e "$ready_path" || -e "$claimed_path" || -e "$result_path" || -e "$artifact_path" || -e "$log_path" ]]; then
  echo "OS4TB_RUN_STALE_GUARD=FAIL"
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=stale_or_colliding_state"
  exit 2
fi
echo "OS4TB_RUN_STALE_GUARD=PASS"

if ! OS4TB_SHARE_ROOT="$SHARE_ROOT" "$SUBMIT_CMD" "$REQUEST_FILE" >/tmp/os4tb_run_submit.out 2>/tmp/os4tb_run_submit.err; then
  echo "OS4TB_RUN_SUBMIT=FAIL"
  cat /tmp/os4tb_run_submit.out
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=submit_failed"
  rm -f /tmp/os4tb_run_submit.out /tmp/os4tb_run_submit.err
  exit 2
fi
rm -f /tmp/os4tb_run_submit.err
echo "OS4TB_RUN_SUBMIT=PASS"

deadline=$(( $(date +%s) + TIMEOUT_SEC ))
while [[ "$(date +%s)" -le "$deadline" ]]; do
  if [[ -f "$result_path" ]]; then
    break
  fi
  sleep "$POLL_INTERVAL_SEC"
done

if [[ ! -f "$result_path" ]]; then
  echo "OS4TB_RUN_TIMEOUT=FAIL"
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=timeout_waiting_for_result"
  exit 3
fi
echo "OS4TB_RUN_RESULT_WAIT=PASS"

set +e
validator_output="$("$VALIDATOR" "$REQUEST_FILE" "$result_path" 2>&1)"
validator_rc=$?
set -e

if [[ "$validator_rc" -ne 0 ]]; then
  echo "$validator_output"
  if grep -q '^OS4TB_REQUEST_PARSE=FAIL$' <<<"$validator_output" ||
     grep -q '^OS4TB_RESULT_PARSE=FAIL$' <<<"$validator_output" ||
     grep -q '^OS4TB_CORRELATION=FAIL$' <<<"$validator_output" ||
     grep -q '^OS4TB_EXECUTION=FAIL$' <<<"$validator_output"; then
    echo "OS4TB_RUN_RESULT=FAIL"
    echo "OS4TB_RUN_ARTIFACT=FAIL"
    echo "OS4TB_RUN_FINAL=FAIL"
    echo "OS4TB_RUN_FAILURE_REASON=result_validation_failed"
    exit 4
  fi
  if grep -q '^OS4TB_ARTIFACT=FAIL$' <<<"$validator_output"; then
    echo "OS4TB_RUN_RESULT=FAIL"
    echo "OS4TB_RUN_ARTIFACT=FAIL"
    echo "OS4TB_RUN_FINAL=FAIL"
    echo "OS4TB_RUN_FAILURE_REASON=artifact_postcondition_failed"
    exit 5
  fi
  echo "OS4TB_RUN_RESULT=FAIL"
  echo "OS4TB_RUN_FINAL=FAIL"
  echo "OS4TB_RUN_FAILURE_REASON=result_validation_failed"
  exit 4
fi

echo "$validator_output"
echo "OS4TB_RUN_RESULT=PASS"
echo "OS4TB_RUN_ARTIFACT=PASS"
echo "OS4TB_RUN_FINAL=PASS"
exit 0
