#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/host/os4tb"
RUNNER="$ROOT/host/os4tb_run.sh"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

chmod +x "$CLI" "$RUNNER"

case_pass=0
case_fail=0
pass_case() { case_pass=$((case_pass + 1)); }
fail_case() { case_fail=$((case_fail + 1)); echo "CASE_FAIL=$1"; }

share="$TMP_ROOT/share"
mkdir -p "$share/incoming" "$share/results" "$share/logs" "$share/processed"
cfg="$TMP_ROOT/cli.conf"
cat >"$cfg" <<EOF
target_name=cli-target
share_root=$share
default_timeout_seconds=30
EOF

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

# 1 os4tb version
if "$CLI" version >"$TMP_ROOT/c1.out" 2>&1 &&
   grep -q '^OS4TB_TOOL_VERSION=0.1.0$' "$TMP_ROOT/c1.out" &&
   grep -q '^OS4TB_PROTOCOL_VERSION=1$' "$TMP_ROOT/c1.out"; then pass_case; else fail_case version; fi

# 2 os4tb check success
if "$CLI" --config "$cfg" check >"$TMP_ROOT/c2.out" 2>&1 &&
   grep -q '^HOST_CONFIGURATION=PASS$' "$TMP_ROOT/c2.out"; then pass_case; else fail_case check_success; fi

# 3 os4tb check failure
cfg_bad="$TMP_ROOT/cli_bad.conf"
cat >"$cfg_bad" <<EOF
target_name=bad
share_root=$TMP_ROOT/missing
default_timeout_seconds=30
EOF
if ! "$CLI" --config "$cfg_bad" check >"$TMP_ROOT/c3.out" 2>&1 &&
   grep -q '^HOST_CONFIGURATION=FAIL$' "$TMP_ROOT/c3.out"; then pass_case; else fail_case check_failure; fi

# helper request builder
mk_req() {
  local p="$1" id="$2" payload="$3" artifact="$4"
  cat >"$p" <<EOF
protocol_version=1
request_id=$id
operation=RUN_BINARY
payload_name=$payload
expected_artifact_name=$artifact
EOF
}

# 4 run positive mocked path
req4="$TMP_ROOT/request_cli004.req"; mk_req "$req4" "cli004" "os4tb_phase3a_payload" "cli004.artifact"
(
  sleep 1
  printf "ok\n" >"$share/results/cli004.artifact"
  cat >"$share/results/result_cli004.res" <<'EOF'
protocol_version=1
request_id=cli004
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=cli004.artifact
log_name=log_cli004.txt
detail=ok
EOF
) &
if OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run "$req4" >"$TMP_ROOT/c4.out" 2>&1 &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c4.out"; then pass_case; else fail_case run_positive; fi
# Case A: config default timeout applied when no override is supplied
if grep -q '^OS4TB_RUN_TIMEOUT_SECONDS=30$' "$TMP_ROOT/c4.out"; then pass_case; else fail_case default_timeout_applied; fi

# 5 run negative mocked path
req5="$TMP_ROOT/request_cli005.req"; mk_req "$req5" "cli005" "os4tb_phase3a_payload" "cli005.artifact"
(
  sleep 1
  cat >"$share/results/result_cli005.res" <<'EOF'
protocol_version=1
request_id=cli005
operation=RUN_BINARY
transport_status=ok
execution_status=child_failed
exit_code=2
artifact_status=not_required
log_name=log_cli005.txt
detail=child_failed
EOF
) &
if ! OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run "$req5" >"$TMP_ROOT/c5.out" 2>&1 &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=result_validation_failed$' "$TMP_ROOT/c5.out"; then pass_case; else fail_case run_negative; fi

# 6 target token presence
if grep -q '^OS4TB_TARGET_NAME=cli-target$' "$TMP_ROOT/c4.out"; then pass_case; else fail_case target_token; fi

# 7 config path token presence
if grep -q "^OS4TB_CONFIG_PATH=$cfg$" "$TMP_ROOT/c4.out"; then pass_case; else fail_case config_path_token; fi

# 8 exit-code preservation and timeout taxonomy (timeout should be 3)
req8="$TMP_ROOT/request_cli008.req"; mk_req "$req8" "cli008" "os4tb_phase3a_payload" "cli008.artifact"
rc=0
OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout 2 "$req8" >"$TMP_ROOT/c8.out" 2>&1 || rc=$?
if [[ "$rc" -eq 3 ]] &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=timeout_waiting_for_result$' "$TMP_ROOT/c8.out"; then
  pass_case
else
  fail_case exit_code_preservation
fi

