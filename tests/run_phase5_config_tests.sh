#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT/host/os4tb"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

chmod +x "$CLI"

case_pass=0
case_fail=0
pass_case() { case_pass=$((case_pass + 1)); }
fail_case() { case_fail=$((case_fail + 1)); echo "CASE_FAIL=$1"; }

make_share() {
  local p="$1"
  mkdir -p "$p/incoming" "$p/results" "$p/logs" "$p/processed"
}

# 1 valid config
share1="$TMP_ROOT/share1"; make_share "$share1"
cfg1="$TMP_ROOT/cfg1.conf"
cat >"$cfg1" <<EOF
target_name=t1
share_root=$share1
default_timeout_seconds=30
EOF
if "$CLI" --config "$cfg1" check >"$TMP_ROOT/c1.out" 2>&1 && grep -q '^HOST_CONFIGURATION=PASS$' "$TMP_ROOT/c1.out"; then pass_case; else fail_case valid_config; fi

# 2 missing required key
cfg2="$TMP_ROOT/cfg2.conf"
cat >"$cfg2" <<EOF
target_name=t2
share_root=$share1
EOF
if ! "$CLI" --config "$cfg2" check >"$TMP_ROOT/c2.out" 2>&1; then pass_case; else fail_case missing_required_key; fi

# 3 unknown key
cfg3="$TMP_ROOT/cfg3.conf"
cat >"$cfg3" <<EOF
target_name=t3
share_root=$share1
default_timeout_seconds=30
mystery=1
EOF
if ! "$CLI" --config "$cfg3" check >"$TMP_ROOT/c3.out" 2>&1; then pass_case; else fail_case unknown_key; fi

# 4 duplicate key
cfg4="$TMP_ROOT/cfg4.conf"
cat >"$cfg4" <<EOF
target_name=t4
share_root=$share1
default_timeout_seconds=30
target_name=t4b
EOF
if ! "$CLI" --config "$cfg4" check >"$TMP_ROOT/c4.out" 2>&1; then pass_case; else fail_case duplicate_key; fi

# 5 malformed line
cfg5="$TMP_ROOT/cfg5.conf"
cat >"$cfg5" <<EOF
target_name=t5
share_root=$share1
default_timeout_seconds 30
EOF
if ! "$CLI" --config "$cfg5" check >"$TMP_ROOT/c5.out" 2>&1; then pass_case; else fail_case malformed_line; fi

# 6 nonexistent share root
cfg6="$TMP_ROOT/cfg6.conf"
cat >"$cfg6" <<EOF
target_name=t6
share_root=$TMP_ROOT/does_not_exist
default_timeout_seconds=30
EOF
if ! "$CLI" --config "$cfg6" check >"$TMP_ROOT/c6.out" 2>&1 && grep -q '^HOST_CONFIGURATION=FAIL$' "$TMP_ROOT/c6.out"; then pass_case; else fail_case nonexistent_share_root; fi

# 7 non-writable incoming dir
share7="$TMP_ROOT/share7"; make_share "$share7"; chmod a-w "$share7/incoming"
cfg7="$TMP_ROOT/cfg7.conf"
cat >"$cfg7" <<EOF
target_name=t7
share_root=$share7
default_timeout_seconds=30
EOF
if ! "$CLI" --config "$cfg7" check >"$TMP_ROOT/c7.out" 2>&1 && grep -q '^OS4TB_CHECK_INCOMING_RW=FAIL$' "$TMP_ROOT/c7.out"; then pass_case; else fail_case non_writable_incoming; fi
chmod u+w "$share7/incoming"

# 8 explicit --config precedence
share8="$TMP_ROOT/share8"; make_share "$share8"
cfg8_explicit="$TMP_ROOT/cfg8_explicit.conf"
cfg8_env="$TMP_ROOT/cfg8_env.conf"
cat >"$cfg8_explicit" <<EOF
target_name=t8e
share_root=$share8
default_timeout_seconds=30
EOF
cat >"$cfg8_env" <<EOF
target_name=t8bad
share_root=$TMP_ROOT/missing
default_timeout_seconds=30
EOF
if OS4TB_CONFIG="$cfg8_env" "$CLI" --config "$cfg8_explicit" check >"$TMP_ROOT/c8.out" 2>&1 && grep -q '^OS4TB_TARGET_NAME=t8e$' "$TMP_ROOT/c8.out"; then pass_case; else fail_case explicit_precedence; fi

# 9 OS4TB_CONFIG precedence
share9="$TMP_ROOT/share9"; make_share "$share9"
cfg9_env="$TMP_ROOT/cfg9_env.conf"
cat >"$cfg9_env" <<EOF
target_name=t9env
share_root=$share9
default_timeout_seconds=30
EOF
home9="$TMP_ROOT/home9"; mkdir -p "$home9/.config/os4testbridge"
cat >"$home9/.config/os4testbridge/config" <<EOF
target_name=t9user
share_root=$TMP_ROOT/missing
default_timeout_seconds=30
EOF
if HOME="$home9" OS4TB_CONFIG="$cfg9_env" "$CLI" check >"$TMP_ROOT/c9.out" 2>&1 && grep -q '^OS4TB_TARGET_NAME=t9env$' "$TMP_ROOT/c9.out"; then pass_case; else fail_case env_precedence; fi

# 10 default user config lookup
share10="$TMP_ROOT/share10"; make_share "$share10"
home10="$TMP_ROOT/home10"; mkdir -p "$home10/.config/os4testbridge"
cat >"$home10/.config/os4testbridge/config" <<EOF
target_name=t10
share_root=$share10
default_timeout_seconds=30
EOF
if HOME="$home10" "$CLI" check >"$TMP_ROOT/c10.out" 2>&1 && grep -q '^OS4TB_TARGET_NAME=t10$' "$TMP_ROOT/c10.out"; then pass_case; else fail_case user_lookup; fi

# 11 invocation from unrelated cwd
if (cd /tmp && "$CLI" --config "$cfg1" check >"$TMP_ROOT/c11.out" 2>&1) && grep -q '^HOST_CONFIGURATION=PASS$' "$TMP_ROOT/c11.out"; then pass_case; else fail_case unrelated_cwd; fi

# 12 user path containing spaces
share12="$TMP_ROOT/share with spaces"; make_share "$share12"
cfg12="$TMP_ROOT/cfg12.conf"
cat >"$cfg12" <<EOF
target_name=t12
share_root=$share12
default_timeout_seconds=30
EOF
if "$CLI" --config "$cfg12" check >"$TMP_ROOT/c12.out" 2>&1 && grep -q '^HOST_CONFIGURATION=PASS$' "$TMP_ROOT/c12.out"; then pass_case; else fail_case path_with_spaces; fi

# 13 shell metacharacters treated as data
cfg13="$TMP_ROOT/cfg13.conf"
marker="$TMP_ROOT/marker_should_not_exist"
cat >"$cfg13" <<EOF
target_name=t13
share_root=$TMP_ROOT/share13;touch $marker
default_timeout_seconds=30
EOF
if ! "$CLI" --config "$cfg13" check >"$TMP_ROOT/c13.out" 2>&1 && [[ ! -e "$marker" ]]; then pass_case; else fail_case shell_metachar_data; fi

echo "OS4TB_PHASE5_CONFIG_TEST_TOTAL=13"
echo "OS4TB_PHASE5_CONFIG_TEST_PASS=$case_pass"
echo "OS4TB_PHASE5_CONFIG_TEST_FAIL=$case_fail"
if [[ "$case_fail" -ne 0 ]]; then exit 1; fi
