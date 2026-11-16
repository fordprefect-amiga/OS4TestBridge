#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMIT="$ROOT/host/os4tb_submit.sh"
VALIDATOR="$ROOT/build/host/os4tb_validate"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

mkdir -p "$TMP_ROOT/share/incoming" "$TMP_ROOT/share/results" "$TMP_ROOT/share/logs" "$TMP_ROOT/share/processed"
mkdir -p "$ROOT/build/host"
cc -std=c11 -Wall -Wextra -Werror "$ROOT/host/os4tb_validate.c" -o "$VALIDATOR"

case_pass=0
case_fail=0

pass_case() { case_pass=$((case_pass + 1)); }
fail_case() { case_fail=$((case_fail + 1)); echo "CASE_FAIL=$1"; }

# 1. valid request submission
if OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$ROOT/protocol/requests/request_phase3a_001.req" >/tmp/os4tb_case1.out 2>/tmp/os4tb_case1.err &&
   grep -q '^OS4TB_SUBMIT=PASS$' /tmp/os4tb_case1.out; then
  pass_case
else
  fail_case valid_request_submission
fi

# 2. malformed request rejected
cat >"$TMP_ROOT/bad.req" <<'EOF'
protocol_version=1
request_id=bad001
operationRUN_BINARY
payload_name=os4tb_phase3a_payload
expected_artifact_name=bad.artifact
EOF
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$TMP_ROOT/bad.req" >/tmp/os4tb_case2.out 2>/tmp/os4tb_case2.err; then
  pass_case
else
  fail_case malformed_request_rejected
fi

# 3. duplicate request_id/file collision rejected
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$ROOT/protocol/requests/request_phase3a_001.req" >/tmp/os4tb_case3.out 2>/tmp/os4tb_case3.err; then
  pass_case
else
  fail_case duplicate_collision_rejected
fi

# 4. incomplete temporary file is not treated as ready
cp "$ROOT/protocol/requests/request_phase3a_001.req" "$TMP_ROOT/share/incoming/request_phase3a_tmp.req.tmp.999"
cat >"$TMP_ROOT/req4.req" <<'EOF'
protocol_version=1
request_id=phase3a_004
operation=RUN_BINARY
payload_name=os4tb_phase3a_payload
expected_artifact_name=phase3a_004.artifact
EOF
if OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$TMP_ROOT/req4.req" >/tmp/os4tb_case4.out 2>/tmp/os4tb_case4.err &&
   test -f "$TMP_ROOT/share/incoming/request_phase3a_004.req"; then
  pass_case
else
  fail_case temp_file_not_ready
fi

# 5. basename/path traversal rejection remains intact
cat >"$TMP_ROOT/req5.req" <<'EOF'
protocol_version=1
request_id=phase3a_005
operation=RUN_BINARY
payload_name=../escape
expected_artifact_name=phase3a_005.artifact
EOF
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$TMP_ROOT/req5.req" >/tmp/os4tb_case5.out 2>/tmp/os4tb_case5.err; then
  pass_case
else
  fail_case traversal_rejected
fi

# 6. no arbitrary shell fields accepted
cat >"$TMP_ROOT/req6.req" <<'EOF'
protocol_version=1
request_id=phase3a_006
operation=RUN_BINARY
payload_name=os4tb_phase3a_payload
expected_artifact_name=phase3a_006.artifact
command=uname -a
EOF
if ! OS4TB_SHARE_ROOT="$TMP_ROOT/share" "$SUBMIT" "$TMP_ROOT/req6.req" >/tmp/os4tb_case6.out 2>/tmp/os4tb_case6.err; then
  pass_case
else
  fail_case shell_field_rejected
fi

# 7. existing protocol v1 suite still passes
if "$ROOT/tests/run_protocol_v1_tests.sh" >/tmp/os4tb_case7.out 2>/tmp/os4tb_case7.err &&
   grep -q '^OS4TB_PROTOCOL_V1_TOTAL_FAIL=0$' /tmp/os4tb_case7.out; then
  pass_case
else
  fail_case protocol_v1_regression
fi

# 8. existing phase2 regression still passes (phase2 bundle build)
if "$ROOT/tests/build_phase2_os4_bundle.sh" >/tmp/os4tb_case8.out 2>/tmp/os4tb_case8.err; then
  pass_case
else
  fail_case phase2_build_regression
fi

echo "OS4TB_PHASE3A_HOST_TEST_TOTAL=8"
echo "OS4TB_PHASE3A_HOST_TEST_PASS=$case_pass"
echo "OS4TB_PHASE3A_HOST_TEST_FAIL=$case_fail"

if [[ $case_fail -ne 0 ]]; then
  exit 1
fi
