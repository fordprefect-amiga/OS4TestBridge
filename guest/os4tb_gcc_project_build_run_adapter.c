#include <dos/dos.h>
#include <proto/dos.h>
#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <stdarg.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

static const int kUseUserShell = 1;
#define OS4TB_GCC_PROJECT_MIN_SOURCES 2
#define OS4TB_GCC_PROJECT_MAX_SOURCES 64
#define OS4TB_GCC_PROJECT_MAX_HEADERS 8
#define OS4TB_GCC_PROJECT_MAX_INCLUDES 4
#define OS4TB_GCC_PROJECT_MAX_DEFINES 16
#define OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH 64
#define OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH 64
#define OS4TB_GCC_PROJECT_MAX_LIBRARIES 16
#define OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH 64
#define OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH                                                         \
    (OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH + 1 + OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH)
#define OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE 8192
#define OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH 16
#define OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH 32
#define OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH 320
#define OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS 16
#define OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS 8

static const char *kProjectDefaultCStandard = "c11";
static const char *kProjectDefaultWarningLevel = "extra";
static const char *kProjectDefaultOptimization = "none";
static const char *kProjectDefaultDebugSymbols = "no";

typedef struct StringBuilder {
    char *buf;
    size_t cap;
    size_t used;
} StringBuilder;

