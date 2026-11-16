import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readAdapterSource(): Promise<string> {
  const adapterPath = path.resolve(__dirname, "../../../guest/os4tb_gcc_build_run_adapter.c");
  return fs.readFile(adapterPath, "utf8");
}

function countOccurrences(source: string, needle: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    const found = source.indexOf(needle, index);
    if (found < 0) {
      return count;
    }
    count += 1;
    index = found + needle.length;
  }
}

test("phase7d adapter pins fixed runtime library path", async () => {
  const source = await readAdapterSource();
  assert.match(
    source,
    /Work:SDK\/gcc\/ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11\.5\.0\//
  );
  assert.match(source, /GCC:lib\/gcc\/ppc-amigaos\/11\.5\.0\/newlib\/lib\/small-data\//);
  assert.match(source, /GCC:ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11\.5\.0\//);
  assert.match(source, /"gcc -B%s -B%s -Wall -Wextra -c %s -o %s"/);
  assert.match(source, /"gcc -B%s -B%s -Wall -Wextra %s -o %s -###"/);
});

test("phase7d adapter checks libgcc and libgcc_eh before build", async () => {
  const source = await readAdapterSource();
  assert.match(source, /libgcc_found = file_is_readable\(kConfiguredLibgccPath\);/);
  assert.match(source, /libgcc_eh_found = file_is_readable\(kConfiguredLibgccEhPath\);/);
  assert.match(source, /runtime_lib_ready = \(libgcc_found && libgcc_eh_found\) \? 1 : 0;/);
  assert.match(source, /if \(toolchain_ready && source_present\)/);
  assert.match(source, /direct_libgcc_status = classify_file_readable_status\(kDirectLibgccPath\);/);
  assert.match(source, /direct_libgcc_eh_status = classify_file_readable_status\(kDirectLibgccEhPath\);/);
});

test("phase7d adapter emits runtime library discovery tokens", async () => {
  const source = await readAdapterSource();
  assert.match(source, /OS4TB_GCC_LIBGCC_DISCOVERY=/);
  assert.match(source, /OS4TB_GCC_LIBGCC_EH_DISCOVERY=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_ENV=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_PATH=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_NATIVE_PATH=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_SMALL_DATA_PATH=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_LINKER_PATH=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_PATH_MODE=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_PROBE=/);
  assert.match(source, /OS4TB_GCC_LINK_TRACE_STATUS=/);
  assert.match(source, /OS4TB_GCC_LINK_TRACE_FILE=/);
  assert.match(source, /OS4TB_GCC_LINK_TRACE_MODE=/);
  assert.match(source, /OS4TB_GCC_LINK_TRACE_EXIT=/);
  assert.match(source, /OS4TB_GCC_LINK_TRACE_MODES=/);
  assert.match(source, /OS4TB_GCC_SDK_ASSIGN_STATUS=/);
  assert.match(source, /OS4TB_GCC_SDK_ASSIGN_TARGET=/);
  assert.match(source, /OS4TB_GCC_GCC_ASSIGN_STATUS=/);
  assert.match(source, /OS4TB_GCC_GCC_ASSIGN_TARGET=/);
  assert.match(source, /OS4TB_GCC_STARTUP_SCRIPT_STATUS=/);
  assert.match(source, /OS4TB_GCC_SETDEFGCC_STATUS=/);
  assert.match(source, /OS4TB_GCC_SDK_ENV_AUDIT_STATUS=/);
  assert.match(source, /OS4TB_GCC_SDK_AUDIT_PROGRESS_FILE=/);
  assert.match(source, /OS4TB_GCC_SDK_AUDIT_STAGE=/);
  assert.match(source, /OS4TB_GCC_SDK_AUDIT_ASSIGN_ENUM=/);
  assert.match(source, /OS4TB_GCC_SDK_AUDIT_STARTUP_CAPTURE=/);
  assert.match(source, /OS4TB_GCC_SDK_AUDIT_SETDEFGCC_CAPTURE=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_TREE_AUDIT_STATUS=/);
  assert.match(source, /OS4TB_GCC_RUNTIME_TREE_AUDIT_FILE=/);
  assert.match(source, /OS4TB_GCC_EXPECTED_RUNTIME_DIR_STATUS=/);
  assert.match(source, /OS4TB_GCC_EXPECTED_LIBGCC_STATUS=/);
  assert.match(source, /OS4TB_GCC_EXPECTED_LIBGCC_EH_STATUS=/);
  assert.match(source, /OS4TB_GCC_SMALL_DATA_DIR_STATUS=/);
  assert.match(source, /OS4TB_GCC_SMALL_DATA_LIBGCC_STATUS=/);
  assert.match(source, /OS4TB_GCC_SMALL_DATA_LIBGCC_EH_STATUS=/);
  assert.match(source, /OS4TB_GCC_ACTUAL_RUNTIME_DIR_STATUS=/);
  assert.match(source, /OS4TB_GCC_ACTUAL_LIBGCC_STATUS=/);
  assert.match(source, /OS4TB_GCC_ACTUAL_LIBGCC_EH_STATUS=/);
  assert.match(source, /OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_OBJECT=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_LIBGCC=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_LIBGCC_EH=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LIBGCC_STATUS=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_OUTPUT_FILE=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_EXIT=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=/);
  assert.match(source, /OS4TB_GCC_DIRECT_LINK_FINAL=/);
});

test("phase7d adapter does not use clib2 or request-controlled runtime path", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("clib2"), false);
  assert.match(source, /OS4TB_GCC_RUNTIME_LIB_PATH=/);
  assert.match(source, /direct_runtime_archives/);
  assert.equal(source.includes("linker_forward_unix_L"), false);
  assert.equal(source.includes("small_data_runtime_L"), false);
  assert.equal(source.includes("native_gcc_L"), false);
  assert.equal(source.includes("linker_forward_native_L"), false);
  assert.equal(source.includes("native_gcc_assign_L"), false);
  assert.equal(source.includes("-LGCC:lib/gcc/ppc-amigaos/11.5.0/\""), false);
  assert.equal(source.includes("kConfiguredRuntimeLibPath = argv"), false);
  assert.equal(source.includes("setenv"), false);
  assert.equal(source.includes("SetVar"), false);
  assert.equal(source.includes("small-data/libgcc.a"), false);
  assert.equal(source.includes("small-data/libgcc_eh.a"), false);
});