# 9 Case B: explicit override timeout is applied
req9="$TMP_ROOT/request_cli009.req"; mk_req "$req9" "cli009" "os4tb_phase3a_payload" "cli009.artifact"
(
  sleep 1
  printf "ok\n" >"$share/results/cli009.artifact"
  cat >"$share/results/result_cli009.res" <<'EOF'
protocol_version=1
request_id=cli009
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=cli009.artifact
log_name=log_cli009.txt
detail=ok
EOF
) &
if (cd /tmp && OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout 120 "$req9" >"$TMP_ROOT/c9.out" 2>&1) &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c9.out" &&
   grep -q '^OS4TB_RUN_TIMEOUT_SECONDS=120$' "$TMP_ROOT/c9.out"; then
  pass_case
else
  fail_case override_timeout_applied
fi

# 10 Case C + cwd independence: override does not persist into subsequent default run
req10="$TMP_ROOT/request_cli010.req"; mk_req "$req10" "cli010" "os4tb_phase3a_payload" "cli010.artifact"
(
  sleep 1
  printf "ok\n" >"$share/results/cli010.artifact"
  cat >"$share/results/result_cli010.res" <<'EOF'
protocol_version=1
request_id=cli010
operation=RUN_BINARY
transport_status=ok
execution_status=success
exit_code=0
artifact_status=present
artifact_name=cli010.artifact
log_name=log_cli010.txt
detail=ok
EOF
) &
if (cd /tmp && OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run "$req10" >"$TMP_ROOT/c10.out" 2>&1) &&
   grep -q '^OS4TB_RUN_FINAL=PASS$' "$TMP_ROOT/c10.out" &&
   grep -q '^OS4TB_RUN_TIMEOUT_SECONDS=30$' "$TMP_ROOT/c10.out"; then
  pass_case
else
  fail_case override_not_persistent
fi

# 11 Case D: invalid zero timeout value rejected with stable taxonomy
req11="$TMP_ROOT/request_cli011.req"; mk_req "$req11" "cli011" "os4tb_phase3a_payload" "cli011.artifact"
rc=0
OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout 0 "$req11" >"$TMP_ROOT/c11.out" 2>&1 || rc=$?
if [[ "$rc" -eq 6 ]] &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=invalid_timeout$' "$TMP_ROOT/c11.out"; then
  pass_case
else
  fail_case invalid_timeout_zero_rejected
fi

# 12 Case E: invalid negative timeout is rejected
req12="$TMP_ROOT/request_cli012.req"; mk_req "$req12" "cli012" "os4tb_phase3a_payload" "cli012.artifact"
rc=0
OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout -1 "$req12" >"$TMP_ROOT/c12.out" 2>&1 || rc=$?
if [[ "$rc" -eq 6 ]] &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=invalid_timeout$' "$TMP_ROOT/c12.out"; then
  pass_case
else
  fail_case invalid_timeout_negative_rejected
fi

# 13 Case F: invalid non-numeric timeout is rejected
req13="$TMP_ROOT/request_cli013.req"; mk_req "$req13" "cli013" "os4tb_phase3a_payload" "cli013.artifact"
rc=0
OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout abc "$req13" >"$TMP_ROOT/c13.out" 2>&1 || rc=$?
if [[ "$rc" -eq 6 ]] &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=invalid_timeout$' "$TMP_ROOT/c13.out"; then
  pass_case
else
  fail_case invalid_timeout_nonnumeric_rejected
fi

# 14 Case G: injection-shaped timeout is rejected and never executed
req14="$TMP_ROOT/request_cli014.req"; mk_req "$req14" "cli014" "os4tb_phase3a_payload" "cli014.artifact"
sentinel="$TMP_ROOT/injection_executed"
rm -f "$sentinel"
rc=0
OS4TB_RUN_SUBMIT_CMD="$TMP_ROOT/fake_submit_pass.sh" "$CLI" --config "$cfg" run --timeout '120;touch '"$sentinel" "$req14" >"$TMP_ROOT/c14.out" 2>&1 || rc=$?
if [[ "$rc" -eq 6 ]] &&
   grep -q '^OS4TB_RUN_FAILURE_REASON=invalid_timeout$' "$TMP_ROOT/c14.out" &&
   [[ ! -e "$sentinel" ]]; then
  pass_case
else
  fail_case invalid_timeout_injection_rejected
fi

echo "OS4TB_PHASE5_CLI_TEST_TOTAL=15"
echo "OS4TB_PHASE5_CLI_TEST_PASS=$case_pass"
echo "OS4TB_PHASE5_CLI_TEST_FAIL=$case_fail"
if [[ "$case_fail" -ne 0 ]]; then exit 1; fi
