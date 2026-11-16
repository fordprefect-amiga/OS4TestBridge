import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readProbeSource(): Promise<string> {
  const probePath = path.resolve(__dirname, "../../../guest/os4tb_toolchain_discovery_probe.c");
  return fs.readFile(probePath, "utf8");
}

test("phase7f discovery probe keeps bounded constants and static inventory storage", async () => {
  const source = await readProbeSource();
  assert.match(source, /#define OS4TB_MAX_GCC 8/);
  assert.match(source, /#define OS4TB_MAX_INCLUDE_DIRS 16/);
  assert.match(source, /#define OS4TB_MAX_LIBRARY_DIRS 16/);
  assert.match(source, /#define OS4TB_MAX_LIBRARY_INVENTORY 256/);
  assert.match(source, /#define OS4TB_MAX_LINE 520/);
  assert.match(source, /static GccInfo g_gcc_infos\[OS4TB_MAX_GCC\];/);
  assert.equal(source.includes("GccInfo gcc_infos[OS4TB_MAX_GCC];"), false);
});

test("phase7f include probe captures stdout and stderr separately and records semantic status", async () => {
  const source = await readProbeSource();
  assert.match(source, /run_command_capture_split/);
  assert.equal(source.includes('run_command_capture_split("/System/C/'), false);
  assert.match(source, /SYS_Output,/);
  assert.match(source, /SYS_Error,/);
  assert.match(source, /#include <\.\.\.> search starts here:/);
  assert.match(source, /End of search list\./);
  assert.match(source, /INCLUDE_PROBE_STREAM/);
  assert.match(source, /INCLUDE_DISCOVERY_STATUS/);
  assert.match(source, /INCLUDE_PROBE_STDOUT_HAS_BLOCK/);
  assert.match(source, /INCLUDE_PROBE_STDERR_HAS_BLOCK/);
  assert.match(source, /"found"/);
  assert.match(source, /"empty"/);
  assert.match(source, /"probe_failed"/);
  assert.match(source, /const char \*include_probe_command = "gcc";/);
  assert.match(source, /detect_include_search_paths\(\s*include_probe_command,\s*sdk_root,\s*g_gcc_infos\[i\]\.version,/);
  assert.match(
    source,
    /"\/gcc\/ppc-amigaos\/bin\/libexec\/gcc\/ppc-amigaos\/"\s*,\s*gcc_version,\s*"\/"/
  );
  assert.match(source, /join_path3\(as_prefix, sizeof\(as_prefix\), sdk_root, "\/gcc\/ppc-amigaos\/bin\/", ""\)/);
  assert.match(
    source,
    /"%s -B%s -B%s -v -E -x c T:os4tb_discovery_empty\.c -o T:os4tb_discovery_output\.i"/
  );
  assert.match(source, /T:os4tb_discovery_stdout\.txt/);
  assert.match(source, /T:os4tb_discovery_stderr\.txt/);
  assert.equal(source.includes("-o NIL:"), false);
});

test("phase7f include probe command remains preprocessing-only and bounded to discovered inputs", async () => {
  const source = await readProbeSource();
  assert.match(source, /"%s -B%s -B%s -v -E -x c T:os4tb_discovery_empty\.c -o T:os4tb_discovery_output\.i"/);
  assert.match(source, /"%s -B%s -B%s -E -x c T:os4tb_discovery_empty\.c -o T:os4tb_discovery_output\.i"/);
  assert.match(source, /#define OS4TB_INCLUDE_PROBE_ISOLATION_MODE 0/);
  assert.match(source, /run_command_no_capture/);
  assert.match(source, /run_command_passthrough/);
  assert.match(source, /run_command_capture_split_direct/);
  assert.match(source, /07A_GCC_NO_CAPTURE_BEGIN/);
  assert.match(source, /07A_GCC_NO_CAPTURE_RETURN/);
  assert.match(source, /07B_FILE_CAPTURE_BEGIN/);
  assert.match(source, /07B_FILE_CAPTURE_RETURN/);
  assert.match(source, /07B_SPLIT_SYSTEMTAGS_BEGIN/);
  assert.match(source, /07B_SPLIT_SYSTEMTAGS_RETURN/);
  assert.match(source, /07C_PREPROCESS_NO_VERBOSE_BEGIN/);
  assert.match(source, /07C_PREPROCESS_NO_VERBOSE_RETURN/);
  assert.match(source, /07D_REAL_OUTPUT_BEGIN/);
  assert.match(source, /07D_REAL_OUTPUT_RETURN/);
  assert.equal(source.includes(" -c "), false);
  assert.equal(source.includes(" --start-group "), false);
  assert.equal(source.includes(" -L/SDK/newlib/lib "), false);
  assert.match(source, /is_gcc_version_name/);
  assert.match(source, /remove\(empty_file\)/);
  assert.match(source, /remove\(preprocess_out\)/);
  assert.match(source, /remove\(capture_out\)/);
  assert.match(source, /remove\(capture_err\)/);
  assert.match(source, /\*stderr_has_block = parse_include_search_block_file\(capture_err/);
  assert.equal(source.includes("parse_include_search_block_file(capture_out"), false);
});

test("phase7f probe emits bounded assign-resolution fields for sdk/gcc/lib/c/system/t", async () => {
  const source = await readProbeSource();
  assert.match(source, /#define OS4TB_MAX_ASSIGN_TARGETS 8/);
  assert.match(source, /resolve_assign_targets/);
  assert.match(source, /OS4TB_ASSIGN_SDK_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_GCC_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_LIB_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_C_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_SYSTEM_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_T_STATUS=/);
  assert.match(source, /OS4TB_ASSIGN_C_TYPE=/);
  assert.match(source, /OS4TB_ASSIGN_SYSTEM_TYPE=/);
  assert.match(source, /OS4TB_ASSIGN_T_TYPE=/);
  assert.match(source, /OS4TB_ASSIGN_.*_LOCK_STATUS=/);
  assert.match(source, /OS4TB_REAL_OUTPUT_RETURN_CODE=/);
  assert.match(source, /OS4TB_REAL_OUTPUT_STATUS=/);
  assert.match(source, /OS4TB_REAL_OUTPUT_SIZE=/);
  assert.match(source, /OS4TB_REAL_OUTPUT_REQUESTER=/);
});

test("phase7f include probe preserves compiler-reported include paths as-is", async () => {
  const source = await readProbeSource();
  assert.match(source, /snprintf\(dirs\[\*count\], OS4TB_MAX_PATH, "%s", trim\)/);
  assert.equal(source.includes("Work:SDK"), true);
  assert.equal(source.includes("replace("), false);
});

test("phase7f probe distinguishes active frontend from installed GCC versions", async () => {
  const source = await readProbeSource();
  assert.match(source, /OS4TB_GCC_ACTIVE_FRONTEND=/);
  assert.match(source, /OS4TB_GCC_ACTIVE_VERSION=/);
  assert.match(source, /detect_command_version\("gcc -dumpfullversion -dumpversion"/);
  assert.match(source, /OS4TB_GCC_%d_VERSION=/);
  assert.match(source, /OS4TB_GCC_%d_DRIVER=/);
});

test("phase7f probe marks AS/LD present independently from version extraction", async () => {
  const source = await readProbeSource();
  assert.match(source, /detect_tool_at_path/);
  assert.match(source, /if \(!file_is_readable\(tool_path\)\)/);
  assert.match(source, /snprintf\(out_status, 24, "%s", "present"\)/);
  assert.match(source, /OS4TB_AS_STATUS=/);
  assert.match(source, /OS4TB_AS_VERSION=/);
  assert.match(source, /OS4TB_LD_STATUS=/);
  assert.match(source, /OS4TB_LD_VERSION=/);
});

test("phase7f probe does not treat VBCC operational error text as version", async () => {
  const source = await readProbeSource();
  assert.match(source, /detect_vbcc_presence_version/);
  assert.match(source, /detect_command_path\("vlink", out_linker_path, out_linker_status\)/);
  assert.match(source, /detect_command_path\("vasmppc_std", out_assembler_path, out_assembler_status\)/);
  assert.match(source, /No objects to link/);
  assert.match(source, /OS4TB_VBCC_DRIVER_COMMAND=/);
  assert.match(source, /OS4TB_VBCC_DRIVER_PATH=/);
  assert.match(source, /OS4TB_VBCC_STATUS=/);
  assert.match(source, /OS4TB_VBCC_VERSION=/);
  assert.match(source, /OS4TB_VBCC_LINKER_STATUS=/);
  assert.match(source, /OS4TB_VBCC_LINKER_PATH=/);
  assert.match(source, /OS4TB_VBCC_ASSEMBLER_STATUS=/);
  assert.match(source, /OS4TB_VBCC_ASSEMBLER_PATH=/);
});

test("phase7f probe emits internal include directory and stddef/stdarg/stdint provenance", async () => {
  const source = await readProbeSource();
  assert.match(source, /detect_internal_include_dirs/);
  assert.match(source, /detect_internal_header_dirs/);
  assert.match(source, /INTERNAL_INCLUDE_DIR_COUNT/);
  assert.match(source, /INTERNAL_STDDEF_DIR/);
  assert.match(source, /INTERNAL_STDARG_DIR/);
  assert.match(source, /INTERNAL_STDINT_DIR/);
});

test("phase7f probe keeps symlink vs broken_symlink status distinction", async () => {
  const source = await readProbeSource();
  assert.match(source, /"symlink"/);
  assert.match(source, /"broken_symlink"/);
  assert.match(source, /"missing"/);
  assert.match(source, /"present"/);
});