test("phase7d adapter retries only when linker reports runtime lib miss", async () => {
  const source = await readAdapterSource();
  assert.match(source, /capture_has_runtime_lib_link_error/);
  assert.match(source, /cannot find -lgcc/);
  assert.match(source, /cannot find -lgcc_eh/);
});

test("phase7d adapter avoids unsafe print-search-dirs discovery", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("-print-search-dirs"), false);
});

test("phase7d adapter captures bounded SDK environment semantics", async () => {
  const source = await readAdapterSource();
  assert.match(source, /Work:SDK\/S\/gcc-startup/);
  assert.match(source, /Work:SDK\/Tools\/set_defGCC/);
  assert.match(source, /extract_assign_target_from_listing\("SDK"/);
  assert.match(source, /extract_assign_target_from_listing\("GCC"/);
  assert.match(source, /LockDosList/);
  assert.match(source, /FindDosEntry/);
  assert.equal(source.includes("resolve_assign_target"), false);
  assert.equal(source.includes("Assign SDK:"), false);
  assert.equal(source.includes("Assign GCC:"), false);
  assert.equal(source.includes("\"Path\""), false);
});

test("phase7d adapter writes request-scoped progress markers", async () => {
  const source = await readAdapterSource();
  assert.match(source, /\.sdk-audit-progress\.txt/);
  assert.match(source, /AUDIT_START/);
  assert.match(source, /BEFORE_ASSIGN_ENUM/);
  assert.match(source, /AFTER_ASSIGN_ENUM/);
  assert.match(source, /BEFORE_GCC_STARTUP_READ/);
  assert.match(source, /AFTER_GCC_STARTUP_READ/);
  assert.match(source, /BEFORE_SETDEFGCC_READ/);
  assert.match(source, /AFTER_SETDEFGCC_READ/);
  assert.match(source, /BEFORE_RUNTIME_TREE_AUDIT/);
  assert.match(source, /AFTER_RUNTIME_TREE_AUDIT/);
  assert.match(source, /AUDIT_COMPLETE/);
  assert.match(source, /fflush/);
});

test("phase7d adapter does not execute SetDefGCC", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("SetDefGCC "), false);
  assert.equal(source.includes("Run SetDefGCC"), false);
  assert.match(source, /present_binary_or_nontext/);
});

