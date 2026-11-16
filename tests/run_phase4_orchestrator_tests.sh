#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNNER="$ROOT/host/os4tb_run.sh"
VALIDATOR="$ROOT/build/host/os4tb_validate"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/share/incoming" "$TMP_ROOT/share/results" "$TMP_ROOT/share/logs" "$TMP_ROOT/share/processed"
mkdir -p "$ROOT/build/host"
cc -std=c11 -Wall -Wextra -Werror "$ROOT/host/os4tb_validate.c" -o "$VALIDATOR"
chmod +x "$RUNNER"

case_pass=0
case_fail=0

pass_case() { case_pass=$((case_pass + 1)); }
fail_case() { case_fail=$((case_fail + 1)); echo "CASE_FAIL=$1"; }

mk_req() {
  local req_path="$1" req_id="$2" payload="$3" artifact="$4"
  cat >"$req_path" <<EOF
protocol_version=1
request_id=$req_id
operation=RUN_BINARY
payload_name=$payload
expected_artifact_name=$artifact
EOF
}

cat >"$TMP_ROOT/fake_submit_pass.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
req_file="$1"
share="$OS4TB_SHARE_ROOT"
request_id="$(awk -F= '$1=="request_id"{print $2; exit}' "$req_file")"
cp "$req_file" "$share/incoming/request_${request_id}.req"
echo "OS4TB_SUBMIT=PASS"
echo "OS4TB_REQUEST_ID=$request_id"
EOF
chmod +x "$TMP_ROOT/fake_submit_pass.sh"

cat >"$TMP_ROOT/fake_submit_fail.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
echo "OS4TB_SUBMIT=FAIL"
echo "OS4TB_FAILURE_REASON=submit_simulated_failure"
exit 1
EOF
chmod +x "$TMP_ROOT/fake_submit_fail.sh"

writer_success() {
  local req_id="$1" artifact="$2" delay="$3"
  local share="$TMP_ROOT/share"
  (
    sleep "$delay"
    printf "ok\n" >"$share/results/$artifact"
    cat >"$share/results/result_${req_id}.res" <<EOF
protocol_version=1
request_id=$req_id
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=$artifact
log_name=log_${req_id}.txt
detail=ok
EOF
  ) &
}

writer_child_failed() {
  local req_id="$1" delay="$2"
  local share="$TMP_ROOT/share"
  (
    sleep "$delay"
    cat >"$share/results/result_${req_id}.res" <<EOF
protocol_version=1
request_id=$req_id
operation=RUN_BINARY
transport_status=ok
execution_status=child_failed
exit_code=2
artifact_status=not_required
log_name=log_${req_id}.txt
detail=child_failed
EOF
  ) &
}

writer_child_failed_artifact_missing() {
  local req_id="$1" artifact="$2" delay="$3"
  local share="$TMP_ROOT/share"
  (
    sleep "$delay"
    cat >"$share/results/result_${req_id}.res" <<EOF
protocol_version=1
request_id=$req_id
operation=RUN_BINARY
transport_status=ok
execution_status=child_failed
exit_code=2
artifact_status=present
artifact_name=$artifact
log_name=log_${req_id}.txt
detail=child_failed
EOF
  ) &
}

writer_malformed_result() {
  local req_id="$1" delay="$2"
  local share="$TMP_ROOT/share"
  (
    sleep "$delay"
    echo "not_a_valid_result_line" >"$share/results/result_${req_id}.res"
  ) &
}

# 1) valid orchestration (simulated result arrival)
req1="$TMP_ROOT/request_phase4t001.req"; mk_req "$req1" "phase4t001" "os4tb_phase3a_payload" "phase4t001.artifact"
writer_success "phase4t001" "phase4t001.artifact" 1
if OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req1" >"$TMP_ROOT/c1.out" 2>&1 &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c1.out"; then
  pass_case
else
  fail_case valid_orchestration
fi

# 2) malformed request rejected
req2="$TMP_ROOT/request_phase4t002.req"
cat >"$req2" <<'EOF'
protocol_version=1
request_id=phase4t002
operationRUN_BINARY
payload_name=os4tb_phase3a_payload
expected_artifact_name=phase4t002.artifact
EOF
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req2" >"$TMP_ROOT/c2.out" 2>&1; then
  pass_case
