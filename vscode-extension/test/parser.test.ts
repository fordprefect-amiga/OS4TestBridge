import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRunContract, parseKeyValueOutput } from "../src/parser";

test("duplicate KEY behavior is flagged", () => {
  const parsed = parseKeyValueOutput("OS4TB_RUN_FINAL=PASS\nOS4TB_RUN_FINAL=FAIL\n");
  assert.deepEqual(parsed.duplicates, ["OS4TB_RUN_FINAL"]);
  const contract = evaluateRunContract(0, parsed);
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "duplicate_authoritative_key");
});

test("values containing '=' are preserved after first separator", () => {
  const parsed = parseKeyValueOutput("OS4TB_DETAIL=a=b=c\n");
  assert.equal(parsed.fields.OS4TB_DETAIL, "a=b=c");
});

test("run nonzero exit is failure", () => {
  const parsed = parseKeyValueOutput("OS4TB_RUN_FINAL=PASS\n");
  const contract = evaluateRunContract(2, parsed);
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "process_exit_nonzero");
});

test("run exit 0 with missing OS4TB_RUN_FINAL fails", () => {
  const parsed = parseKeyValueOutput("OS4TB_RUN_RESULT=PASS\n");
  const contract = evaluateRunContract(0, parsed);
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "missing_run_final");
});

test("run exit 0 with OS4TB_RUN_FINAL=FAIL fails", () => {
  const parsed = parseKeyValueOutput("OS4TB_RUN_FINAL=FAIL\nOS4TB_RUN_FAILURE_REASON=result_validation_failed\n");
  const contract = evaluateRunContract(0, parsed);
  assert.equal(contract.ok, false);
  assert.equal(contract.reason, "run_final_not_pass");
});
