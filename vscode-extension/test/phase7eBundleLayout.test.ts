import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readBundleScript(): Promise<string> {
  const scriptPath = path.resolve(__dirname, "../../../tests/build_phase7e_os4_bundle.sh");
  return fs.readFile(scriptPath, "utf8");
}

test("phase7e bundle preserves runnable project fixture directories", async () => {
  const script = await readBundleScript();
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/clean_three" "\$BUNDLE_DIR\/clean_three"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/middle_error" "\$BUNDLE_DIR\/middle_error"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/header_clean" "\$BUNDLE_DIR\/header_clean"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/header_error" "\$BUNDLE_DIR\/header_error"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/tree_clean" "\$BUNDLE_DIR\/tree_clean"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/tree_header_error" "\$BUNDLE_DIR\/tree_header_error"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/defines_clean" "\$BUNDLE_DIR\/defines_clean"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/defines_missing" "\$BUNDLE_DIR\/defines_missing"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/defines_wrong_value" "\$BUNDLE_DIR\/defines_wrong_value"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/libraries_clean" "\$BUNDLE_DIR\/libraries_clean"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/library_required_missing" "\$BUNDLE_DIR\/library_required_missing"/);
  assert.match(script, /cp -R "\$ROOT\/guest\/fixtures\/gcc_project_manifest\/library_missing" "\$BUNDLE_DIR\/library_missing"/);
});

test("phase7e bundle script asserts header fixture layout after creation", async () => {
  const script = await readBundleScript();
  assert.match(script, /test -f "\$BUNDLE_DIR\/header_clean\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/header_clean\/project\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/header_error\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/header_error\/project\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_clean\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_clean\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_clean\/include\/values\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_header_error\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_header_error\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/tree_header_error\/include\/values\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_clean\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_clean\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_clean\/include\/config\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_missing\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_missing\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_missing\/include\/config\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_wrong_value\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_wrong_value\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/defines_wrong_value\/include\/config\.h"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/libraries_clean\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/libraries_clean\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/library_required_missing\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/library_required_missing\/src\/main\.c"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/library_missing\/\.os4tb-project"/);
  assert.match(script, /test -f "\$BUNDLE_DIR\/library_missing\/src\/main\.c"/);
});
