#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/guest/os4tb_gcc_project_build_run_adapter.c"

pass=0
fail=0

check_contains() {
  local label="$1"
  local pattern="$2"
  if grep -Eq "$pattern" "$SOURCE"; then
    echo "${label}=PASS"
    pass=$((pass + 1))
  else
    echo "${label}=FAIL"
    fail=$((fail + 1))
  fi
}

check_contains "OS4TB_PHASE7E_POLICY_KEY_PARSE" 'strcmp\(key, "RUN_PROGRAM"\) == 0'
check_contains "OS4TB_PHASE7E_POLICY_VALUE_VALIDATION" 'seen_run_program \|\| \(strcmp\(value, "yes"\) != 0 && strcmp\(value, "no"\) != 0\)'
check_contains "OS4TB_PHASE7E_POLICY_DEFAULT_RUN" 'snprintf\(run_program_out, 4, "%s", "yes"\)'
check_contains "OS4TB_PHASE7E_POLICY_PARSE_TO_GATE" 'run_program_enabled = strcmp\(run_program_mode, "no"\) != 0;'
check_contains "OS4TB_PHASE7E_POLICY_EXECUTION_GATE" 'if \(build_rc == 0 && executable_present && run_program_enabled\)'
check_contains "OS4TB_PHASE7E_POLICY_SKIP_BRANCH" 'else if \(build_rc == 0 && executable_present\)'
check_contains "OS4TB_PHASE7E_POLICY_SKIP_FINAL" 'execution_skipped = 1;'
check_contains "OS4TB_PHASE7E_POLICY_SKIP_NOT_RUN" 'program_final = "NOT_RUN";'
check_contains "OS4TB_PHASE7E_POLICY_ARTIFACT_MODE" 'OS4TB_GCC_EXECUTION_MODE=%s'
check_contains "OS4TB_PHASE7E_POLICY_ARTIFACT_SKIPPED" 'OS4TB_GCC_EXECUTION_SKIPPED=%s'

run_exec_count="$(grep -c 'run_command_capture_both(executable_name, program_output_name)' "$SOURCE")"
if [[ "$run_exec_count" -eq 1 ]]; then
  echo "OS4TB_PHASE7E_POLICY_EXEC_CALL_COUNT=PASS"
  pass=$((pass + 1))
else
  echo "OS4TB_PHASE7E_POLICY_EXEC_CALL_COUNT=FAIL"
  fail=$((fail + 1))
fi

echo "OS4TB_PHASE7E_POLICY_CASE_PASS=$pass"
echo "OS4TB_PHASE7E_POLICY_CASE_FAIL=$fail"
echo "OS4TB_PHASE7E_POLICY_TOTAL_FAIL=$fail"

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
