import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

async function readAdapterSource(): Promise<string> {
  const adapterPath = path.resolve(__dirname, "../../../guest/os4tb_gcc_project_build_run_adapter.c");
  return fs.readFile(adapterPath, "utf8");
}

test("phase7e adapter enforces bounded source count and manifest parsing", async () => {
  const source = await readAdapterSource();
  assert.match(source, /#define OS4TB_GCC_PROJECT_MIN_SOURCES 2/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_SOURCES 64/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_HEADERS 8/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_INCLUDES 4/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_DEFINES 16/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_LIBRARIES 16/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH 64/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH 64/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH 64/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH 16/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH 32/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS 16/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE 8192/);
  assert.match(source, /typedef struct ProjectRunStorage/);
  assert.match(source, /static ProjectRunStorage gProjectRunStorage;/);
  assert.match(source, /static void reset_project_run_storage\(void\)/);
  assert.match(source, /memset\(&gProjectRunStorage, 0, sizeof\(gProjectRunStorage\)\)/);
  assert.match(source, /SOURCE_COUNT=/);
  assert.match(source, /HEADER_COUNT=/);
  assert.match(source, /INCLUDE_COUNT=/);
  assert.match(source, /DEFINE_COUNT=/);
  assert.match(source, /LIBRARY_COUNT=/);
  assert.match(source, /C_STANDARD=/);
  assert.match(source, /WARNING_LEVEL=/);
  assert.match(source, /OPTIMIZATION=/);
  assert.match(source, /DEBUG_SYMBOLS=/);
  assert.match(source, /TOOLCHAIN_ID/);
  assert.match(source, /TOOLCHAIN_SOURCE=/);
  assert.match(source, /TOOLCHAIN_FAMILY=/);
  assert.match(source, /TOOLCHAIN_VERSION=/);
  assert.match(source, /TOOLCHAIN_DRIVER/);
  assert.match(source, /TOOLCHAIN_DRIVER_PREFIX_POLICY/);
  assert.match(source, /TOOLCHAIN_CC1_PREFIX/);
  assert.match(source, /TOOLCHAIN_GCC_BIN_PREFIX/);
  assert.match(source, /TOOLCHAIN_INTERNAL_INCLUDE_DIR/);
  assert.match(source, /TOOLCHAIN_SDK_ROOT/);
  assert.match(source, /TOOLCHAIN_LD_PATH/);
  assert.match(source, /TOOLCHAIN_RUNTIME_LIBGCC/);
  assert.match(source, /TOOLCHAIN_RUNTIME_LIBGCC_EH/);
  assert.match(source, /TOOLCHAIN_CRTBEGIN/);
  assert.match(source, /TOOLCHAIN_CRTEND/);
  assert.match(source, /TOOLCHAIN_LIBRARY_DIR_COUNT/);
  assert.match(source, /TOOLCHAIN_LIBRARY_DIR_/);
  assert.match(source, /SOURCE_/);
  assert.match(source, /HEADER_/);
  assert.match(source, /INCLUDE_/);
  assert.match(source, /DEFINE_/);
  assert.match(source, /LIBRARY_/);
  assert.match(source, /if \(!seen_any_source \|\| source_count < OS4TB_GCC_PROJECT_MIN_SOURCES \|\| source_count > OS4TB_GCC_PROJECT_MAX_SOURCES\)/);
  assert.match(source, /for \(i = 0; i < source_count; i \+= 1\)/);
  assert.match(source, /for \(i = source_count; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i \+= 1\)/);
  assert.match(source, /for \(i = 0; i < header_count; i \+= 1\)/);
  assert.match(source, /for \(i = header_count; i < OS4TB_GCC_PROJECT_MAX_HEADERS; i \+= 1\)/);
  assert.match(source, /for \(i = 0; i < define_count; i \+= 1\)/);
  assert.match(source, /for \(i = define_count; i < OS4TB_GCC_PROJECT_MAX_DEFINES; i \+= 1\)/);
  assert.match(source, /for \(i = 0; i < library_count; i \+= 1\)/);
  assert.match(source, /for \(i = library_count; i < OS4TB_GCC_PROJECT_MAX_LIBRARIES; i \+= 1\)/);
  assert.match(source, /parse_project_manifest_file/);
  assert.match(source, /char command_buf\[OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE\]/);
  assert.match(source, /char\(\*source_names\)\[240\] = gProjectRunStorage\.source_names;/);
  assert.match(source, /reset_project_run_storage\(\);/);
});

test("phase7e adapter uses deterministic request-scoped source and object naming", async () => {
  const source = await readAdapterSource();
  assert.match(source, /project_%s/);
  assert.match(source, /join_with_slash/);
  assert.match(source, /build_%s_source%d\.o/);
  assert.match(source, /project_manifest\.txt/);
});

test("phase7e adapter compiles sequentially and stops on first failure", async () => {
  const source = await readAdapterSource();
  assert.match(source, /for \(i = 0; i < source_count; i \+= 1\)/);
  assert.match(source, /if \(compile_rc != 0\) \{/);
  assert.match(source, /break;/);
});

test("phase7e adapter links all compiled objects in order with direct archives", async () => {
  const source = await readAdapterSource();
  assert.match(source, /for \(i = 0; i < source_count; i \+= 1\) \{/);
  assert.match(source, /sb_appendf\(&builder, "%s ", object_names\[i\]\)/);
  assert.match(source, /project_toolchain_crtbegin/);
  assert.match(source, /--start-group -lc /);
  assert.match(source, /-l%s /);
  assert.match(source, /--end-group /);
  assert.match(source, /project_toolchain_crtend/);
  assert.match(source, /project_toolchain_runtime_libgcc/);
  assert.match(source, /project_toolchain_runtime_libgcc_eh/);
  assert.match(source, /project_toolchain_ld_path/);
  assert.match(source, /TOOLCHAIN_LIBRARY_DIR_COUNT/);
  assert.match(source, /-L%s /);
});

test("phase7e adapter emits per-source compile telemetry and bounded project fields", async () => {
  const source = await readAdapterSource();
  assert.match(source, /OS4TB_GCC_PROJECT_DIRECTORY=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_MANIFEST=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_MANIFEST_STATUS=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_SOURCE_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_SOURCE_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_OBJECT_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_HEADER_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_HEADER_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_INCLUDE_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_INCLUDE_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_DEFINE_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_DEFINE_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_LIBRARY_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_LIBRARY_%d=/);
  assert.match(source, /OS4TB_GCC_PROJECT_C_STANDARD=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_WARNING_LEVEL=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_OPTIMIZATION=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_DEBUG_SYMBOLS=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_ID=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_DRIVER=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_TOOLCHAIN_DRIVER_PREFIX_POLICY=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_CC1_PREFIX=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_GCC_BIN_PREFIX=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_DIR=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_COUNT=%d/);
  assert.match(source, /OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_%d=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_SDK_ROOT=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_MUI_INCLUDE_DIR=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_LD_PATH=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_COMMAND_BUFFER_STATUS=/);
  assert.match(source, /OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=/);
  assert.match(source, /OS4TB_GCC_PROJECT_LINK_EXIT=/);
  assert.match(source, /OS4TB_GCC_PROJECT_EXECUTABLE_STATUS=/);
  assert.match(source, /OS4TB_GCC_PROJECT_LINK_OBJECT_FILE=/);
  assert.match(source, /OBJECT_COUNT=%d/);
  assert.match(source, /OBJECT_%d=%s/);
  assert.match(source, /LIBRARY_COUNT=%d/);
  assert.match(source, /LIBRARY_%d=%s/);
  assert.match(source, /OS4TB_GCC_PROJECT_BUILD_FINAL=/);
  assert.match(source, /OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives/);
});

test("phase7e adapter prevents program execution unless build/link succeeded", async () => {
  const source = await readAdapterSource();
  assert.match(source, /if \(build_rc == 0 && executable_present\) \{/);
  assert.match(source, /program_rc = run_command_capture_both\(executable_name, program_output_name\);/);
  assert.match(source, /if \(execution_skipped\) \{/);
  assert.match(source, /OS4TB_PROGRAM_EXIT=not_run/);
  assert.match(source, /OS4TB_PROGRAM_EXIT=%d/);
  assert.match(source, /OS4TB_PROGRAM_FINAL=NOT_RUN/);
});

test("phase7e adapter compiles with bounded project-local include path", async () => {
  const source = await readAdapterSource();
  assert.match(source, /project_toolchain_internal_include_dirs/);
  assert.match(source, /compile internal include append failed/);
  assert.match(source, /project c_standard mapping failed/);
  assert.match(source, /project warning_level mapping failed/);
  assert.match(source, /project optimization mapping failed/);
  assert.match(source, /project debug_symbols mapping failed/);
  assert.match(source, /-std=c90/);
  assert.match(source, /-std=c99/);
  assert.match(source, /-std=c11/);
  assert.match(source, /-O0/);
  assert.match(source, /-Og/);
  assert.match(source, /-O2/);
  assert.match(source, /-Werror/);
  assert.match(source, /-g /);
  assert.match(source, /-idirafter %s /);
  assert.match(source, /toolchain_mui_include_ready/);
  assert.match(source, /project_toolchain_cc1_prefix/);
  assert.match(source, /project_toolchain_gcc_bin_prefix/);
  assert.match(source, /-I%s /);
  assert.match(source, /-D%s /);
  assert.match(source, /\.project-compile-command-%d\.txt/);
  assert.match(source, /COMPILE_COMMAND=/);
  assert.match(source, /write_text_file\(compile_command_output_names\[i\], ""\)/);
  assert.match(source, /append_text_to_file\(compile_command_output_names\[i\], command_buf\)/);
  assert.match(source, /compile include path append failed/);
  assert.match(source, /compile define append failed/);
  assert.match(source, /project_dir_path/);
});

test("phase7g generic adapter has no semantic version branching", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("11.5.0"), false);
  assert.equal(source.includes("8.4.0"), false);
  assert.equal(source.includes("6.4.0"), false);
  assert.equal(/if\s*\(.*toolchain_version.*==/.test(source), false);
  assert.equal(/switch\s*\(.*toolchain_version/.test(source), false);
});

test("phase7e adapter validates define grammar and rejects duplicate define names", async () => {
  const source = await readAdapterSource();
  assert.match(source, /is_valid_define_name/);
  assert.match(source, /is_valid_define_value/);
  assert.match(source, /parse_define_entry/);
  assert.match(source, /strcmp\(define_names\[j\], parsed_name\) == 0/);
});

test("phase8 adapter manifest line parser splits on first '=' and leaves define semantics typed", async () => {
  const source = await readAdapterSource();
  assert.match(source, /eq = strchr\(\*line_buf, '='\);/);
  assert.match(source, /if \(eq == NULL \|\| eq == key\) \{/);
  assert.doesNotMatch(source, /eq != strrchr\(\*line_buf, '='\)/);
  assert.match(source, /parse_define_entry/);
});

test("phase7e adapter validates library grammar and reserved names", async () => {
  const source = await readAdapterSource();
  assert.match(source, /is_valid_library_name/);
  assert.match(source, /is_reserved_library_name/);
  assert.match(source, /is_ascii_case_equal\(name, "c"\)/);
  assert.match(source, /strcmp\(library_names\[j\], value\) == 0/);
});

test("phase7e adapter skips compile and reports missing taxonomy when manifest is absent", async () => {
  const source = await readAdapterSource();
  assert.match(source, /project manifest missing; skipping project build/);
  assert.match(source, /if \(toolchain_ready && strcmp\(manifest_status, "present"\) == 0\)/);
});

test("phase7e adapter does not add recursive discovery or arbitrary shell fields", async () => {
  const source = await readAdapterSource();
  assert.equal(source.includes("opendir("), false);
  assert.equal(source.includes("readdir("), false);
  assert.equal(source.includes("command="), false);
  assert.equal(source.includes("shell="), false);
  assert.equal(source.includes("script="), false);
});

test("phase7e adapter accepts legacy SOURCE_<index>_TYPE keys", async () => {
  const source = await readAdapterSource();
  assert.match(source, /const char \*legacy_suffix = strstr\(key \+ 7, "_TYPE"\);/);
  assert.match(source, /if \(legacy_suffix != NULL && legacy_suffix\[5\] == '\\0'\)/);
  assert.match(source, /source_type_seen\[index\] = 1;/);
});

test("phase7e adapter infers missing source type from extension and keeps bounds", async () => {
  const source = await readAdapterSource();
  assert.match(source, /if \(!source_type_seen\[i\]\) \{/);
  assert.match(source, /if \(has_extension\(source_names\[i\], "\.c"\)\)/);
  assert.match(source, /else if \(has_extension\(source_names\[i\], "\.s"\)\)/);
  assert.match(source, /else \{/);
  assert.match(source, /return 3;/);
  assert.match(source, /#define OS4TB_GCC_PROJECT_MAX_SOURCES 64/);
});
