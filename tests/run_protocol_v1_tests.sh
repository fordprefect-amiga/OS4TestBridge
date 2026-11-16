#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT/build/host"
FIXTURES_DIR="$ROOT/tests/fixtures/protocol_v1"
VALIDATOR="${VALIDATOR:-$BUILD_DIR/os4tb_validate}"

mkdir -p "$BUILD_DIR"

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  cc -std=c11 -Wall -Wextra -Werror \
    "$ROOT/host/os4tb_validate.c" \
    -o "$VALIDATOR"
fi

cases=(
  "case01_valid_success|request_test001.req|result_test001.res|0|none"
  "case02_valid_child_failure|request_test002.req|result_test002.res|1|execution_not_success"
  "case03_launch_failure|request_test003.req|result_test003.res|1|execution_not_success"
  "case04_missing_artifact|request_test004.req|result_test004.res|1|artifact_not_present"
  "case05_malformed_line|request_test005.req|result_test005.res|1|malformed_line"
  "case06_duplicate_key|request_test006.req|result_test006.res|1|duplicate_key"
  "case07_unknown_key|request_test007.req|result_test007.res|1|unknown_key"
  "case08_missing_required_key|request_test008.req|result_test008.res|1|missing_required_key"
  "case09_mismatched_request_id|request_test009.req|result_test009.res|1|request_id_mismatch"
  "case10_mismatched_operation|request_test010.req|result_test010.res|1|operation_mismatch"
  "case11_unsafe_payload_filename|request_test011.req|result_test011.res|1|unsafe_filename"
  "case12_unsafe_artifact_filename|request_test012.req|result_test012.res|1|unsafe_filename"
  "case13_oversized_value_or_line|request_test013.req|result_test013.res|1|line_too_long"
  "case14_wrong_result_filename|request_test014.req|stale_test014.res|1|result_filename_mismatch"
  "case15_exit_zero_artifact_missing|request_test015.req|result_test015.res|1|artifact_not_present"
  "case16_execution_success_artifact_present|request_test016.req|result_test016.res|0|none"
  "case17_archived_result_pair|request.req|result.res|0|none"
  "case18_wrong_request_filename|unrelated.req|result_test018.res|1|request_filename_mismatch"
  "case19_malformed_request_filename|request..req|result_test019.res|1|request_filename_mismatch"
)

case_pass=0
case_fail=0

for c in "${cases[@]}"; do
  IFS='|' read -r case_name req_file res_file expected_exit expected_reason <<<"$c"
  req_path="$FIXTURES_DIR/$case_name/$req_file"
  res_path="$FIXTURES_DIR/$case_name/$res_file"

  set +e
  output="$("$VALIDATOR" "$req_path" "$res_path" 2>&1)"
  rc=$?
  set -e

  matched=1
  if [[ "$rc" -ne "$expected_exit" ]]; then
    matched=0
  fi
  if [[ "$expected_exit" -eq 0 ]]; then
    grep -q '^OS4TB_FINAL=PASS$' <<<"$output" || matched=0
  else
    grep -q '^OS4TB_FINAL=FAIL$' <<<"$output" || matched=0
    grep -q "^OS4TB_FAILURE_REASON=${expected_reason}$" <<<"$output" || matched=0
  fi

  if [[ "$matched" -eq 1 ]]; then
    case_pass=$((case_pass + 1))
  else
    case_fail=$((case_fail + 1))
    echo "CASE_MISMATCH=$case_name"
    echo "$output"
  fi
done

total_fail="$case_fail"
echo "OS4TB_PROTOCOL_V1_CASE_PASS=$case_pass"
echo "OS4TB_PROTOCOL_V1_CASE_FAIL=$case_fail"
echo "OS4TB_PROTOCOL_V1_TOTAL_FAIL=$total_fail"

if [[ "$total_fail" -ne 0 ]]; then
  exit 1
fi