test("phase7d adapter audits only approved runtime tree directories", async () => {
  const source = await readAdapterSource();
  assert.match(source, /kRuntimeTreeAuditDirs/);
  assert.match(source, /"GCC:lib\/"/);
  assert.match(source, /"GCC:lib\/gcc\/"/);
  assert.match(source, /"GCC:lib\/gcc\/ppc-amigaos\/"/);
  assert.match(source, /"GCC:lib\/gcc\/ppc-amigaos\/11\.5\.0\/"/);
  assert.match(source, /"GCC:lib\/gcc\/ppc-amigaos\/11\.5\.0\/newlib\/"/);
  assert.match(source, /"GCC:lib\/gcc\/ppc-amigaos\/11\.5\.0\/newlib\/lib\/"/);
  assert.match(source, /"GCC:lib\/gcc\/ppc-amigaos\/11\.5\.0\/newlib\/lib\/small-data\/"/);
  assert.match(source, /"GCC:ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11\.5\.0\/"/);
  assert.match(source, /kRuntimeTreeMaxEntries = 128U/);
  assert.match(source, /opendir/);
  assert.match(source, /readdir/);
  assert.equal(source.includes("MatchFirst"), false);
  assert.equal(source.includes("MatchNext"), false);
});

test("phase7d adapter runtime tree audit is bounded and non-mutating", async () => {
  const source = await readAdapterSource();
  assert.match(source, /\.gcc-runtime-tree\.txt/);
  assert.match(source, /readlink/);
  assert.match(source, /TRUNCATED=/);
  assert.match(source, /ENTRY name=/);
  assert.equal(source.includes("Rename("), false);
  assert.equal(source.includes("DeleteFile"), false);
  assert.equal(source.includes("CreateDir"), false);
  assert.equal(source.includes("MakeLink"), false);
});

test("phase7d adapter does not execute exploratory runtime path modes", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("small_data_runtime_L"), false);
  assert.equal(source.includes("native_gcc_L"), false);
  assert.equal(source.includes("linker_forward_native_L"), false);
  assert.equal(source.includes("native_gcc_assign_L"), false);
});

test("phase7d adapter performs direct archive link in fixed order", async () => {
  const source = await readAdapterSource();
  assert.match(source, /gcc -B%s -B%s -Wall -Wextra -c %s -o %s/);
  assert.match(source, /Work:SDK\/gcc\/ppc-amigaos\/bin\/ld/);
  assert.match(source, /GCC:ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11\.5\.0\/libgcc\.a/);
  assert.match(source, /GCC:ppc-amigaos\/bin\/lib\/gcc\/ppc-amigaos\/11\.5\.0\/libgcc_eh\.a/);
  assert.match(source, /--start-group -lc --end-group/);
  assert.match(source, /\/SDK\/newlib\/lib\/crtbegin\.o/);
  assert.match(source, /\/SDK\/newlib\/lib\/crtend\.o/);
  assert.match(source, /\.direct-link\.txt/);
  assert.equal(countOccurrences(source, "%s --defsym"), 1);
  assert.ok(countOccurrences(source, "kDirectLibgccPath") >= 5);
  assert.ok(countOccurrences(source, "kDirectLibgccEhPath") >= 5);
  assert.match(
    source,
    /\/SDK\/newlib\/lib\/crtbegin\.o "\s*\n\s*"%s "\s*\n\s*"%s "\s*\n\s*"%s "\s*\n\s*"--start-group -lc --end-group "\s*\n\s*"%s "\s*\n\s*"%s "\s*\n\s*"\/SDK\/newlib\/lib\/crtend\.o"/
  );
});

test("phase7d adapter classifies direct archive readability deterministically", async () => {
  const source = await readAdapterSource();
  assert.match(source, /static const char \*classify_file_readable_status\(const char \*path\)/);
  assert.match(source, /if \(errno == ENOENT \|\| errno == ENOTDIR\)/);
  assert.match(source, /return "missing";/);
  assert.match(source, /return "error";/);
});

test("phase7d adapter blocks linker when compile fails", async () => {
  const source = await readAdapterSource();
  assert.match(source, /if \(direct_compile_rc != 0\) \{/);
  assert.match(source, /direct_link_final = "NOT_RUN";/);
  assert.match(source, /direct_link_rc = 127;/);
  assert.match(source, /build_rc = direct_compile_rc;/);
});

test("phase7d adapter blocks linker when direct runtime archives are unavailable", async () => {
  const source = await readAdapterSource();
  assert.match(
    source,
    /else if \(strcmp\(direct_libgcc_status, "present"\) != 0 \|\| strcmp\(direct_libgcc_eh_status, "present"\) != 0\) \{/
  );
  assert.match(source, /build_rc = 126;/);
  assert.match(source, /skipping direct link/);
});

test("phase7d adapter runs program only after successful build with executable", async () => {
  const source = await readAdapterSource();
  assert.match(source, /build_ok = \(build_rc == 0 && executable_present\) \? 1 : 0;/);
  assert.match(source, /if \(build_ok\) \{/);
  assert.match(source, /program_rc = run_command_capture_both\(executable_name, program_output_name\);/);
});