typedef struct ProjectRunStorage {
    char command_buf[OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE];
    char source_names[OS4TB_GCC_PROJECT_MAX_SOURCES][240];
    char source_types[OS4TB_GCC_PROJECT_MAX_SOURCES][8];
    char header_names[OS4TB_GCC_PROJECT_MAX_HEADERS][240];
    char include_names[OS4TB_GCC_PROJECT_MAX_INCLUDES][240];
    char define_entries[OS4TB_GCC_PROJECT_MAX_DEFINES][OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH + 1];
    char library_names[OS4TB_GCC_PROJECT_MAX_LIBRARIES][OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH + 1];
    char project_c_standard[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH];
    char project_warning_level[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH];
    char project_optimization[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH];
    char project_debug_symbols[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH];
    char project_toolchain_id[OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH + 1];
    char project_toolchain_source[32];
    char project_toolchain_family[32];
    char project_toolchain_version[32];
    char project_toolchain_driver[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_driver_prefix_policy[32];
    char project_toolchain_cc1_prefix[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_gcc_bin_prefix[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_internal_include_dirs[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS][OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_sdk_root[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_as_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_ld_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_runtime_libgcc[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_runtime_libgcc_eh[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_crtbegin[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_crtend[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_toolchain_library_dirs[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS][OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_assembler_id[32];
    char project_assembler_family[32];
    char project_assembler_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char project_assembler_linker_model[32];
    char project_assembler_linker_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char source_paths[OS4TB_GCC_PROJECT_MAX_SOURCES][640];
    char header_paths[OS4TB_GCC_PROJECT_MAX_HEADERS][640];
    char include_paths[OS4TB_GCC_PROJECT_MAX_INCLUDES][640];
    char object_names[OS4TB_GCC_PROJECT_MAX_SOURCES][200];
    char compile_output_names[OS4TB_GCC_PROJECT_MAX_SOURCES][240];
    char compile_command_output_names[OS4TB_GCC_PROJECT_MAX_SOURCES][280];
    char source_status[OS4TB_GCC_PROJECT_MAX_SOURCES][16];
    int compile_exit[OS4TB_GCC_PROJECT_MAX_SOURCES];
    /* Safe as process-local scratch: adapter handles one request synchronously per process invocation. */
    char manifest_parse_line[512];
} ProjectRunStorage;

static ProjectRunStorage gProjectRunStorage;

static void reset_project_run_storage(void) {
    int i = 0;
    (void)memset(&gProjectRunStorage, 0, sizeof(gProjectRunStorage));
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i += 1) {
        (void)snprintf(gProjectRunStorage.source_status[i], sizeof(gProjectRunStorage.source_status[i]), "%s", "not_checked");
        (void)snprintf(gProjectRunStorage.source_types[i], sizeof(gProjectRunStorage.source_types[i]), "%s", "c");
        gProjectRunStorage.compile_exit[i] = 127;
    }
}

static int is_safe_basename(const char *name) {
    size_t i = 0U;
    size_t len = strlen(name);
    if (len == 0U || len > 128U) {
        return 0;
    }
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0 || strstr(name, "..") != NULL) {
        return 0;
    }
    for (i = 0U; i < len; ++i) {
        unsigned char c = (unsigned char)name[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int has_extension(const char *name, const char *extension) {
    size_t name_len = strlen(name);
    size_t extension_len = strlen(extension);
    if (name_len <= extension_len) {
        return 0;
    }
    return strcmp(name + name_len - extension_len, extension) == 0;
}

static int is_safe_relative_project_path(const char *name) {
    size_t len = strlen(name);
    size_t i = 0U;
    size_t segment_start = 0U;
    int segment_count = 1;
    int segment_len = 0;

    if (len == 0U || len > 240U) {
        return 0;
    }
    if (name[0] == '/' || name[0] == '\\') {
        return 0;
    }
    if (strstr(name, "//") != NULL || strstr(name, "/./") != NULL || strstr(name, "/../") != NULL) {
        return 0;
    }
    if (strncmp(name, "./", 2U) == 0 || strncmp(name, "../", 3U) == 0) {
        return 0;
    }
    if (len >= 2U && strcmp(name + len - 2U, "/.") == 0) {
        return 0;
    }
    if (len >= 3U && strcmp(name + len - 3U, "/..") == 0) {
        return 0;
    }
    if (strchr(name, ':') != NULL || strchr(name, '\\') != NULL) {
        return 0;
    }

    for (i = 0U; i < len; i += 1) {
        unsigned char c = (unsigned char)name[i];
        if (c == '/') {
            if (segment_len <= 0 || segment_len > 64) {
                return 0;
            }
            if ((size_t)segment_len == 1U && name[segment_start] == '.') {
                return 0;
            }
            if ((size_t)segment_len == 2U && name[segment_start] == '.' && name[segment_start + 1U] == '.') {
                return 0;
            }
            segment_count += 1;
            segment_len = 0;
            segment_start = i + 1U;
            continue;
        }
        if (c < 32U || c == 127U) {
            return 0;
        }
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '-' || c == '.')) {
            return 0;
        }
        segment_len += 1;
        if (segment_len > 64) {
            return 0;
        }
    }

    if (segment_len <= 0) {
        return 0;
    }
    if ((size_t)segment_len == 1U && name[segment_start] == '.') {
        return 0;
    }
    if ((size_t)segment_len == 2U && name[segment_start] == '.' && name[segment_start + 1U] == '.') {
        return 0;
    }
    if (segment_count > 12) {
        return 0;
    }
    return 1;
}

static int is_safe_relative_c_path(const char *name) {
    return is_safe_relative_project_path(name) && has_extension(name, ".c");
}

static int is_safe_relative_asm_path(const char *name) {
    return is_safe_relative_project_path(name) && has_extension(name, ".s");
}

static int is_valid_source_type(const char *name) {
    return strcmp(name, "c") == 0 || strcmp(name, "asm") == 0;
}

static int is_valid_assembler_family_value(const char *value) {
    return strcmp(value, "gnu_as") == 0 || strcmp(value, "vasm") == 0;
}

static int is_valid_assembler_id_value(const char *value) {
    size_t i = 0U;
    size_t len = strlen(value);
    if (len == 0U || len > 31U) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char ch = (unsigned char)value[i];
        if ((ch >= 'A' && ch <= 'Z') ||
            (ch >= 'a' && ch <= 'z') ||
            (ch >= '0' && ch <= '9') ||
            ch == '-' || ch == '_' || ch == '.') {
            continue;
        }
        return 0;
    }
    return 1;
}

static int is_safe_relative_h_path(const char *name) {
    return is_safe_relative_project_path(name) && has_extension(name, ".h");
}

static int is_valid_define_name(const char *name) {
    size_t i = 0U;
    size_t len = strlen(name);
    if (len == 0U || len > OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH) {
        return 0;
    }
    if (!((name[0] >= 'a' && name[0] <= 'z') || (name[0] >= 'A' && name[0] <= 'Z') || name[0] == '_')) {
        return 0;
    }
    for (i = 1U; i < len; i += 1) {
        unsigned char c = (unsigned char)name[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_')) {
            return 0;
        }
    }
    return 1;
}

static int is_valid_define_value(const char *value) {
    size_t i = 0U;
    size_t len = strlen(value);
    if (len == 0U || len > OS4TB_GCC_PROJECT_DEFINE_VALUE_MAX_LENGTH) {
        return 0;
    }
    for (i = 0U; i < len; i += 1) {
        unsigned char c = (unsigned char)value[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' ||
              c == '+' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int parse_define_entry(const char *entry, char *name_out, size_t name_out_size) {
    const char *eq = strchr(entry, '=');
    size_t name_len = 0U;
    if (entry == NULL || name_out == NULL || name_out_size == 0U) {
        return 1;
    }
    if (eq == NULL) {
        if (!is_valid_define_name(entry)) {
            return 1;
        }
        (void)snprintf(name_out, name_out_size, "%s", entry);
        return 0;
    }
    if (eq == entry || eq != strrchr(entry, '=')) {
        return 1;
    }
    name_len = (size_t)(eq - entry);
    if (name_len == 0U || name_len >= name_out_size || name_len > OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH) {
        return 1;
    }
    (void)memcpy(name_out, entry, name_len);
    name_out[name_len] = '\0';
    if (!is_valid_define_name(name_out)) {
        return 1;
    }
    if (!is_valid_define_value(eq + 1)) {
        return 1;
    }
    return 0;
}

static int is_valid_library_name(const char *name) {
    size_t i = 0U;
    size_t len = strlen(name);
    if (len == 0U || len > OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH) {
        return 0;
    }
    if (!((name[0] >= 'a' && name[0] <= 'z') || (name[0] >= 'A' && name[0] <= 'Z') ||
          (name[0] >= '0' && name[0] <= '9') || name[0] == '_')) {
        return 0;
    }
    for (i = 1U; i < len; i += 1) {
        unsigned char c = (unsigned char)name[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '+' ||
              c == '-')) {
            return 0;
        }
    }
    return 1;
}

static int is_ascii_case_equal(const char *lhs, const char *rhs) {
    size_t i = 0U;
    size_t lhs_len = strlen(lhs);
    size_t rhs_len = strlen(rhs);
    if (lhs_len != rhs_len) {
        return 0;
    }
    for (i = 0U; i < lhs_len; i += 1) {
        unsigned char a = (unsigned char)lhs[i];
        unsigned char b = (unsigned char)rhs[i];
        if (a >= 'A' && a <= 'Z') {
            a = (unsigned char)(a - 'A' + 'a');
        }
        if (b >= 'A' && b <= 'Z') {
            b = (unsigned char)(b - 'A' + 'a');
        }
        if (a != b) {
            return 0;
        }
    }
    return 1;
}

static int is_reserved_library_name(const char *name) {
    return is_ascii_case_equal(name, "c") || is_ascii_case_equal(name, "gcc") || is_ascii_case_equal(name, "gcc_eh");
}

static int is_valid_c_standard_value(const char *value) {
    return strcmp(value, "c90") == 0 || strcmp(value, "c99") == 0 || strcmp(value, "c11") == 0;
}

static int is_valid_warning_level_value(const char *value) {
    return strcmp(value, "default") == 0 || strcmp(value, "extra") == 0 || strcmp(value, "strict") == 0;
}

static int is_valid_optimization_value(const char *value) {
    return strcmp(value, "none") == 0 || strcmp(value, "debug") == 0 || strcmp(value, "release") == 0;
}

static int is_valid_debug_symbols_value(const char *value) {
    return strcmp(value, "yes") == 0 || strcmp(value, "no") == 0;
}

static int is_valid_toolchain_id_value(const char *value) {
    size_t i = 0U;
    size_t len = strlen(value);
    if (len == 0U || len > OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH) {
        return 0;
    }
    if (strncmp(value, "gcc-", 4) != 0) {
        return 0;
    }
    for (i = 4U; i < len; i += 1) {
        unsigned char c = (unsigned char)value[i];
        if (!((c >= '0' && c <= '9') || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int is_valid_toolchain_source_value(const char *value) {
    return strcmp(value, "default_active") == 0 || strcmp(value, "explicit") == 0;
}

static int is_valid_toolchain_family_value(const char *value) {
    return strcmp(value, "gcc") == 0;
}

static int is_valid_toolchain_driver_prefix_policy_value(const char *value) {
    return strcmp(value, "dual_b") == 0 || strcmp(value, "bin_only") == 0;
}

static int is_valid_toolchain_version_value(const char *value) {
    size_t i = 0U;
    size_t len = strlen(value);
    int dot_count = 0;
    if (len == 0U || len >= 32U) {
        return 0;
    }
    if (!(value[0] >= '0' && value[0] <= '9') || !(value[len - 1] >= '0' && value[len - 1] <= '9')) {
        return 0;
    }
    for (i = 0U; i < len; i += 1) {
        unsigned char c = (unsigned char)value[i];
        if (c == '.') {
            dot_count += 1;
            continue;
        }
        if (!(c >= '0' && c <= '9')) {
            return 0;
        }
    }
    return dot_count == 2 ? 1 : 0;
}

static int is_safe_toolchain_path_value(const char *value) {
    size_t i = 0U;
    size_t len = strlen(value);
    if (len == 0U || len > OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH) {
        return 0;
    }
    if (strstr(value, "/../") != NULL || strstr(value, "../") == value) {
        return 0;
    }
    for (i = 0U; i < len; i += 1) {
        unsigned char c = (unsigned char)value[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == ':' || c == '/' || c == '_' || c == '-' || c == '+' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static const char *resolve_compile_driver_token(const char *driver, const char *driver_prefix_policy) {
    const char *last_slash = NULL;
    if (driver == NULL || driver_prefix_policy == NULL) {
        return NULL;
    }
    if (strcmp(driver, "gcc") == 0) {
        return driver;
    }
    if (strcmp(driver_prefix_policy, "dual_b") != 0) {
        return driver;
    }
    last_slash = strrchr(driver, '/');
    if (last_slash != NULL && strcmp(last_slash + 1, "gcc") == 0) {
        return "gcc";
    }
    return driver;
}

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
}

static const char *classify_file_readable_status(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp != NULL) {
        fclose(fp);
        return "present";
    }
    if (errno == ENOENT || errno == ENOTDIR) {
        return "missing";
    }
    return "error";
}

static int file_exists_non_empty(const char *path) {
    FILE *fp = fopen(path, "rb");
    long size = 0L;
    if (fp == NULL) {
        return 0;
    }
    if (fseek(fp, 0L, SEEK_END) != 0) {
        fclose(fp);
        return 0;
    }
    size = ftell(fp);
    fclose(fp);
    return size > 0L ? 1 : 0;
}

static long file_size_bytes(const char *path) {
    FILE *fp = fopen(path, "rb");
    long size = -1L;
    if (fp == NULL) {
        return -1L;
    }
    if (fseek(fp, 0L, SEEK_END) == 0) {
        size = ftell(fp);
    }
    fclose(fp);
    return size;
}

static int write_text_file(const char *path, const char *text) {
    FILE *fp = fopen(path, "wb");
    if (fp == NULL) {
        return 1;
    }
    if (fputs(text, fp) == EOF) {
        fclose(fp);
        return 1;
    }
    return fclose(fp) == 0 ? 0 : 1;
}

static int append_file_to_file(const char *dst_path, const char *src_path) {
    FILE *src = fopen(src_path, "rb");
    FILE *dst = NULL;
    char buf[512];
    size_t n = 0U;
    if (src == NULL) {
        return 1;
    }
    dst = fopen(dst_path, "ab");
    if (dst == NULL) {
        fclose(src);
        return 1;
    }
    while ((n = fread(buf, 1U, sizeof(buf), src)) > 0U) {
        if (fwrite(buf, 1U, n, dst) != n) {
            fclose(src);
            fclose(dst);
            return 1;
        }
    }
    fclose(src);
    return fclose(dst) == 0 ? 0 : 1;
}

static int append_text_to_file(const char *dst_path, const char *text) {
    FILE *dst = fopen(dst_path, "ab");
    if (dst == NULL) {
        return 1;
    }
    if (fputs(text, dst) == EOF) {
        fclose(dst);
        return 1;
    }
    return fclose(dst) == 0 ? 0 : 1;
}

static int write_link_object_evidence(
    const char *path,
    int source_count,
    char object_names[OS4TB_GCC_PROJECT_MAX_SOURCES][200],
    int library_count,
    char library_names[OS4TB_GCC_PROJECT_MAX_LIBRARIES][OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH + 1]
) {
    FILE *fp = fopen(path, "wb");
    int i = 0;
    if (fp == NULL) {
        return 1;
    }
    (void)fprintf(fp, "OBJECT_COUNT=%d\n", source_count);
    for (i = 0; i < source_count; i += 1) {
        (void)fprintf(fp, "OBJECT_%d=%s\n", i, object_names[i]);
    }
    (void)fprintf(fp, "LIBRARY_COUNT=%d\n", library_count);
    for (i = 0; i < library_count; i += 1) {
        (void)fprintf(fp, "LIBRARY_%d=%s\n", i, library_names[i]);
    }
    if (fclose(fp) != 0) {
        return 1;
    }
    return 0;
}

static int run_command_capture_both(const char *command, const char *output_path) {
    BPTR out_fh = IDOS->Open((STRPTR)output_path, MODE_NEWFILE);
    LONG rc = 0;
    if (out_fh == ZERO) {
        return 127;
    }
    rc = IDOS->SystemTags(
        (STRPTR)command,
        SYS_Asynch,
        FALSE,
        SYS_UserShell,
        kUseUserShell ? TRUE : FALSE,
        SYS_Output,
        out_fh,
        SYS_Error,
        out_fh,
        TAG_DONE);
    IDOS->Close(out_fh);
    return (int)rc;
}

static int sb_init(StringBuilder *builder, char *buf, size_t cap) {
    if (cap == 0U) {
        return 1;
    }
    builder->buf = buf;
    builder->cap = cap;
    builder->used = 0U;
    builder->buf[0] = '\0';
    return 0;
}

static int sb_appendf(StringBuilder *builder, const char *fmt, ...) {
    int written = 0;
    va_list args;
    if (builder->used >= builder->cap) {
        return 1;
    }
    va_start(args, fmt);
    written = vsnprintf(builder->buf + builder->used, builder->cap - builder->used, fmt, args);
    va_end(args);
    if (written < 0) {
        return 1;
    }
    if ((size_t)written >= builder->cap - builder->used) {
        return 1;
    }
    builder->used += (size_t)written;
    return 0;
}

static int parse_nonnegative_int(const char *s, int *out) {
    long value = 0;
    char *endptr = NULL;
    if (s == NULL || *s == '\0') {
        return 1;
    }
    value = strtol(s, &endptr, 10);
    if (*endptr != '\0' || value < 0 || value > 1000000L) {
        return 1;
    }
    *out = (int)value;
    return 0;
}

static int join_with_slash(char *out, size_t out_size, const char *prefix, const char *name) {
    size_t prefix_len = strlen(prefix);
    size_t name_len = strlen(name);
    if (prefix_len == 0U || name_len == 0U) {
        return 1;
    }
    if (prefix_len + 1U + name_len + 1U > out_size) {
        return 1;
    }
    (void)memcpy(out, prefix, prefix_len);
    out[prefix_len] = '/';
    (void)memcpy(out + prefix_len + 1U, name, name_len);
    out[prefix_len + 1U + name_len] = '\0';
    return 0;
}

static int parse_project_manifest_file(
    const char *manifest_path,
    char source_names[OS4TB_GCC_PROJECT_MAX_SOURCES][240],
    char source_types[OS4TB_GCC_PROJECT_MAX_SOURCES][8],
    int *source_count_out,
    char header_names[OS4TB_GCC_PROJECT_MAX_HEADERS][240],
    int *header_count_out,
    char include_names[OS4TB_GCC_PROJECT_MAX_INCLUDES][240],
    int *include_count_out,
    char define_entries[OS4TB_GCC_PROJECT_MAX_DEFINES][OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH + 1],
    int *define_count_out,
    char library_names[OS4TB_GCC_PROJECT_MAX_LIBRARIES][OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH + 1],
    int *library_count_out,
    char c_standard_out[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH],
    char warning_level_out[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH],
    char optimization_out[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH],
    char debug_symbols_out[OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH],
    char toolchain_id_out[OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH + 1],
    char toolchain_source_out[32],
    char toolchain_family_out[32],
    char toolchain_version_out[32],
    char toolchain_driver_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_driver_prefix_policy_out[32],
    char toolchain_cc1_prefix_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_gcc_bin_prefix_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_internal_include_dirs_out[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS][OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    int *toolchain_internal_include_count_out,
    char toolchain_sdk_root_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_as_path_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_ld_path_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_runtime_libgcc_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_runtime_libgcc_eh_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_crtbegin_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_crtend_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char toolchain_library_dirs[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS][OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    int *toolchain_library_dir_count_out,
    char assembler_id_out[32],
    char assembler_family_out[32],
    char assembler_path_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char assembler_linker_model_out[32],
    char assembler_linker_path_out[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1],
    char run_program_out[4]
) {
    FILE *fp = fopen(manifest_path, "rb");
    char (*line_buf)[512] = &gProjectRunStorage.manifest_parse_line;
    int source_count = -1;
    int header_count = -1;
    int include_count = -1;
    int define_count = -1;
    int library_count = -1;
    int source_seen[OS4TB_GCC_PROJECT_MAX_SOURCES];
    int source_type_seen[OS4TB_GCC_PROJECT_MAX_SOURCES];
    int header_seen[OS4TB_GCC_PROJECT_MAX_HEADERS];
    int include_seen[OS4TB_GCC_PROJECT_MAX_INCLUDES];
    int define_seen[OS4TB_GCC_PROJECT_MAX_DEFINES];
    char define_names[OS4TB_GCC_PROJECT_MAX_DEFINES][OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH + 1];
    int library_seen[OS4TB_GCC_PROJECT_MAX_LIBRARIES];
    int i = 0;
    int seen_any_source = 0;
    int seen_any_header = 0;
    int seen_any_include = 0;
    int seen_any_define = 0;
    int seen_any_library = 0;
    int seen_c_standard = 0;
    int seen_warning_level = 0;
    int seen_optimization = 0;
    int seen_debug_symbols = 0;
    int seen_toolchain = 0;
    int seen_toolchain_source = 0;
    int seen_toolchain_family = 0;
    int seen_toolchain_version = 0;
    int seen_toolchain_driver = 0;
    int seen_toolchain_driver_prefix_policy = 0;
    int seen_toolchain_cc1_prefix = 0;
    int seen_toolchain_gcc_bin_prefix = 0;
    int seen_toolchain_internal_include_dir = 0;
    int toolchain_internal_include_count = -1;
    int toolchain_internal_include_seen[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS];
    char toolchain_internal_include_legacy[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    int seen_toolchain_sdk_root = 0;
    int seen_toolchain_as_path = 0;
    int seen_toolchain_ld_path = 0;
    int seen_toolchain_runtime_libgcc = 0;
    int seen_toolchain_runtime_libgcc_eh = 0;
    int seen_toolchain_crtbegin = 0;
    int seen_toolchain_crtend = 0;
    int seen_assembler_id = 0;
    int seen_assembler_family = 0;
    int seen_assembler_path = 0;
    int seen_assembler_linker_model = 0;
    int seen_assembler_linker_path = 0;
    int seen_run_program = 0;
    int toolchain_library_dir_count = -1;
    int toolchain_library_dir_seen[OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS];
    int asm_source_count = 0;

    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i += 1) {
        source_seen[i] = 0;
        source_type_seen[i] = 0;
        source_names[i][0] = '\0';
        (void)snprintf(source_types[i], 8, "%s", "c");
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_HEADERS; i += 1) {
        header_seen[i] = 0;
        header_names[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_INCLUDES; i += 1) {
        include_seen[i] = 0;
        include_names[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_DEFINES; i += 1) {
        define_seen[i] = 0;
        define_entries[i][0] = '\0';
        define_names[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_LIBRARIES; i += 1) {
        library_seen[i] = 0;
        library_names[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS; i += 1) {
        toolchain_library_dir_seen[i] = 0;
        toolchain_library_dirs[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS; i += 1) {
        toolchain_internal_include_seen[i] = 0;
        toolchain_internal_include_dirs_out[i][0] = '\0';
    }
    *source_count_out = 0;
    *header_count_out = 0;
    *include_count_out = 0;
    *define_count_out = 0;
    *library_count_out = 0;
    (void)snprintf(c_standard_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultCStandard);
    (void)snprintf(warning_level_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultWarningLevel);
    (void)snprintf(optimization_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultOptimization);
    (void)snprintf(debug_symbols_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultDebugSymbols);
    *toolchain_library_dir_count_out = 0;
    *toolchain_internal_include_count_out = 0;
    toolchain_id_out[0] = '\0';
    toolchain_source_out[0] = '\0';
    toolchain_family_out[0] = '\0';
    toolchain_version_out[0] = '\0';
    toolchain_driver_out[0] = '\0';
    toolchain_driver_prefix_policy_out[0] = '\0';
    toolchain_cc1_prefix_out[0] = '\0';
    toolchain_gcc_bin_prefix_out[0] = '\0';
    toolchain_internal_include_legacy[0] = '\0';
    toolchain_sdk_root_out[0] = '\0';
    toolchain_as_path_out[0] = '\0';
    toolchain_ld_path_out[0] = '\0';
    toolchain_runtime_libgcc_out[0] = '\0';
    toolchain_runtime_libgcc_eh_out[0] = '\0';
    toolchain_crtbegin_out[0] = '\0';
    toolchain_crtend_out[0] = '\0';
    assembler_id_out[0] = '\0';
    assembler_family_out[0] = '\0';
    assembler_path_out[0] = '\0';
    assembler_linker_model_out[0] = '\0';
    assembler_linker_path_out[0] = '\0';
    (void)snprintf(run_program_out, 4, "%s", "yes");

    if (fp == NULL) {
        return 1;
    }

    while (fgets(*line_buf, sizeof(*line_buf), fp) != NULL) {
        char *eq = NULL;
        char *key = *line_buf;
        char *value = NULL;
        size_t len = strlen(*line_buf);

        if (len == 0U) {
            fclose(fp);
            return 2;
        }
        if ((*line_buf)[len - 1U] != '\n' && !feof(fp)) {
            fclose(fp);
            return 2;
        }
        if ((*line_buf)[len - 1U] == '\n') {
            (*line_buf)[--len] = '\0';
        }
        if (len > 0U && (*line_buf)[len - 1U] == '\r') {
            (*line_buf)[--len] = '\0';
        }
        if (len == 0U) {
            continue;
        }

        eq = strchr(*line_buf, '=');
        if (eq == NULL || eq == key) {
            fclose(fp);
            return 2;
        }
        *eq = '\0';
        value = eq + 1;
        if (*value == '\0') {
            fclose(fp);
            return 2;
        }

        if (strcmp(key, "SOURCE_COUNT") == 0) {
            if (source_count >= 0) {
                fclose(fp);
                return 2;
            }
            if (parse_nonnegative_int(value, &source_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strcmp(key, "HEADER_COUNT") == 0) {
            if (header_count >= 0) {
                fclose(fp);
                return 2;
            }
            if (parse_nonnegative_int(value, &header_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strcmp(key, "INCLUDE_COUNT") == 0) {
            if (include_count >= 0) {
                fclose(fp);
                return 2;
            }
            if (parse_nonnegative_int(value, &include_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strcmp(key, "DEFINE_COUNT") == 0) {
            if (define_count >= 0) {
                fclose(fp);
                return 2;
            }
            if (parse_nonnegative_int(value, &define_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strcmp(key, "LIBRARY_COUNT") == 0) {
            if (library_count >= 0) {
                fclose(fp);
                return 2;
            }
            if (parse_nonnegative_int(value, &library_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strncmp(key, "SOURCE_TYPE_", 12) == 0) {
            int index = -1;
            if (parse_nonnegative_int(key + 12, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_SOURCES) {
                fclose(fp);
                return 3;
            }
            if (source_type_seen[index] || !is_valid_source_type(value)) {
                fclose(fp);
                return 2;
            }
            source_type_seen[index] = 1;
            (void)snprintf(source_types[index], 8, "%s", value);
        } else if (strncmp(key, "SOURCE_", 7) == 0) {
            const char *legacy_suffix = strstr(key + 7, "_TYPE");
            if (legacy_suffix != NULL && legacy_suffix[5] == '\0') {
                int index = -1;
                char index_text[16];
                size_t index_len = (size_t)(legacy_suffix - (key + 7));
                if (index_len == 0U || index_len >= sizeof(index_text)) {
                    fclose(fp);
                    return 2;
                }
                (void)memcpy(index_text, key + 7, index_len);
                index_text[index_len] = '\0';
                if (parse_nonnegative_int(index_text, &index) != 0) {
                    fclose(fp);
                    return 2;
                }
                if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_SOURCES) {
                    fclose(fp);
                    return 3;
                }
                if (source_type_seen[index] || !is_valid_source_type(value)) {
                    fclose(fp);
                    return 2;
                }
                source_type_seen[index] = 1;
                (void)snprintf(source_types[index], 8, "%s", value);
                continue;
            }
            {
                int index = -1;
                if (parse_nonnegative_int(key + 7, &index) != 0) {
                    fclose(fp);
                    return 2;
                }
                if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_SOURCES) {
                    fclose(fp);
                    return 3;
                }
                if (source_seen[index]) {
                    fclose(fp);
                    return 4;
                }
                if (!is_safe_relative_project_path(value)) {
                    fclose(fp);
                    return 5;
                }
                source_seen[index] = 1;
                seen_any_source = 1;
                (void)snprintf(source_names[index], 240, "%s", value);
            }
        } else if (strncmp(key, "HEADER_", 7) == 0) {
            int index = -1;
            if (parse_nonnegative_int(key + 7, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_HEADERS) {
                fclose(fp);
                return 3;
            }
            if (header_seen[index]) {
                fclose(fp);
                return 4;
            }
            if (!is_safe_relative_h_path(value)) {
                fclose(fp);
                return 5;
            }
            header_seen[index] = 1;
            seen_any_header = 1;
            (void)snprintf(header_names[index], 240, "%s", value);
        } else if (strncmp(key, "INCLUDE_", 8) == 0) {
            int index = -1;
            if (parse_nonnegative_int(key + 8, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_INCLUDES) {
                fclose(fp);
                return 3;
            }
            if (include_seen[index]) {
                fclose(fp);
                return 4;
            }
            if (!is_safe_relative_project_path(value) || has_extension(value, ".c") || has_extension(value, ".h")) {
                fclose(fp);
                return 5;
            }
            include_seen[index] = 1;
            seen_any_include = 1;
            (void)snprintf(include_names[index], 240, "%s", value);
        } else if (strncmp(key, "DEFINE_", 7) == 0) {
            int index = -1;
            char parsed_name[OS4TB_GCC_PROJECT_DEFINE_NAME_MAX_LENGTH + 1];
            int duplicate_name = 0;
            int j = 0;
            if (parse_nonnegative_int(key + 7, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_DEFINES) {
                fclose(fp);
                return 3;
            }
            if (define_seen[index]) {
                fclose(fp);
                return 4;
            }
            if (strlen(value) > OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH || parse_define_entry(value, parsed_name, sizeof(parsed_name)) != 0) {
                fclose(fp);
                return 5;
            }
            for (j = 0; j < OS4TB_GCC_PROJECT_MAX_DEFINES; j += 1) {
                if (define_seen[j] && strcmp(define_names[j], parsed_name) == 0) {
                    duplicate_name = 1;
                    break;
                }
            }
            if (duplicate_name) {
                fclose(fp);
                return 4;
            }
            define_seen[index] = 1;
            seen_any_define = 1;
            (void)snprintf(define_entries[index], OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH + 1, "%s", value);
            (void)snprintf(define_names[index], sizeof(define_names[index]), "%s", parsed_name);
        } else if (strncmp(key, "LIBRARY_", 8) == 0) {
            int index = -1;
            int j = 0;
            if (parse_nonnegative_int(key + 8, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_LIBRARIES) {
                fclose(fp);
                return 3;
            }
            if (library_seen[index]) {
                fclose(fp);
                return 4;
            }
            if (!is_valid_library_name(value) || is_reserved_library_name(value)) {
                fclose(fp);
                return 5;
            }
            for (j = 0; j < OS4TB_GCC_PROJECT_MAX_LIBRARIES; j += 1) {
                if (library_seen[j] && strcmp(library_names[j], value) == 0) {
                    fclose(fp);
                    return 4;
                }
            }
            library_seen[index] = 1;
            seen_any_library = 1;
            (void)snprintf(library_names[index], OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "C_STANDARD") == 0) {
            if (seen_c_standard || !is_valid_c_standard_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_c_standard = 1;
            (void)snprintf(c_standard_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", value);
        } else if (strcmp(key, "WARNING_LEVEL") == 0) {
            if (seen_warning_level || !is_valid_warning_level_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_warning_level = 1;
            (void)snprintf(warning_level_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", value);
        } else if (strcmp(key, "OPTIMIZATION") == 0) {
            if (seen_optimization || !is_valid_optimization_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_optimization = 1;
            (void)snprintf(optimization_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", value);
        } else if (strcmp(key, "DEBUG_SYMBOLS") == 0) {
            if (seen_debug_symbols || !is_valid_debug_symbols_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_debug_symbols = 1;
            (void)snprintf(debug_symbols_out, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN") == 0) {
            if (seen_toolchain || !is_valid_toolchain_id_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain = 1;
            (void)snprintf(toolchain_id_out, OS4TB_GCC_PROJECT_TOOLCHAIN_ID_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_SOURCE") == 0) {
            if (seen_toolchain_source || !is_valid_toolchain_source_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_source = 1;
            (void)snprintf(toolchain_source_out, 32, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_FAMILY") == 0) {
            if (seen_toolchain_family || !is_valid_toolchain_family_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_family = 1;
            (void)snprintf(toolchain_family_out, 32, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_VERSION") == 0) {
            if (seen_toolchain_version || !is_valid_toolchain_version_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_version = 1;
            (void)snprintf(toolchain_version_out, 32, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_DRIVER") == 0) {
            if (seen_toolchain_driver || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_driver = 1;
            (void)snprintf(toolchain_driver_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_DRIVER_PREFIX_POLICY") == 0) {
            if (seen_toolchain_driver_prefix_policy || !is_valid_toolchain_driver_prefix_policy_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_driver_prefix_policy = 1;
            (void)snprintf(toolchain_driver_prefix_policy_out, 32, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_CC1_PREFIX") == 0) {
            if (seen_toolchain_cc1_prefix || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_cc1_prefix = 1;
            (void)snprintf(toolchain_cc1_prefix_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_GCC_BIN_PREFIX") == 0) {
            if (seen_toolchain_gcc_bin_prefix || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_gcc_bin_prefix = 1;
            (void)snprintf(toolchain_gcc_bin_prefix_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_INTERNAL_INCLUDE_COUNT") == 0) {
            if (toolchain_internal_include_count >= 0 || parse_nonnegative_int(value, &toolchain_internal_include_count) != 0) {
                fclose(fp);
                return 2;
            }
            if (toolchain_internal_include_count < 1 ||
                toolchain_internal_include_count > OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS) {
                fclose(fp);
                return 3;
            }
        } else if (strncmp(key, "TOOLCHAIN_INTERNAL_INCLUDE_", 27) == 0) {
            int index = -1;
            if (parse_nonnegative_int(key + 27, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS) {
                fclose(fp);
                return 3;
            }
            if (toolchain_internal_include_seen[index] || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 4;
            }
            toolchain_internal_include_seen[index] = 1;
            (void)snprintf(
                toolchain_internal_include_dirs_out[index],
                OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
                "%s",
                value);
        } else if (strcmp(key, "TOOLCHAIN_INTERNAL_INCLUDE_DIR") == 0) {
            if (seen_toolchain_internal_include_dir || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_internal_include_dir = 1;
            (void)snprintf(
                toolchain_internal_include_legacy,
                OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
                "%s",
                value);
        } else if (strcmp(key, "TOOLCHAIN_SDK_ROOT") == 0) {
            if (seen_toolchain_sdk_root || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_sdk_root = 1;
            (void)snprintf(
                toolchain_sdk_root_out,
                OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
                "%s",
                value);
        } else if (strcmp(key, "TOOLCHAIN_AS_PATH") == 0) {
            if (seen_toolchain_as_path || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_as_path = 1;
            (void)snprintf(toolchain_as_path_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_LD_PATH") == 0) {
            if (seen_toolchain_ld_path || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_ld_path = 1;
            (void)snprintf(toolchain_ld_path_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_RUNTIME_LIBGCC") == 0) {
            if (seen_toolchain_runtime_libgcc || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_runtime_libgcc = 1;
            (void)snprintf(toolchain_runtime_libgcc_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_RUNTIME_LIBGCC_EH") == 0) {
            if (seen_toolchain_runtime_libgcc_eh || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_runtime_libgcc_eh = 1;
            (void)snprintf(
                toolchain_runtime_libgcc_eh_out,
                OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
                "%s",
                value);
        } else if (strcmp(key, "TOOLCHAIN_CRTBEGIN") == 0) {
            if (seen_toolchain_crtbegin || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_crtbegin = 1;
            (void)snprintf(toolchain_crtbegin_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_CRTEND") == 0) {
            if (seen_toolchain_crtend || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_toolchain_crtend = 1;
            (void)snprintf(toolchain_crtend_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "ASSEMBLER_ID") == 0) {
            if (seen_assembler_id || !is_valid_assembler_id_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_assembler_id = 1;
            (void)snprintf(assembler_id_out, 32, "%s", value);
        } else if (strcmp(key, "ASSEMBLER_FAMILY") == 0) {
            if (seen_assembler_family || !is_valid_assembler_family_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_assembler_family = 1;
            (void)snprintf(assembler_family_out, 32, "%s", value);
        } else if (strcmp(key, "ASSEMBLER_PATH") == 0) {
            if (seen_assembler_path || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_assembler_path = 1;
            (void)snprintf(assembler_path_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "LINKER_MODEL") == 0) {
            if (seen_assembler_linker_model || strcmp(value, "vlink") != 0) {
                fclose(fp);
                return 2;
            }
            seen_assembler_linker_model = 1;
            (void)snprintf(assembler_linker_model_out, 32, "%s", value);
        } else if (strcmp(key, "LINKER_PATH") == 0) {
            if (seen_assembler_linker_path || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 2;
            }
            seen_assembler_linker_path = 1;
            (void)snprintf(assembler_linker_path_out, OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1, "%s", value);
        } else if (strcmp(key, "RUN_PROGRAM") == 0) {
            if (seen_run_program || (strcmp(value, "yes") != 0 && strcmp(value, "no") != 0)) {
                fclose(fp);
                return 2;
            }
            seen_run_program = 1;
            (void)snprintf(run_program_out, 4, "%s", value);
        } else if (strcmp(key, "TOOLCHAIN_LIBRARY_DIR_COUNT") == 0) {
            if (toolchain_library_dir_count >= 0 || parse_nonnegative_int(value, &toolchain_library_dir_count) != 0) {
                fclose(fp);
                return 2;
            }
        } else if (strncmp(key, "TOOLCHAIN_LIBRARY_DIR_", 22) == 0) {
            int index = -1;
            if (parse_nonnegative_int(key + 22, &index) != 0) {
                fclose(fp);
                return 2;
            }
            if (index < 0 || index >= OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS) {
                fclose(fp);
                return 3;
            }
            if (toolchain_library_dir_seen[index] || !is_safe_toolchain_path_value(value)) {
                fclose(fp);
                return 4;
            }
            toolchain_library_dir_seen[index] = 1;
            (void)snprintf(
                toolchain_library_dirs[index],
                OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
                "%s",
                value);
        } else {
            fclose(fp);
            return 2;
        }
    }
    fclose(fp);

    if (!seen_any_source || source_count < OS4TB_GCC_PROJECT_MIN_SOURCES || source_count > OS4TB_GCC_PROJECT_MAX_SOURCES) {
        return 3;
    }
    if (header_count < 0 || header_count > OS4TB_GCC_PROJECT_MAX_HEADERS) {
        return 3;
    }
    if (include_count < 0 || include_count > OS4TB_GCC_PROJECT_MAX_INCLUDES) {
        return 3;
    }
    if (define_count < 0 || define_count > OS4TB_GCC_PROJECT_MAX_DEFINES) {
        return 3;
    }
    if (library_count < 0 || library_count > OS4TB_GCC_PROJECT_MAX_LIBRARIES) {
        return 3;
    }
    for (i = 0; i < source_count; i += 1) {
        if (!source_seen[i]) {
            return 3;
        }
    }
    for (i = source_count; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i += 1) {
        if (source_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < source_count; i += 1) {
        if (!source_type_seen[i]) {
            if (has_extension(source_names[i], ".c")) {
                source_type_seen[i] = 1;
                (void)snprintf(source_types[i], 8, "%s", "c");
            } else if (has_extension(source_names[i], ".s")) {
                source_type_seen[i] = 1;
                (void)snprintf(source_types[i], 8, "%s", "asm");
            } else {
                return 3;
            }
        }
        if (strcmp(source_types[i], "c") == 0) {
            if (!is_safe_relative_c_path(source_names[i])) {
                return 5;
            }
        } else if (strcmp(source_types[i], "asm") == 0) {
            if (!is_safe_relative_asm_path(source_names[i])) {
                return 5;
            }
            asm_source_count += 1;
        } else {
            return 3;
        }
    }
    for (i = source_count; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i += 1) {
        if (source_type_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < header_count; i += 1) {
        if (!header_seen[i]) {
            return 3;
        }
    }
    for (i = header_count; i < OS4TB_GCC_PROJECT_MAX_HEADERS; i += 1) {
        if (header_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < include_count; i += 1) {
        if (!include_seen[i]) {
            return 3;
        }
    }
    for (i = include_count; i < OS4TB_GCC_PROJECT_MAX_INCLUDES; i += 1) {
        if (include_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < define_count; i += 1) {
        if (!define_seen[i]) {
            return 3;
        }
    }
    for (i = define_count; i < OS4TB_GCC_PROJECT_MAX_DEFINES; i += 1) {
        if (define_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < library_count; i += 1) {
        if (!library_seen[i]) {
            return 3;
        }
    }
    for (i = library_count; i < OS4TB_GCC_PROJECT_MAX_LIBRARIES; i += 1) {
        if (library_seen[i]) {
            return 3;
        }
    }
    if (!seen_any_header && header_count != 0) {
        return 3;
    }
    if (!seen_any_include && include_count != 0) {
        return 3;
    }
    if (!seen_any_define && define_count != 0) {
        return 3;
    }
    if (!seen_any_library && library_count != 0) {
        return 3;
    }
    if (!seen_toolchain || !seen_toolchain_source || !seen_toolchain_family || !seen_toolchain_version ||
        !seen_toolchain_driver || !seen_toolchain_driver_prefix_policy ||
        !seen_toolchain_cc1_prefix || !seen_toolchain_gcc_bin_prefix ||
        !seen_toolchain_as_path || !seen_toolchain_ld_path || !seen_toolchain_runtime_libgcc ||
        !seen_toolchain_runtime_libgcc_eh || !seen_toolchain_crtbegin || !seen_toolchain_crtend) {
        return 3;
    }
    if (seen_toolchain_internal_include_dir && toolchain_internal_include_count >= 0) {
        return 2;
    }
    if (!seen_toolchain_internal_include_dir && toolchain_internal_include_count < 0) {
        return 3;
    }
    if (seen_toolchain_internal_include_dir) {
        toolchain_internal_include_count = 1;
        (void)snprintf(
            toolchain_internal_include_dirs_out[0],
            OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1,
            "%s",
            toolchain_internal_include_legacy);
        toolchain_internal_include_seen[0] = 1;
    }
    for (i = 0; i < toolchain_internal_include_count; i += 1) {
        if (!toolchain_internal_include_seen[i]) {
            return 3;
        }
    }
    for (i = toolchain_internal_include_count; i < OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS; i += 1) {
        if (toolchain_internal_include_seen[i]) {
            return 3;
        }
    }
    if (asm_source_count > 0 &&
        (!seen_assembler_id || !seen_assembler_family || !seen_assembler_path ||
         !seen_assembler_linker_model || !seen_assembler_linker_path)) {
        return 3;
    }
    if (asm_source_count == 0 &&
        (seen_assembler_id || seen_assembler_family || seen_assembler_path ||
         seen_assembler_linker_model || seen_assembler_linker_path)) {
        return 3;
    }
    if (toolchain_library_dir_count < 0 || toolchain_library_dir_count > OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS) {
        return 3;
    }
    for (i = 0; i < toolchain_library_dir_count; i += 1) {
        if (!toolchain_library_dir_seen[i]) {
            return 3;
        }
    }
    for (i = toolchain_library_dir_count; i < OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_LIBRARY_DIRS; i += 1) {
        if (toolchain_library_dir_seen[i]) {
            return 3;
        }
    }
    for (i = 0; i < source_count; i += 1) {
        int j = 0;
        for (j = 0; j < header_count; j += 1) {
            size_t source_len = strlen(source_names[i]);
            size_t header_len = strlen(header_names[j]);
            if (source_len > 2U && header_len > 2U &&
                strncmp(source_names[i], header_names[j], source_len - 2U) == 0 &&
                (source_len - 2U) == (header_len - 2U)) {
                return 4;
            }
        }
    }
    for (i = 0; i < header_count; i += 1) {
        int j = 0;
        for (j = 0; j < header_count; j += 1) {
            if (i != j && strcmp(header_names[i], header_names[j]) == 0) {
                return 4;
            }
        }
    }
    *source_count_out = source_count;
    *header_count_out = header_count;
    *include_count_out = include_count;
    *define_count_out = define_count;
    *library_count_out = library_count;
    *toolchain_library_dir_count_out = toolchain_library_dir_count;
    *toolchain_internal_include_count_out = toolchain_internal_include_count;
    return 0;
}

int main(int argc, char **argv) {
    const char *artifact_name = "phase7e_gcc_project_build_run.artifact";
    char request_id[96];
    char project_dir_name[140];
    char project_dir_path[640];
    char manifest_name[180];
    char manifest_path[640];
    char(*source_names)[240] = gProjectRunStorage.source_names;
    char(*source_types)[8] = gProjectRunStorage.source_types;
    char(*header_names)[240] = gProjectRunStorage.header_names;
    char(*include_names)[240] = gProjectRunStorage.include_names;
    char(*define_entries)[OS4TB_GCC_PROJECT_MAX_DEFINE_ENTRY_LENGTH + 1] = gProjectRunStorage.define_entries;
    char(*library_names)[OS4TB_GCC_PROJECT_LIBRARY_NAME_MAX_LENGTH + 1] = gProjectRunStorage.library_names;
    char(*source_paths)[640] = gProjectRunStorage.source_paths;
    char(*header_paths)[640] = gProjectRunStorage.header_paths;
    char(*include_paths)[640] = gProjectRunStorage.include_paths;
    char(*object_names)[200] = gProjectRunStorage.object_names;
    char(*compile_output_names)[240] = gProjectRunStorage.compile_output_names;
    char(*compile_command_output_names)[280] = gProjectRunStorage.compile_command_output_names;
    char executable_name[128];
    char diagnostics_name[180];
    char link_output_name[220];
    char link_object_file_name[240];
    char program_output_name[180];
    char *command_buf = gProjectRunStorage.command_buf;
    char *project_c_standard = gProjectRunStorage.project_c_standard;
    char *project_warning_level = gProjectRunStorage.project_warning_level;
    char *project_optimization = gProjectRunStorage.project_optimization;
    char *project_debug_symbols = gProjectRunStorage.project_debug_symbols;
    char *project_toolchain_id = gProjectRunStorage.project_toolchain_id;
    char *project_toolchain_source = gProjectRunStorage.project_toolchain_source;
    char *project_toolchain_family = gProjectRunStorage.project_toolchain_family;
    char *project_toolchain_version = gProjectRunStorage.project_toolchain_version;
    char *project_toolchain_driver = gProjectRunStorage.project_toolchain_driver;
    char *project_toolchain_driver_prefix_policy = gProjectRunStorage.project_toolchain_driver_prefix_policy;
    char *project_toolchain_cc1_prefix = gProjectRunStorage.project_toolchain_cc1_prefix;
    char *project_toolchain_gcc_bin_prefix = gProjectRunStorage.project_toolchain_gcc_bin_prefix;
    char(*project_toolchain_internal_include_dirs)[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1] =
        gProjectRunStorage.project_toolchain_internal_include_dirs;
    char *project_toolchain_sdk_root = gProjectRunStorage.project_toolchain_sdk_root;
    char *project_toolchain_as_path = gProjectRunStorage.project_toolchain_as_path;
    char *project_toolchain_ld_path = gProjectRunStorage.project_toolchain_ld_path;
    char *project_toolchain_runtime_libgcc = gProjectRunStorage.project_toolchain_runtime_libgcc;
    char *project_toolchain_runtime_libgcc_eh = gProjectRunStorage.project_toolchain_runtime_libgcc_eh;
    char *project_toolchain_crtbegin = gProjectRunStorage.project_toolchain_crtbegin;
    char *project_toolchain_crtend = gProjectRunStorage.project_toolchain_crtend;
    char *project_assembler_id = gProjectRunStorage.project_assembler_id;
    char *project_assembler_family = gProjectRunStorage.project_assembler_family;
    char *project_assembler_path = gProjectRunStorage.project_assembler_path;
    char *project_assembler_linker_model = gProjectRunStorage.project_assembler_linker_model;
    char *project_assembler_linker_path = gProjectRunStorage.project_assembler_linker_path;
    char run_program_mode[4];
    char active_linker_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char toolchain_mui_include_dir[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
    char(*project_toolchain_library_dirs)[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1] =
        gProjectRunStorage.project_toolchain_library_dirs;
    char(*source_status)[16] = gProjectRunStorage.source_status;
    int *compile_exit = gProjectRunStorage.compile_exit;
    int header_count = 0;
    int include_count = 0;
    int define_count = 0;
    int library_count = 0;
    int source_count = 0;
    int toolchain_library_dir_count = 0;
    int toolchain_internal_include_count = 0;
    int compile_stop_index = -1;
    int compile_rc = 127;
    int build_rc = 127;
    int direct_link_rc = 127;
    int program_rc = -1;
    int cc1_found = 0;
    int as_found = 0;
    int toolchain_ready = 0;
    int executable_present = 0;
    int link_attempted = 0;
    int has_asm_source = 0;
    int toolchain_mui_include_ready = 0;
    int run_program_enabled = 1;
    int execution_skipped = 0;
    int i = 0;
    const char *manifest_status = "missing";
    const char *direct_libgcc_status = "missing";
    const char *direct_libgcc_eh_status = "missing";
    long direct_libgcc_size = -1L;
    long direct_libgcc_eh_size = -1L;
    const char *direct_link_final = "NOT_RUN";
    const char *direct_link_exec_status = "missing";
    const char *build_final = "FAIL";
    const char *program_final = "NOT_RUN";
    const char *project_build_final = "FAIL";
    const char *command_buffer_status = "ok";
    FILE *artifact_fp = NULL;
    size_t artifact_len = 0U;

    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }
    if (!is_safe_basename(artifact_name)) {
        return 7;
    }
    reset_project_run_storage();
    artifact_len = strlen(artifact_name);
    if (artifact_len <= strlen(".artifact") ||
        strcmp(artifact_name + artifact_len - strlen(".artifact"), ".artifact") != 0) {
        return 8;
    }

    (void)snprintf(request_id, sizeof(request_id), "%s", artifact_name);
    request_id[artifact_len - strlen(".artifact")] = '\0';
    if (!is_safe_basename(request_id)) {
        return 9;
    }

    (void)snprintf(project_dir_name, sizeof(project_dir_name), "project_%s", request_id);
    (void)snprintf(project_dir_path, sizeof(project_dir_path), "SAMDROP:incoming/%s", project_dir_name);
    (void)snprintf(manifest_name, sizeof(manifest_name), "%s", "project_manifest.txt");
    if (!is_safe_basename(project_dir_name) || !is_safe_basename(manifest_name)) {
        return 10;
    }
    if (join_with_slash(manifest_path, sizeof(manifest_path), project_dir_path, manifest_name) != 0) {
        return 10;
    }

    (void)snprintf(executable_name, sizeof(executable_name), "build_%s", request_id);
    (void)snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.gcc.txt", artifact_name);
    (void)snprintf(link_output_name, sizeof(link_output_name), "%s.project-link.txt", artifact_name);
    (void)snprintf(link_object_file_name, sizeof(link_object_file_name), "%s.project-link-command.txt", artifact_name);
    (void)snprintf(program_output_name, sizeof(program_output_name), "%s.program.txt", artifact_name);
    if (!is_safe_basename(executable_name) || !is_safe_basename(diagnostics_name) ||
        !is_safe_basename(link_output_name) || !is_safe_basename(link_object_file_name) ||
        !is_safe_basename(program_output_name)) {
        return 10;
    }

    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_SOURCES; i += 1) {
        source_names[i][0] = '\0';
        (void)snprintf(source_types[i], 8, "%s", "c");
        source_paths[i][0] = '\0';
        object_names[i][0] = '\0';
        compile_output_names[i][0] = '\0';
        compile_command_output_names[i][0] = '\0';
        (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "not_checked");
        compile_exit[i] = 127;
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_HEADERS; i += 1) {
        header_names[i][0] = '\0';
        header_paths[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_INCLUDES; i += 1) {
        include_names[i][0] = '\0';
        include_paths[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_DEFINES; i += 1) {
        define_entries[i][0] = '\0';
    }
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_LIBRARIES; i += 1) {
        library_names[i][0] = '\0';
    }
    (void)snprintf(project_c_standard, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultCStandard);
    (void)snprintf(project_warning_level, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultWarningLevel);
    (void)snprintf(project_optimization, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultOptimization);
    (void)snprintf(project_debug_symbols, OS4TB_GCC_PROJECT_PROFILE_VALUE_MAX_LENGTH, "%s", kProjectDefaultDebugSymbols);
    project_toolchain_id[0] = '\0';
    project_toolchain_source[0] = '\0';
    project_toolchain_family[0] = '\0';
    project_toolchain_version[0] = '\0';
    project_toolchain_driver[0] = '\0';
    project_toolchain_driver_prefix_policy[0] = '\0';
    project_toolchain_cc1_prefix[0] = '\0';
    project_toolchain_gcc_bin_prefix[0] = '\0';
    for (i = 0; i < OS4TB_GCC_PROJECT_MAX_TOOLCHAIN_INTERNAL_INCLUDE_DIRS; i += 1) {
        project_toolchain_internal_include_dirs[i][0] = '\0';
    }
    project_toolchain_sdk_root[0] = '\0';
    project_toolchain_as_path[0] = '\0';
    project_toolchain_ld_path[0] = '\0';
    project_toolchain_runtime_libgcc[0] = '\0';
    project_toolchain_runtime_libgcc_eh[0] = '\0';
    project_toolchain_crtbegin[0] = '\0';
    project_toolchain_crtend[0] = '\0';
    project_assembler_id[0] = '\0';
    project_assembler_family[0] = '\0';
    project_assembler_path[0] = '\0';
    project_assembler_linker_model[0] = '\0';
    project_assembler_linker_path[0] = '\0';
    (void)snprintf(run_program_mode, sizeof(run_program_mode), "%s", "yes");
    active_linker_path[0] = '\0';
    toolchain_mui_include_dir[0] = '\0';
    project_toolchain_library_dirs[0][0] = '\0';
    toolchain_library_dir_count = 0;

    if (write_text_file(diagnostics_name, "") != 0) {
        return 2;
    }
    (void)write_text_file(link_output_name, "");
    (void)write_text_file(link_object_file_name, "");

    cc1_found = 0;
    as_found = 0;
    toolchain_ready = 0;
    direct_libgcc_status = "missing";
    direct_libgcc_eh_status = "missing";
    direct_libgcc_size = -1L;
    direct_libgcc_eh_size = -1L;

    if (file_is_readable(manifest_path)) {
        int parse_rc = parse_project_manifest_file(
            manifest_path,
            source_names,
            source_types,
            &source_count,
            header_names,
            &header_count,
            include_names,
            &include_count,
            define_entries,
            &define_count,
            library_names,
            &library_count,
            project_c_standard,
            project_warning_level,
            project_optimization,
            project_debug_symbols,
            project_toolchain_id,
            project_toolchain_source,
            project_toolchain_family,
            project_toolchain_version,
            project_toolchain_driver,
            project_toolchain_driver_prefix_policy,
            project_toolchain_cc1_prefix,
            project_toolchain_gcc_bin_prefix,
            project_toolchain_internal_include_dirs,
            &toolchain_internal_include_count,
            project_toolchain_sdk_root,
            project_toolchain_as_path,
            project_toolchain_ld_path,
            project_toolchain_runtime_libgcc,
            project_toolchain_runtime_libgcc_eh,
            project_toolchain_crtbegin,
            project_toolchain_crtend,
            project_toolchain_library_dirs,
            &toolchain_library_dir_count,
            project_assembler_id,
            project_assembler_family,
            project_assembler_path,
            project_assembler_linker_model,
            project_assembler_linker_path,
            run_program_mode);
        if (parse_rc == 0) {
            manifest_status = "present";
            run_program_enabled = strcmp(run_program_mode, "no") != 0;
            has_asm_source = 0;
            for (i = 0; i < source_count; i += 1) {
                if (strcmp(source_types[i], "asm") == 0) {
                    has_asm_source = 1;
                    break;
                }
            }
            {
                char cc1_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 4];
                (void)snprintf(cc1_path, sizeof(cc1_path), "%scc1", project_toolchain_cc1_prefix);
                cc1_found = file_is_readable(cc1_path);
            }
            as_found = file_is_readable(project_toolchain_as_path);
            toolchain_ready = (cc1_found && as_found) ? 1 : 0;
            toolchain_mui_include_ready = 0;
            toolchain_mui_include_dir[0] = '\0';
            if (project_toolchain_sdk_root[0] != '\0') {
                char mui_header_path[OS4TB_GCC_PROJECT_TOOLCHAIN_TEXT_MAX_LENGTH + 1];
                if (join_with_slash(
                        toolchain_mui_include_dir,
                        sizeof(toolchain_mui_include_dir),
                        project_toolchain_sdk_root,
                        "MUI/C/include") == 0 &&
                    join_with_slash(
                        mui_header_path,
                        sizeof(mui_header_path),
                        toolchain_mui_include_dir,
                        "libraries/mui.h") == 0 &&
                    file_is_readable(mui_header_path)) {
                    toolchain_mui_include_ready = 1;
                } else {
                    toolchain_mui_include_dir[0] = '\0';
                }
            }
            direct_libgcc_status = classify_file_readable_status(project_toolchain_runtime_libgcc);
            direct_libgcc_eh_status = classify_file_readable_status(project_toolchain_runtime_libgcc_eh);
            direct_libgcc_size = file_size_bytes(project_toolchain_runtime_libgcc);
            direct_libgcc_eh_size = file_size_bytes(project_toolchain_runtime_libgcc_eh);
        } else {
            char parse_note[96];
            manifest_status = "invalid";
            (void)snprintf(parse_note, sizeof(parse_note), "project manifest parse_rc=%d\n", parse_rc);
            (void)append_text_to_file(diagnostics_name, parse_note);
            (void)append_text_to_file(diagnostics_name, "project manifest invalid; skipping project build\n");
        }
    } else {
        manifest_status = "missing";
        (void)append_text_to_file(diagnostics_name, "project manifest missing; skipping project build\n");
    }

    if (toolchain_ready && strcmp(manifest_status, "present") == 0) {
        for (i = 0; i < source_count; i += 1) {
            if (join_with_slash(source_paths[i], sizeof(source_paths[i]), project_dir_path, source_names[i]) != 0) {
                (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "invalid");
                compile_exit[i] = 127;
                compile_stop_index = i;
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project source path build failed; skipping project build\n");
                break;
            }
            (void)snprintf(object_names[i], sizeof(object_names[i]), "build_%s_source%d.o", request_id, i);
            (void)snprintf(compile_output_names[i], sizeof(compile_output_names[i]), "%s.project-compile-%d.txt", artifact_name, i);
            (void)snprintf(
                compile_command_output_names[i],
                sizeof(compile_command_output_names[i]),
                "%s.project-compile-command-%d.txt",
                artifact_name,
                i);
            if (!is_safe_basename(object_names[i]) ||
                !is_safe_basename(compile_output_names[i]) || !is_safe_basename(compile_command_output_names[i])) {
                (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "invalid");
                compile_exit[i] = 127;
                compile_stop_index = i;
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "unsafe project source/object name; skipping project build\n");
                break;
            }
            if ((strcmp(source_types[i], "c") == 0 && !is_safe_relative_c_path(source_names[i])) ||
                (strcmp(source_types[i], "asm") == 0 && !is_safe_relative_asm_path(source_names[i])) ||
                (strcmp(source_types[i], "c") != 0 && strcmp(source_types[i], "asm") != 0)) {
                (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "invalid");
                compile_exit[i] = 127;
                compile_stop_index = i;
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project source/type mismatch; skipping project build\n");
                break;
            }
        }
        for (i = 0; i < header_count && compile_stop_index < 0; i += 1) {
            if (join_with_slash(header_paths[i], sizeof(header_paths[i]), project_dir_path, header_names[i]) != 0) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project header path build failed; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
            if (!is_safe_relative_h_path(header_names[i])) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "unsafe project header name; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
            if (!file_is_readable(header_paths[i])) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project header missing; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
        }
        for (i = 0; i < include_count && compile_stop_index < 0; i += 1) {
            struct stat include_stat;
            if (join_with_slash(include_paths[i], sizeof(include_paths[i]), project_dir_path, include_names[i]) != 0) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project include path build failed; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
            if (!is_safe_relative_project_path(include_names[i])) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "unsafe project include path; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
            if (stat(include_paths[i], &include_stat) != 0 || (include_stat.st_mode & S_IFDIR) == 0) {
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project include directory missing; skipping project build\n");
                compile_stop_index = 0;
                break;
            }
        }

        if (compile_stop_index < 0 &&
            write_link_object_evidence(link_object_file_name, source_count, object_names, library_count, library_names) != 0) {
            build_rc = 127;
            (void)append_text_to_file(diagnostics_name, "project link object evidence write failed\n");
            compile_stop_index = 0;
        }

        for (i = 0; i < source_count && compile_stop_index < 0; i += 1) {
            if (!file_is_readable(source_paths[i])) {
                (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "missing");
                compile_exit[i] = 127;
                compile_stop_index = i;
                build_rc = 127;
                (void)append_text_to_file(diagnostics_name, "project source missing; skipping project build\n");
                break;
            }
            (void)snprintf(source_status[i], sizeof(source_status[i]), "%s", "present");
            (void)write_text_file(compile_output_names[i], "");
            (void)write_text_file(compile_command_output_names[i], "");
            compile_rc = 127;
            {
                StringBuilder compile_builder;
                if (strcmp(source_types[i], "asm") == 0) {
                    if (strcmp(project_assembler_family, "gnu_as") == 0) {
                        if (sb_init(&compile_builder, command_buf, OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE) != 0 ||
                            sb_appendf(&compile_builder, "%s --defsym __amigaos4__=1 -I%s ", project_assembler_path, project_dir_path) != 0 ||
                            sb_appendf(&compile_builder, "-o %s %s", object_names[i], source_paths[i]) != 0) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "assemble command construction failed\n");
                            break;
                        }
                    } else if (strcmp(project_assembler_family, "vasm") == 0) {
                        if (sb_init(&compile_builder, command_buf, OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE) != 0 ||
                            sb_appendf(&compile_builder, "%s -Felf -I%s ", project_assembler_path, project_dir_path) != 0 ||
                            sb_appendf(&compile_builder, "-o %s %s", object_names[i], source_paths[i]) != 0) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "assemble command construction failed\n");
                            break;
                        }
                    } else {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "assembler family mapping failed\n");
                        break;
                    }
                } else {
                    int include_index = 0;
                    int define_index = 0;
                    int toolchain_internal_include_index = 0;
                    const char *c_standard_flag = "-std=c11";
                    const char *optimization_flag = "-O0";
                    const char *driver_prefix_policy = project_toolchain_driver_prefix_policy;
                    int add_wall = 1;
                    int add_wextra = 1;
                    int add_werror = 0;
                    int add_debug_symbols = 0;
                    if (strcmp(project_c_standard, "c90") == 0) {
                        c_standard_flag = "-std=c90";
                    } else if (strcmp(project_c_standard, "c99") == 0) {
                        c_standard_flag = "-std=c99";
                    } else if (strcmp(project_c_standard, "c11") == 0) {
                        c_standard_flag = "-std=c11";
                    } else {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "project c_standard mapping failed\n");
                        break;
                    }
                    if (strcmp(project_warning_level, "default") == 0) {
                        add_wall = 1;
                        add_wextra = 0;
                        add_werror = 0;
                    } else if (strcmp(project_warning_level, "extra") == 0) {
                        add_wall = 1;
                        add_wextra = 1;
                        add_werror = 0;
                    } else if (strcmp(project_warning_level, "strict") == 0) {
                        add_wall = 1;
                        add_wextra = 1;
                        add_werror = 1;
                    } else {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "project warning_level mapping failed\n");
                        break;
                    }
                    if (strcmp(project_optimization, "none") == 0) {
                        optimization_flag = "-O0";
                    } else if (strcmp(project_optimization, "debug") == 0) {
                        optimization_flag = "-Og";
                    } else if (strcmp(project_optimization, "release") == 0) {
                        optimization_flag = "-O2";
                    } else {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "project optimization mapping failed\n");
                        break;
                    }
                    if (strcmp(project_debug_symbols, "yes") == 0) {
                        add_debug_symbols = 1;
                    } else if (strcmp(project_debug_symbols, "no") == 0) {
                        add_debug_symbols = 0;
                    } else {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "project debug_symbols mapping failed\n");
                        break;
                    }
                    if (strcmp(driver_prefix_policy, "dual_b") != 0 && strcmp(driver_prefix_policy, "bin_only") != 0) {
                        build_rc = 127;
                        compile_stop_index = i;
                        (void)append_text_to_file(diagnostics_name, "project toolchain driver_prefix_policy mapping failed\n");
                        break;
                    }
                    {
                        const char *compile_driver = resolve_compile_driver_token(project_toolchain_driver, driver_prefix_policy);
                        if (compile_driver == NULL) {
                            build_rc = 127;
                            compile_stop_index = i;
                            (void)append_text_to_file(diagnostics_name, "project toolchain driver mapping failed\n");
                            break;
                        }
                        if (sb_init(&compile_builder, command_buf, OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE) != 0 ||
                        sb_appendf(&compile_builder, "%s ", compile_driver) != 0 ||
                        (strcmp(driver_prefix_policy, "dual_b") == 0 &&
                         (sb_appendf(&compile_builder, "-B%s ", project_toolchain_cc1_prefix) != 0 ||
                          sb_appendf(&compile_builder, "-B%s ", project_toolchain_gcc_bin_prefix) != 0)) ||
                        (strcmp(driver_prefix_policy, "bin_only") == 0 &&
                         sb_appendf(&compile_builder, "-B%s ", project_toolchain_gcc_bin_prefix) != 0) ||
                        sb_appendf(&compile_builder, "%s ", c_standard_flag) != 0 ||
                        (add_wall && sb_appendf(&compile_builder, "-Wall ") != 0) ||
                        (add_wextra && sb_appendf(&compile_builder, "-Wextra ") != 0) ||
                        (add_werror && sb_appendf(&compile_builder, "-Werror ") != 0) ||
                        sb_appendf(&compile_builder, "%s ", optimization_flag) != 0 ||
                        (add_debug_symbols && sb_appendf(&compile_builder, "-g ") != 0)) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "compile command initialization failed\n");
                            break;
                        }
                    }
                    for (toolchain_internal_include_index = 0;
                         toolchain_internal_include_index < toolchain_internal_include_count &&
                         compile_stop_index < 0;
                         toolchain_internal_include_index += 1) {
                        if (sb_appendf(
                                &compile_builder,
                                "-idirafter %s ",
                                project_toolchain_internal_include_dirs[toolchain_internal_include_index]) != 0) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "compile internal include append failed\n");
                            break;
                        }
                    }
                    if (compile_stop_index == i) {
                        break;
                    }
                    if ((toolchain_mui_include_ready &&
                         sb_appendf(&compile_builder, "-idirafter %s ", toolchain_mui_include_dir) != 0) ||
                        sb_appendf(&compile_builder, "-I%s ", project_dir_path) != 0) {
                        build_rc = 127;
                        compile_stop_index = i;
                        command_buffer_status = "overflow";
                        (void)append_text_to_file(diagnostics_name, "compile command initialization failed\n");
                        break;
                    }
                    for (include_index = 0; include_index < include_count; include_index += 1) {
                        if (sb_appendf(&compile_builder, "-I%s ", include_paths[include_index]) != 0) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "compile include path append failed\n");
                            break;
                        }
                    }
                    for (define_index = 0; define_index < define_count && compile_stop_index < 0; define_index += 1) {
                        if (sb_appendf(&compile_builder, "-D%s ", define_entries[define_index]) != 0) {
                            build_rc = 127;
                            compile_stop_index = i;
                            command_buffer_status = "overflow";
                            (void)append_text_to_file(diagnostics_name, "compile define append failed\n");
                            break;
                        }
                    }
                    if (compile_stop_index == i) {
                        break;
                    }
                    if (sb_appendf(&compile_builder, "-c %s -o %s", source_paths[i], object_names[i]) != 0) {
                        build_rc = 127;
                        compile_stop_index = i;
                        command_buffer_status = "overflow";
                        (void)append_text_to_file(diagnostics_name, "compile command finalization failed\n");
                        break;
                    }
                }
            }
            (void)append_text_to_file(compile_command_output_names[i], "COMPILE_COMMAND=");
            (void)append_text_to_file(compile_command_output_names[i], command_buf);
            (void)append_text_to_file(compile_command_output_names[i], "\n");
            compile_rc = run_command_capture_both(command_buf, compile_output_names[i]);
            compile_exit[i] = compile_rc;
            (void)append_text_to_file(diagnostics_name, "=== PROJECT_COMPILE_");
            {
                char idx_buf[32];
                (void)snprintf(idx_buf, sizeof(idx_buf), "%d", i);
                (void)append_text_to_file(diagnostics_name, idx_buf);
            }
            (void)append_text_to_file(diagnostics_name, " ===\n");
            (void)append_file_to_file(diagnostics_name, compile_output_names[i]);
            (void)append_text_to_file(diagnostics_name, "\n");
            build_rc = compile_rc;
            if (compile_rc != 0) {
                compile_stop_index = i;
                break;
            }
        }

        if (source_count > 0 && compile_stop_index < 0 &&
            has_asm_source && strcmp(project_assembler_linker_model, "vlink") == 0 &&
            project_assembler_linker_path[0] != '\0') {
            StringBuilder builder;
            int link_parts_ok = 0;
            int library_index = 0;
            (void)snprintf(active_linker_path, sizeof(active_linker_path), "%s", project_assembler_linker_path);
            if (sb_init(&builder, command_buf, OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE) == 0 &&
                sb_appendf(&builder, "%s ", project_assembler_linker_path) == 0 &&
                sb_appendf(&builder, "-belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ ") == 0 &&
                sb_appendf(&builder, "-nostdlib -fixunnamed -interp \"vbcc 0.9\" ") == 0 &&
                sb_appendf(&builder, "-Tvlibos4:script vlibos4:startup.o ") == 0) {
                for (i = 0; i < source_count; i += 1) {
                    if (sb_appendf(&builder, "%s ", object_names[i]) != 0) {
                        break;
                    }
                }
                if (i == source_count && sb_appendf(&builder, "-s -x -Lvlibos4: -LSObjs: -lvc ") == 0) {
                    for (library_index = 0; library_index < library_count; library_index += 1) {
                        if (sb_appendf(&builder, "-l%s ", library_names[library_index]) != 0) {
                            break;
                        }
                    }
                }
                if (i == source_count && library_index == library_count &&
                    sb_appendf(&builder, "-o %s", executable_name) == 0) {
                    link_parts_ok = 1;
                }
                if (link_parts_ok) {
                    (void)append_text_to_file(link_object_file_name, "LINK_COMMAND=");
                    (void)append_text_to_file(link_object_file_name, command_buf);
                    (void)append_text_to_file(link_object_file_name, "\n");
                    link_attempted = 1;
                    direct_link_rc = run_command_capture_both(command_buf, link_output_name);
                    (void)append_text_to_file(diagnostics_name, "=== PROJECT_LINK ===\n");
                    (void)append_file_to_file(diagnostics_name, link_output_name);
                    (void)append_text_to_file(diagnostics_name, "\n");
                    build_rc = direct_link_rc;
                    direct_link_final = (direct_link_rc == 0) ? "PASS" : "FAIL";
                } else {
                    build_rc = 127;
                    command_buffer_status = "overflow";
                    (void)append_text_to_file(diagnostics_name, "vlink command construction failed\n");
                }
            } else {
                build_rc = 127;
                command_buffer_status = "overflow";
                (void)append_text_to_file(diagnostics_name, "vlink command initialization failed\n");
            }
        } else if (source_count > 0 && compile_stop_index < 0 &&
                   strcmp(direct_libgcc_status, "present") == 0 &&
                   strcmp(direct_libgcc_eh_status, "present") == 0) {
            StringBuilder builder;
            int library_index = 0;
            int link_parts_ok = 0;
            const char *selected_linker_path =
                (has_asm_source && project_assembler_linker_path[0] != '\0')
                    ? project_assembler_linker_path
                    : project_toolchain_ld_path;
            (void)snprintf(active_linker_path, sizeof(active_linker_path), "%s", selected_linker_path);
            if (sb_init(&builder, command_buf, OS4TB_GCC_PROJECT_COMMAND_BUFFER_SIZE) == 0 &&
                sb_appendf(&builder, "%s --defsym \"__amigaos4__=1\" -Bstatic -q -d -Qy ", selected_linker_path) == 0 &&
                sb_appendf(&builder, "-o %s %s ", executable_name, project_toolchain_crtbegin) == 0) {
                for (library_index = 0; library_index < toolchain_library_dir_count; library_index += 1) {
                    if (sb_appendf(&builder, "-L%s ", project_toolchain_library_dirs[library_index]) != 0) {
                        break;
                    }
                }
                if (library_index != toolchain_library_dir_count) {
                    link_parts_ok = 0;
                }
                if (library_index == toolchain_library_dir_count) {
                    for (i = 0; i < source_count; i += 1) {
                        if (sb_appendf(&builder, "%s ", object_names[i]) != 0) {
                            break;
                        }
                    }
                }
                if (i == source_count && sb_appendf(&builder, "%s %s ", project_toolchain_runtime_libgcc, project_toolchain_runtime_libgcc_eh) == 0 &&
                    sb_appendf(&builder, "--start-group -lc ") == 0) {
                    for (library_index = 0; library_index < library_count; library_index += 1) {
                        if (sb_appendf(&builder, "-l%s ", library_names[library_index]) != 0) {
                            break;
                        }
                    }
                }
                if (i == source_count && library_index == library_count && sb_appendf(&builder, "--end-group ") == 0 &&
                    sb_appendf(&builder, "%s %s ", project_toolchain_runtime_libgcc, project_toolchain_runtime_libgcc_eh) == 0 &&
                    sb_appendf(&builder, "%s", project_toolchain_crtend) == 0) {
                    link_parts_ok = 1;
                }
                if (link_parts_ok) {
                    (void)append_text_to_file(link_object_file_name, "LINK_COMMAND=");
                    (void)append_text_to_file(link_object_file_name, command_buf);
                    (void)append_text_to_file(link_object_file_name, "\n");
                    link_attempted = 1;
                    direct_link_rc = run_command_capture_both(command_buf, link_output_name);
                    (void)append_text_to_file(diagnostics_name, "=== PROJECT_LINK ===\n");
                    (void)append_file_to_file(diagnostics_name, link_output_name);
                    (void)append_text_to_file(diagnostics_name, "\n");
                    build_rc = direct_link_rc;
                    direct_link_final = (direct_link_rc == 0) ? "PASS" : "FAIL";
                } else {
                    build_rc = 127;
                    command_buffer_status = "overflow";
                    (void)append_text_to_file(diagnostics_name, "link command construction failed\n");
                }
            } else {
                build_rc = 127;
                command_buffer_status = "overflow";
                (void)append_text_to_file(diagnostics_name, "link command initialization failed\n");
            }
        } else if (source_count > 0 && compile_stop_index < 0) {
            build_rc = 126;
            (void)append_text_to_file(diagnostics_name, "direct runtime archive validation failed; skipping project link\n");
        }
    } else if (!toolchain_ready) {
        build_rc = 127;
        (void)append_text_to_file(diagnostics_name, "toolchain helper discovery failed; skipping project build\n");
    } else {
        build_rc = 127;
    }

    executable_present = file_exists_non_empty(executable_name);
    direct_link_exec_status = executable_present ? "present" : "missing";
    if (strcmp(direct_link_final, "PASS") == 0 && !executable_present) {
        direct_link_final = "FAIL";
    }

    if (build_rc == 0 && executable_present && run_program_enabled) {
        program_rc = run_command_capture_both(executable_name, program_output_name);
        program_final = (program_rc == 0) ? "PASS" : "FAIL";
        build_final = "PASS";
        project_build_final = "PASS";
    } else if (build_rc == 0 && executable_present) {
        program_rc = -1;
        program_final = "NOT_RUN";
        execution_skipped = 1;
        build_final = "PASS";
        project_build_final = "PASS";
    } else {
        build_final = "FAIL";
        project_build_final = "FAIL";
        program_final = "NOT_RUN";
    }

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }

    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_EXIT=%d\n", build_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_EXIT=%d\n", build_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXECUTABLE_STATUS=%s\n", executable_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXECUTABLE_NAME=%s\n", executable_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_CC1_DISCOVERY=%s\n", cc1_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_AS_DISCOVERY=%s\n", as_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_TOOLCHAIN_ENV=%s\n", toolchain_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TOOLCHAIN_ENV=%s\n", toolchain_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DIRECTORY=%s\n", project_dir_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_MANIFEST=%s\n", manifest_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_MANIFEST_STATUS=%s\n", manifest_status);
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_EXECUTION_MODE=%s\n",
        run_program_enabled ? "build_and_run" : "build_only");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_EXECUTION_SKIPPED=%s\n",
        execution_skipped ? "yes" : "no");
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_LIBGCC=%s\n", project_toolchain_runtime_libgcc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_LIBGCC_EH=%s\n", project_toolchain_runtime_libgcc_eh);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_STATUS=%s\n", direct_libgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=%s\n", direct_libgcc_eh_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_SIZE=%ld\n", direct_libgcc_size);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_EH_SIZE=%ld\n", direct_libgcc_eh_size);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_OUTPUT_FILE=%s\n", link_output_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LINK_OBJECT_FILE=%s\n", link_object_file_name);
    if (link_attempted) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_EXIT=%d\n", direct_link_rc);
    } else {
        (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_EXIT=missing\n");
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=%s\n", direct_link_exec_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_FINAL=%s\n", direct_link_final);

    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SOURCE_COUNT=%d\n", source_count);
    for (i = 0; i < source_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SOURCE_%d=%s\n", i, source_names[i]);
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SOURCE_%d_TYPE=%s\n", i, source_types[i]);
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_OBJECT_%d=%s\n", i, object_names[i]);
        if (compile_exit[i] == 127 && (compile_stop_index < 0 || i > compile_stop_index)) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=missing\n", i);
        } else if (compile_exit[i] == 127 && strcmp(source_status[i], "present") != 0) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=missing\n", i);
        } else {
            (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=%d\n", i, compile_exit[i]);
        }
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_HEADER_COUNT=%d\n", header_count);
    for (i = 0; i < header_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_HEADER_%d=%s\n", i, header_names[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INCLUDE_COUNT=%d\n", include_count);
    for (i = 0; i < include_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INCLUDE_%d=%s\n", i, include_names[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEFINE_COUNT=%d\n", define_count);
    for (i = 0; i < define_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEFINE_%d=%s\n", i, define_entries[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LIBRARY_COUNT=%d\n", library_count);
    for (i = 0; i < library_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LIBRARY_%d=%s\n", i, library_names[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_C_STANDARD=%s\n", project_c_standard);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_WARNING_LEVEL=%s\n", project_warning_level);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_OPTIMIZATION=%s\n", project_optimization);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEBUG_SYMBOLS=%s\n", project_debug_symbols);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_ID=%s\n", project_toolchain_id);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE=%s\n", project_toolchain_source);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY=%s\n", project_toolchain_family);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION=%s\n", project_toolchain_version);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_DRIVER=%s\n", project_toolchain_driver);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_DRIVER_PREFIX_POLICY=%s\n", project_toolchain_driver_prefix_policy);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_ASSEMBLER_ID=%s\n", project_assembler_id);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_ASSEMBLER_FAMILY=%s\n", project_assembler_family);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_ASSEMBLER_PATH=%s\n", project_assembler_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_CC1_PREFIX=%s\n", project_toolchain_cc1_prefix);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_GCC_BIN_PREFIX=%s\n", project_toolchain_gcc_bin_prefix);
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_DIR=%s\n",
        toolchain_internal_include_count > 0 ? project_toolchain_internal_include_dirs[0] : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_COUNT=%d\n", toolchain_internal_include_count);
    for (i = 0; i < toolchain_internal_include_count; i += 1) {
        (void)fprintf(
            artifact_fp,
            "OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_%d=%s\n",
            i,
            project_toolchain_internal_include_dirs[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SDK_ROOT=%s\n", project_toolchain_sdk_root);
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_PROJECT_MUI_INCLUDE_DIR=%s\n",
        toolchain_mui_include_ready ? toolchain_mui_include_dir : "missing");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_PROJECT_LD_PATH=%s\n",
        active_linker_path[0] != '\0' ? active_linker_path : project_toolchain_ld_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMMAND_BUFFER_STATUS=%s\n", command_buffer_status);
    if (link_attempted) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LINK_EXIT=%d\n", direct_link_rc);
    } else {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LINK_EXIT=missing\n");
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_EXECUTABLE_STATUS=%s\n", executable_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_BUILD_FINAL=%s\n", project_build_final);

    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_FINAL=%s\n", build_final);
    if (build_rc == 0 && executable_present) {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=%d\n", program_rc);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_OUTPUT_FILE=%s\n", program_output_name);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=%s\n", program_final);
    } else {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=not_run\n");
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=NOT_RUN\n");
    }

    if (fclose(artifact_fp) != 0) {
        return 5;
    }
    return 0;
}