else
  fail_case malformed_request
fi

# 3) stale processed request rejected
req3="$TMP_ROOT/request_phase4t003.req"; mk_req "$req3" "phase4t003" "os4tb_phase3a_payload" "phase4t003.artifact"
touch "$TMP_ROOT/share/processed/request_phase4t003.req.done"
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req3" >"$TMP_ROOT/c3.out" 2>&1 &&
   grep -q 'OS4TB_RUN_STALE_GUARD=FAIL' "$TMP_ROOT/c3.out"; then
  pass_case
else
  fail_case stale_processed
fi

# 4) stale result rejected
req4="$TMP_ROOT/request_phase4t004.req"; mk_req "$req4" "phase4t004" "os4tb_phase3a_payload" "phase4t004.artifact"
touch "$TMP_ROOT/share/results/result_phase4t004.res"
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req4" >"$TMP_ROOT/c4.out" 2>&1 &&
   grep -q 'OS4TB_RUN_STALE_GUARD=FAIL' "$TMP_ROOT/c4.out"; then
  pass_case
else
  fail_case stale_result
fi

# 5) timeout behavior
req5="$TMP_ROOT/request_phase4t005.req"; mk_req "$req5" "phase4t005" "os4tb_phase3a_payload" "phase4t005.artifact"
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" --timeout 2 "$req5" >"$TMP_ROOT/c5.out" 2>&1 &&
   grep -q 'OS4TB_RUN_TIMEOUT=FAIL' "$TMP_ROOT/c5.out"; then
  pass_case
else
  fail_case timeout
fi

# 6) mismatched request_id rejected
req6="$TMP_ROOT/request_phase4t006.req"; mk_req "$req6" "phase4t006" "os4tb_phase3a_payload" "phase4t006.artifact"
(
  sleep 1
  printf "ok\n" >"$TMP_ROOT/share/results/phase4t006.artifact"
  cat >"$TMP_ROOT/share/results/result_phase4t006.res" <<'EOF'
protocol_version=1
request_id=phase4t006x
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=phase4t006.artifact
log_name=log_phase4t006.txt
detail=ok
EOF
) &
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req6" >"$TMP_ROOT/c6.out" 2>&1 &&
   grep -q 'OS4TB_RUN_RESULT=FAIL' "$TMP_ROOT/c6.out"; then
  pass_case
else
  fail_case mismatched_request_id
fi

# 7) missing artifact rejected
req7="$TMP_ROOT/request_phase4t007.req"; mk_req "$req7" "phase4t007" "os4tb_phase3a_payload" "phase4t007.artifact"
(
  sleep 1
  cat >"$TMP_ROOT/share/results/result_phase4t007.res" <<'EOF'
protocol_version=1
request_id=phase4t007
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=phase4t007.artifact
log_name=log_phase4t007.txt
detail=ok
EOF
) &
rc=0
OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req7" >"$TMP_ROOT/c7.out" 2>&1 || rc=$?
if [[ "$rc" -eq 5 ]] &&
   grep -q 'OS4TB_EXECUTION=PASS' "$TMP_ROOT/c7.out" &&
   grep -q 'OS4TB_RUN_ARTIFACT=FAIL' "$TMP_ROOT/c7.out" &&
   grep -q 'OS4TB_RUN_FAILURE_REASON=artifact_postcondition_failed' "$TMP_ROOT/c7.out"; then
  pass_case
else
  fail_case missing_artifact
fi

# 8) non-zero guest exit rejected
req8="$TMP_ROOT/request_phase4t008.req"; mk_req "$req8" "phase4t008" "os4tb_phase3a_payload" "phase4t008.artifact"
writer_child_failed "phase4t008" 1
rc=0
OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req8" >"$TMP_ROOT/c8.out" 2>&1 || rc=$?
if [[ "$rc" -eq 4 ]] &&
   grep -q 'OS4TB_EXECUTION=FAIL' "$TMP_ROOT/c8.out" &&
   grep -q 'OS4TB_RUN_RESULT=FAIL' "$TMP_ROOT/c8.out" &&
   grep -q 'OS4TB_RUN_FAILURE_REASON=result_validation_failed' "$TMP_ROOT/c8.out"; then
  pass_case
else
  fail_case child_failed
fi

# 9) execution/result failure precedence over downstream artifact failure
req9="$TMP_ROOT/request_phase4t009.req"; mk_req "$req9" "phase4t009" "os4tb_phase3a_payload" "phase4t009.artifact"
writer_child_failed_artifact_missing "phase4t009" "phase4t009.artifact" 1
rc=0
OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req9" >"$TMP_ROOT/c9.out" 2>&1 || rc=$?
if [[ "$rc" -eq 4 ]] &&
   grep -q 'OS4TB_EXECUTION=FAIL' "$TMP_ROOT/c9.out" &&
   grep -q 'OS4TB_ARTIFACT=FAIL' "$TMP_ROOT/c9.out" &&
   grep -q 'OS4TB_RUN_RESULT=FAIL' "$TMP_ROOT/c9.out" &&
   grep -q 'OS4TB_RUN_ARTIFACT=FAIL' "$TMP_ROOT/c9.out" &&
   grep -q 'OS4TB_RUN_FAILURE_REASON=result_validation_failed' "$TMP_ROOT/c9.out"; then
  pass_case
else
  fail_case precedence_exec_over_artifact
fi

# 10) malformed result rejected
req10="$TMP_ROOT/request_phase4t010.req"; mk_req "$req10" "phase4t010" "os4tb_phase3a_payload" "phase4t010.artifact"
writer_malformed_result "phase4t010" 1
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req10" >"$TMP_ROOT/c10.out" 2>&1 &&
   grep -q 'OS4TB_RUN_RESULT=FAIL' "$TMP_ROOT/c10.out"; then
  pass_case
else
  fail_case malformed_result
fi

# 11) submit failure propagated
req11="$TMP_ROOT/request_phase4t011.req"; mk_req "$req11" "phase4t011" "os4tb_phase3a_payload" "phase4t011.artifact"
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_fail.sh" "$RUNNER" "$req11" >"$TMP_ROOT/c11.out" 2>&1 &&
   grep -q 'OS4TB_RUN_SUBMIT=FAIL' "$TMP_ROOT/c11.out"; then
  pass_case
else
  fail_case submit_failure
fi

# 12) machine-readable PASS output
req12="$TMP_ROOT/request_phase4t012.req"; mk_req "$req12" "phase4t012" "os4tb_phase3a_payload" "phase4t012.artifact"
writer_success "phase4t012" "phase4t012.artifact" 1
if OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req12" >"$TMP_ROOT/c12.out" 2>&1 &&
   grep -q '^OS4TB_RUN_SUBMIT=PASS$' "$TMP_ROOT/c12.out" &&
   grep -q '^OS4TB_RUN_RESULT=PASS$' "$TMP_ROOT/c12.out" &&
   grep -q '^OS4TB_RUN_ARTIFACT=PASS$' "$TMP_ROOT/c12.out" &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c12.out"; then
  pass_case
else
  fail_case machine_readable_pass
fi

# 13) exit-code contract
req13="$TMP_ROOT/request_phase4t013.req"; mk_req "$req13" "phase4t013" "os4tb_phase3a_payload" "phase4t013.artifact"
rc=0
OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" --timeout 2 "$req13" >"$TMP_ROOT/c13.out" 2>&1 || rc=$?
rc="${rc:-0}"
if [[ "$rc" -eq 3 ]]; then
  pass_case
else
  fail_case exit_code_contract
fi

# 14) non-canonical archived request filename validates by protocol identity
req14="$TMP_ROOT/request.req"; mk_req "$req14" "phase4t014" "os4tb_phase3a_payload" "phase4t014.artifact"
writer_success "phase4t014" "phase4t014.artifact" 1
if OS4TB_SHARE_ROOT="$TMP_ROOT/share" OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$RUNNER" "$req14" >"$TMP_ROOT/c14.out" 2>&1 &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c14.out"; then
  pass_case
else
  fail_case archived_request_filename
fi

echo "OS4TB_PHASE4_HOST_TEST_TOTAL=14"
echo "OS4TB_PHASE4_HOST_TEST_PASS=$case_pass"
echo "OS4TB_PHASE4_HOST_TEST_FAIL=$case_fail"

if [[ "$case_fail" -ne 0 ]]; then
  exit 1
fi
