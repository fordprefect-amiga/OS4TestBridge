#include <dos/dos.h>
#include <proto/dos.h>
#include <ctype.h>
#include <errno.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

#define OS4TB_PROJECT_MAX_SOURCES 8
#define OS4TB_PROJECT_MAX_HEADERS 8
#define OS4TB_PROJECT_MAX_INCLUDES 4
#define OS4TB_PROJECT_MAX_DEFINES 16
#define OS4TB_PROJECT_MAX_LIBRARIES 16
#define OS4TB_PROJECT_MAX_PATH 640
#define OS4TB_PROJECT_MAX_NAME 240
#define OS4TB_PROJECT_MAX_DEFINE 129
#define OS4TB_PROJECT_MAX_LIBRARY 64
#define OS4TB_PROJECT_MAX_TOOLCHAIN_TEXT 320
#define OS4TB_PROJECT_COMMAND_BUFFER 8192

static const int kUseUserShell = 1;

typedef struct ProjectManifest {
    int source_count;
    int header_count;
    int include_count;
    int define_count;
    int library_count;
    char source_names[OS4TB_PROJECT_MAX_SOURCES][OS4TB_PROJECT_MAX_NAME];
    char header_names[OS4TB_PROJECT_MAX_HEADERS][OS4TB_PROJECT_MAX_NAME];
    char include_names[OS4TB_PROJECT_MAX_INCLUDES][OS4TB_PROJECT_MAX_NAME];
    char define_entries[OS4TB_PROJECT_MAX_DEFINES][OS4TB_PROJECT_MAX_DEFINE];
    char library_names[OS4TB_PROJECT_MAX_LIBRARIES][OS4TB_PROJECT_MAX_LIBRARY];
    char c_standard[16];
    char warning_level[16];
    char optimization[16];
    char debug_symbols[16];
    char toolchain[33];
    char toolchain_source[32];
    char toolchain_family[32];
    char toolchain_version[32];
    char vbcc_driver[16];
    char vbcc_driver_path[OS4TB_PROJECT_MAX_TOOLCHAIN_TEXT + 1];
    char vbcc_compiler[32];
    char vbcc_assembler[32];
    char vbcc_linker[32];
    char vbcc_linker_path[OS4TB_PROJECT_MAX_TOOLCHAIN_TEXT + 1];
} ProjectManifest;

static int safe_snprintf(char *dst, size_t cap, const char *fmt, ...) {
    va_list ap;
    int n;
    if (dst == NULL || cap == 0U || fmt == NULL) {
        return -1;
    }
    va_start(ap, fmt);
    n = vsnprintf(dst, cap, fmt, ap);
    va_end(ap);
    if (n < 0 || (size_t)n >= cap) {
        return -1;
    }
    return 0;
}

static int is_safe_basename(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > 128U) {
        return 0;
    }
    if (strcmp(s, ".") == 0 || strcmp(s, "..") == 0 || strstr(s, "..") != NULL) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int is_safe_relative_path(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > OS4TB_PROJECT_MAX_NAME - 1U) {
        return 0;
    }
    if (s[0] == '/' || s[0] == '\\' || strstr(s, "..") != NULL || strstr(s, "//") != NULL) {
        return 0;
    }
    if (strchr(s, ':') != NULL || strchr(s, '\\') != NULL) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)s[i];
        if (c == '/') {
            continue;
        }
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int has_suffix(const char *s, const char *suffix) {
    size_t ls = strlen(s);
    size_t lf = strlen(suffix);
    if (ls <= lf) {
        return 0;
    }
    return strcmp(s + ls - lf, suffix) == 0;
}

static int is_safe_relative_c_path(const char *s) {
    return is_safe_relative_path(s) && has_suffix(s, ".c");
}

static int is_safe_relative_h_path(const char *s) {
    return is_safe_relative_path(s) && has_suffix(s, ".h");
}

static int is_safe_define_entry(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len >= OS4TB_PROJECT_MAX_DEFINE) {
        return 0;
    }
    if (!((s[0] >= 'a' && s[0] <= 'z') || (s[0] >= 'A' && s[0] <= 'Z') || s[0] == '_')) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '=' || c == '+' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int is_safe_library_name(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len >= OS4TB_PROJECT_MAX_LIBRARY || s[0] == '-') {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '_' || c == '+' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int is_safe_toolchain_path(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > OS4TB_PROJECT_MAX_TOOLCHAIN_TEXT) {
        return 0;
    }
    if (strstr(s, "..") != NULL) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)s[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
              c == '/' || c == ':' || c == '.' || c == '_' || c == '+' || c == '-')) {
            return 0;
        }
    }
    return 1;
}

static int parse_nonnegative_int(const char *s, int *out) {
    char *end = NULL;
    long v = 0;
    if (s == NULL || *s == '\0' || out == NULL) {
        return -1;
    }
    errno = 0;
    v = strtol(s, &end, 10);
    if (errno != 0 || end == s || *end != '\0' || v < 0 || v > 100000L) {
        return -1;
    }
    *out = (int)v;
    return 0;
}

static char *trim_inplace(char *line) {
    char *start = line;
    char *end = NULL;
    while (*start != '\0' && isspace((unsigned char)*start)) {
        start++;
    }
    end = start + strlen(start);
    while (end > start && isspace((unsigned char)end[-1])) {
        end--;
    }
    *end = '\0';
    return start;
}

static int join_project_path(char *out, size_t cap, const char *project_dir, const char *rel) {
    if (safe_snprintf(out, cap, "%s/%s", project_dir, rel) != 0) {
        return -1;
    }
    return 0;
}

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
}

static int write_text_file(const char *path, const char *text) {
    FILE *fp = fopen(path, "wb");
    if (fp == NULL) {
        return -1;
    }
    if (text != NULL && *text != '\0') {
        if (fwrite(text, 1U, strlen(text), fp) != strlen(text)) {
            fclose(fp);
            return -1;
        }
    }
    if (fclose(fp) != 0) {
        return -1;
    }
    return 0;
}

static int append_file_to_diagnostics(const char *diagnostics_path, const char *header, const char *source_path) {
    FILE *out = fopen(diagnostics_path, "ab");
    FILE *in = NULL;
    char buffer[512];
    if (out == NULL) {
        return -1;
    }
    if (header != NULL && header[0] != '\0') {
        if (fprintf(out, "%s\n", header) < 0) {
            fclose(out);
            return -1;
        }
    }
    in = fopen(source_path, "rb");
    if (in != NULL) {
        size_t n = 0U;
        while ((n = fread(buffer, 1U, sizeof(buffer), in)) > 0U) {
            if (fwrite(buffer, 1U, n, out) != n) {
                fclose(in);
                fclose(out);
                return -1;
            }
        }
        fclose(in);
    }
    if (fprintf(out, "\n") < 0) {
        fclose(out);
        return -1;
    }
    fclose(out);
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

static int parse_manifest(const char *manifest_path, ProjectManifest *m) {
    FILE *fp = NULL;
    char raw[1024];
    int seen_source_count = 0;
    int seen_header_count = 0;
    int seen_include_count = 0;
    int seen_define_count = 0;
    int seen_library_count = 0;
    int seen_c_standard = 0;
    int seen_warning = 0;
    int seen_optimization = 0;
    int seen_debug = 0;
    int seen_toolchain = 0;
    int seen_toolchain_source = 0;
    int seen_toolchain_family = 0;
    int seen_toolchain_version = 0;
    int seen_vbcc_driver = 0;
    int seen_vbcc_driver_path = 0;
    int seen_vbcc_compiler = 0;
    int seen_vbcc_assembler = 0;
    int seen_vbcc_linker = 0;
    int seen_vbcc_linker_path = 0;

    memset(m, 0, sizeof(*m));
    m->source_count = -1;
    m->header_count = -1;
    m->include_count = -1;
    m->define_count = -1;
    m->library_count = -1;

    fp = fopen(manifest_path, "rb");
    if (fp == NULL) {
        return -1;
    }
    while (fgets(raw, sizeof(raw), fp) != NULL) {
        char *line = trim_inplace(raw);
        char *eq = NULL;
        if (*line == '\0') {
            continue;
        }
        eq = strchr(line, '=');
        if (eq == NULL) {
            fclose(fp);
            return -2;
        }
        *eq = '\0';
        {
            char *key = trim_inplace(line);
            char *value = trim_inplace(eq + 1);
            int idx = -1;
            if (strcmp(key, "SOURCE_COUNT") == 0) {
                if (seen_source_count || parse_nonnegative_int(value, &m->source_count) != 0 || m->source_count < 1 ||
                    m->source_count > OS4TB_PROJECT_MAX_SOURCES) {
                    fclose(fp);
                    return -3;
                }
                seen_source_count = 1;
            } else if (strncmp(key, "SOURCE_", 7) == 0) {
                if (parse_nonnegative_int(key + 7, &idx) != 0 || m->source_count < 0 || idx < 0 || idx >= m->source_count ||
                    !is_safe_relative_c_path(value)) {
                    fclose(fp);
                    return -4;
                }
                if (safe_snprintf(m->source_names[idx], sizeof(m->source_names[idx]), "%s", value) != 0) {
                    fclose(fp);
                    return -4;
                }
            } else if (strcmp(key, "HEADER_COUNT") == 0) {
                if (seen_header_count || parse_nonnegative_int(value, &m->header_count) != 0 || m->header_count < 0 ||
                    m->header_count > OS4TB_PROJECT_MAX_HEADERS) {
                    fclose(fp);
                    return -5;
                }
                seen_header_count = 1;
            } else if (strncmp(key, "HEADER_", 7) == 0) {
                if (parse_nonnegative_int(key + 7, &idx) != 0 || m->header_count < 0 || idx < 0 || idx >= m->header_count ||
                    !is_safe_relative_h_path(value)) {
                    fclose(fp);
                    return -6;
                }
                if (safe_snprintf(m->header_names[idx], sizeof(m->header_names[idx]), "%s", value) != 0) {
                    fclose(fp);
                    return -6;
                }
            } else if (strcmp(key, "INCLUDE_COUNT") == 0) {
                if (seen_include_count || parse_nonnegative_int(value, &m->include_count) != 0 || m->include_count < 0 ||
                    m->include_count > OS4TB_PROJECT_MAX_INCLUDES) {
                    fclose(fp);
                    return -7;
                }
                seen_include_count = 1;
            } else if (strncmp(key, "INCLUDE_", 8) == 0) {
                if (parse_nonnegative_int(key + 8, &idx) != 0 || m->include_count < 0 || idx < 0 || idx >= m->include_count ||
                    !is_safe_relative_path(value)) {
                    fclose(fp);
                    return -8;
                }
                if (safe_snprintf(m->include_names[idx], sizeof(m->include_names[idx]), "%s", value) != 0) {
                    fclose(fp);
                    return -8;
                }
            } else if (strcmp(key, "DEFINE_COUNT") == 0) {
                if (seen_define_count || parse_nonnegative_int(value, &m->define_count) != 0 || m->define_count < 0 ||
                    m->define_count > OS4TB_PROJECT_MAX_DEFINES) {
                    fclose(fp);
                    return -9;
                }
                seen_define_count = 1;
            } else if (strncmp(key, "DEFINE_", 7) == 0) {
                if (parse_nonnegative_int(key + 7, &idx) != 0 || m->define_count < 0 || idx < 0 || idx >= m->define_count ||
                    !is_safe_define_entry(value)) {
                    fclose(fp);
                    return -10;
                }
                if (safe_snprintf(m->define_entries[idx], sizeof(m->define_entries[idx]), "%s", value) != 0) {
                    fclose(fp);
                    return -10;
                }
            } else if (strcmp(key, "LIBRARY_COUNT") == 0) {
                if (seen_library_count || parse_nonnegative_int(value, &m->library_count) != 0 || m->library_count < 0 ||
                    m->library_count > OS4TB_PROJECT_MAX_LIBRARIES) {
                    fclose(fp);
                    return -11;
                }
                seen_library_count = 1;
            } else if (strncmp(key, "LIBRARY_", 8) == 0) {
                if (parse_nonnegative_int(key + 8, &idx) != 0 || m->library_count < 0 || idx < 0 || idx >= m->library_count ||
                    !is_safe_library_name(value)) {
                    fclose(fp);
                    return -12;
                }
                if (safe_snprintf(m->library_names[idx], sizeof(m->library_names[idx]), "%s", value) != 0) {
                    fclose(fp);
                    return -12;
                }
            } else if (strcmp(key, "C_STANDARD") == 0) {
                if (seen_c_standard || safe_snprintf(m->c_standard, sizeof(m->c_standard), "%s", value) != 0) {
                    fclose(fp);
                    return -13;
                }
                seen_c_standard = 1;
            } else if (strcmp(key, "WARNING_LEVEL") == 0) {
                if (seen_warning || safe_snprintf(m->warning_level, sizeof(m->warning_level), "%s", value) != 0) {
                    fclose(fp);
                    return -14;
                }
                seen_warning = 1;
            } else if (strcmp(key, "OPTIMIZATION") == 0) {
                if (seen_optimization || safe_snprintf(m->optimization, sizeof(m->optimization), "%s", value) != 0) {
                    fclose(fp);
                    return -15;
                }
                seen_optimization = 1;
            } else if (strcmp(key, "DEBUG_SYMBOLS") == 0) {
                if (seen_debug || safe_snprintf(m->debug_symbols, sizeof(m->debug_symbols), "%s", value) != 0) {
                    fclose(fp);
                    return -16;
                }
                seen_debug = 1;
            } else if (strcmp(key, "TOOLCHAIN") == 0) {
                if (seen_toolchain || safe_snprintf(m->toolchain, sizeof(m->toolchain), "%s", value) != 0) {
                    fclose(fp);
                    return -17;
                }
                seen_toolchain = 1;
            } else if (strcmp(key, "TOOLCHAIN_SOURCE") == 0) {
                if (seen_toolchain_source || safe_snprintf(m->toolchain_source, sizeof(m->toolchain_source), "%s", value) != 0) {
                    fclose(fp);
                    return -18;
                }
                seen_toolchain_source = 1;
            } else if (strcmp(key, "TOOLCHAIN_FAMILY") == 0) {
                if (seen_toolchain_family || safe_snprintf(m->toolchain_family, sizeof(m->toolchain_family), "%s", value) != 0) {
                    fclose(fp);
                    return -19;
                }
                seen_toolchain_family = 1;
            } else if (strcmp(key, "TOOLCHAIN_VERSION") == 0) {
                if (seen_toolchain_version || safe_snprintf(m->toolchain_version, sizeof(m->toolchain_version), "%s", value) != 0) {
                    fclose(fp);
                    return -20;
                }
                seen_toolchain_version = 1;
            } else if (strcmp(key, "VBCC_DRIVER") == 0) {
                if (seen_vbcc_driver || safe_snprintf(m->vbcc_driver, sizeof(m->vbcc_driver), "%s", value) != 0) {
                    fclose(fp);
                    return -21;
                }
                seen_vbcc_driver = 1;
            } else if (strcmp(key, "VBCC_DRIVER_PATH") == 0) {
                if (seen_vbcc_driver_path || !is_safe_toolchain_path(value) ||
                    safe_snprintf(m->vbcc_driver_path, sizeof(m->vbcc_driver_path), "%s", value) != 0) {
                    fclose(fp);
                    return -22;
                }
                seen_vbcc_driver_path = 1;
            } else if (strcmp(key, "VBCC_COMPILER") == 0) {
                if (seen_vbcc_compiler || safe_snprintf(m->vbcc_compiler, sizeof(m->vbcc_compiler), "%s", value) != 0) {
                    fclose(fp);
                    return -23;
                }
                seen_vbcc_compiler = 1;
            } else if (strcmp(key, "VBCC_ASSEMBLER") == 0) {
                if (seen_vbcc_assembler || safe_snprintf(m->vbcc_assembler, sizeof(m->vbcc_assembler), "%s", value) != 0) {
                    fclose(fp);
                    return -24;
                }
                seen_vbcc_assembler = 1;
            } else if (strcmp(key, "VBCC_LINKER") == 0) {
                if (seen_vbcc_linker || safe_snprintf(m->vbcc_linker, sizeof(m->vbcc_linker), "%s", value) != 0) {
                    fclose(fp);
                    return -25;
                }
                seen_vbcc_linker = 1;
            } else if (strcmp(key, "VBCC_LINKER_PATH") == 0) {
                if (seen_vbcc_linker_path || !is_safe_toolchain_path(value) ||
                    safe_snprintf(m->vbcc_linker_path, sizeof(m->vbcc_linker_path), "%s", value) != 0) {
                    fclose(fp);
                    return -26;
                }
                seen_vbcc_linker_path = 1;
            } else {
                fclose(fp);
                return -27;
            }
        }
    }
    fclose(fp);

    if (!seen_source_count || !seen_header_count || !seen_include_count || !seen_define_count || !seen_library_count ||
        !seen_c_standard || !seen_warning || !seen_optimization || !seen_debug || !seen_toolchain || !seen_toolchain_source ||
        !seen_toolchain_family || !seen_toolchain_version || !seen_vbcc_driver || !seen_vbcc_driver_path ||
        !seen_vbcc_compiler || !seen_vbcc_assembler || !seen_vbcc_linker || !seen_vbcc_linker_path) {
        return -28;
    }
    if (strcmp(m->toolchain, "vbcc-os4") != 0 || strcmp(m->toolchain_family, "vbcc") != 0 || strcmp(m->vbcc_driver, "vc") != 0 ||
        strcmp(m->vbcc_compiler, "vbccppc") != 0 || strcmp(m->vbcc_assembler, "vasmppc_std") != 0 ||
        strcmp(m->vbcc_linker, "vlink") != 0) {
        return -29;
    }
    return 0;
}

int main(int argc, char **argv) {
    char request_id[128];
    char project_dir[OS4TB_PROJECT_MAX_PATH];
    char manifest_path[OS4TB_PROJECT_MAX_PATH];
    char executable_name[220];
    char diagnostics_name[220];
    char link_command_file[220];
    char link_output_file[220];
    char run_output_file[220];
    static char source_paths[OS4TB_PROJECT_MAX_SOURCES][OS4TB_PROJECT_MAX_PATH];
    static char object_names[OS4TB_PROJECT_MAX_SOURCES][160];
    static int compile_exit[OS4TB_PROJECT_MAX_SOURCES];
    static int compile_attempted[OS4TB_PROJECT_MAX_SOURCES];
    int link_exit = 127;
    int program_exit = 127;
    int compiler_executed = 0;
    int build_failed = 0;
    int unsupported_standard = 0;
    int unsupported_warning = 0;
    int i = 0;
    FILE *artifact_fp = NULL;
    static ProjectManifest manifest;
    int parse_rc = -1;
    static char command[OS4TB_PROJECT_COMMAND_BUFFER];

    (void)memset(source_paths, 0, sizeof(source_paths));
    (void)memset(object_names, 0, sizeof(object_names));
    (void)memset(&manifest, 0, sizeof(manifest));
    (void)memset(command, 0, sizeof(command));

    if (argc < 2 || !is_safe_basename(argv[1])) {
        return 2;
    }
    memset(request_id, 0, sizeof(request_id));
    if (has_suffix(argv[1], ".artifact")) {
        size_t n = strlen(argv[1]) - strlen(".artifact");
        if (n == 0U || n >= sizeof(request_id)) {
            return 2;
        }
        memcpy(request_id, argv[1], n);
        request_id[n] = '\0';
    } else {
        if (safe_snprintf(request_id, sizeof(request_id), "%s", argv[1]) != 0) {
            return 2;
        }
    }
    if (!is_safe_basename(request_id)) {
        return 2;
    }

    if (safe_snprintf(project_dir, sizeof(project_dir), "SAMDROP:incoming/project_%s", request_id) != 0 ||
        safe_snprintf(manifest_path, sizeof(manifest_path), "%s/project_manifest.txt", project_dir) != 0 ||
        safe_snprintf(executable_name, sizeof(executable_name), "build_%s_exec", request_id) != 0 ||
        safe_snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.gcc.txt", argv[1]) != 0 ||
        safe_snprintf(link_command_file, sizeof(link_command_file), "%s.project-link-command.txt", argv[1]) != 0 ||
        safe_snprintf(link_output_file, sizeof(link_output_file), "%s.project-link.txt", argv[1]) != 0 ||
        safe_snprintf(run_output_file, sizeof(run_output_file), "%s.program.txt", argv[1]) != 0) {
        return 2;
    }

    for (i = 0; i < OS4TB_PROJECT_MAX_SOURCES; i += 1) {
        compile_exit[i] = 127;
        compile_attempted[i] = 0;
    }
    (void)write_text_file(diagnostics_name, "");
    (void)write_text_file(link_command_file, "");
    (void)write_text_file(link_output_file, "");
    (void)write_text_file(run_output_file, "");

    parse_rc = parse_manifest(manifest_path, &manifest);
    if (parse_rc != 0) {
        build_failed = 1;
    }

    if (!build_failed) {
        for (i = 0; i < manifest.source_count; i += 1) {
            if (join_project_path(source_paths[i], sizeof(source_paths[i]), project_dir, manifest.source_names[i]) != 0 ||
                !file_is_readable(source_paths[i])) {
                build_failed = 1;
                break;
            }
            if (safe_snprintf(object_names[i], sizeof(object_names[i]), "build_%s_source%d.o", request_id, i) != 0) {
                build_failed = 1;
                break;
            }
        }
    }

    if (!build_failed && strcmp(manifest.c_standard, "c11") == 0) {
        unsupported_standard = 1;
        build_failed = 1;
    }
    if (!build_failed && strcmp(manifest.warning_level, "default") != 0) {
        unsupported_warning = 1;
        build_failed = 1;
    }

    for (i = 0; !build_failed && i < manifest.source_count; i += 1) {
        const char *std_flag = "";
        const char *opt_flag = "-O0";
        const char *dbg_flag = "";
        char compile_cmd_file[220];
        char compile_output_file[220];
        char compile_header[64];
        size_t used = 0U;

        if (strcmp(manifest.c_standard, "c99") == 0) {
            std_flag = "-c99";
        } else if (strcmp(manifest.c_standard, "c90") == 0) {
            std_flag = "";
        } else if (strcmp(manifest.c_standard, "c11") == 0) {
            unsupported_standard = 1;
            build_failed = 1;
            break;
        } else {
            build_failed = 1;
            break;
        }
        if (strcmp(manifest.optimization, "none") == 0) {
            opt_flag = "-O0";
        } else if (strcmp(manifest.optimization, "debug") == 0) {
            opt_flag = "-Og";
        } else if (strcmp(manifest.optimization, "release") == 0) {
            opt_flag = "-O2";
        } else {
            build_failed = 1;
            break;
        }
        if (strcmp(manifest.debug_symbols, "yes") == 0) {
            dbg_flag = "-g";
        } else if (strcmp(manifest.debug_symbols, "no") == 0) {
            dbg_flag = "";
        } else {
            build_failed = 1;
            break;
        }

        if (safe_snprintf(compile_cmd_file, sizeof(compile_cmd_file), "%s.project-compile-command-%d.txt", argv[1], i) != 0 ||
            safe_snprintf(compile_output_file, sizeof(compile_output_file), "%s.project-compile-%d.txt", argv[1], i) != 0 ||
            safe_snprintf(compile_header, sizeof(compile_header), "=== PROJECT_COMPILE_%d ===", i) != 0) {
            build_failed = 1;
            break;
        }
        (void)write_text_file(compile_output_file, "");
        if (safe_snprintf(command, sizeof(command), "%s +aosppc -c", manifest.vbcc_driver_path) != 0) {
            build_failed = 1;
            break;
        }
        used = strlen(command);
        if (std_flag[0] != '\0') {
            if (safe_snprintf(command + used, sizeof(command) - used, " %s", std_flag) != 0) {
                build_failed = 1;
                break;
            }
            used = strlen(command);
        }
        if (safe_snprintf(command + used, sizeof(command) - used, " %s", opt_flag) != 0) {
            build_failed = 1;
            break;
        }
        used = strlen(command);
        if (dbg_flag[0] != '\0') {
            if (safe_snprintf(command + used, sizeof(command) - used, " %s", dbg_flag) != 0) {
                build_failed = 1;
                break;
            }
            used = strlen(command);
        }
        if (safe_snprintf(command + used, sizeof(command) - used, " -I%s", project_dir) != 0) {
            build_failed = 1;
            break;
        }
        used = strlen(command);
        {
            int j = 0;
            for (j = 0; j < manifest.include_count; j += 1) {
                char include_path[OS4TB_PROJECT_MAX_PATH];
                if (join_project_path(include_path, sizeof(include_path), project_dir, manifest.include_names[j]) != 0 ||
                    safe_snprintf(command + used, sizeof(command) - used, " -I%s", include_path) != 0) {
                    build_failed = 1;
                    break;
                }
                used = strlen(command);
            }
            if (build_failed) {
                break;
            }
            for (j = 0; j < manifest.define_count; j += 1) {
                if (safe_snprintf(command + used, sizeof(command) - used, " -D%s", manifest.define_entries[j]) != 0) {
                    build_failed = 1;
                    break;
                }
                used = strlen(command);
            }
            if (build_failed) {
                break;
            }
        }
        if (safe_snprintf(command + used, sizeof(command) - used, " -o %s %s", object_names[i], source_paths[i]) != 0) {
            build_failed = 1;
            break;
        }
        (void)write_text_file(compile_cmd_file, command);
        compile_attempted[i] = 1;
        compiler_executed = 1;
        compile_exit[i] = run_command_capture_both(command, compile_output_file);
        (void)append_file_to_diagnostics(diagnostics_name, compile_header, compile_output_file);
        if (compile_exit[i] != 0) {
            build_failed = 1;
            break;
        }
    }

    if (!build_failed) {
        int j = 0;
        if (safe_snprintf(command, sizeof(command), "%s +aosppc", manifest.vbcc_driver_path) != 0) {
            build_failed = 1;
        } else {
            size_t used = strlen(command);
            for (j = 0; j < manifest.source_count; j += 1) {
                if (safe_snprintf(command + used, sizeof(command) - used, " %s", object_names[j]) != 0) {
                    build_failed = 1;
                    break;
                }
                used = strlen(command);
            }
            for (j = 0; !build_failed && j < manifest.library_count; j += 1) {
                if (safe_snprintf(command + used, sizeof(command) - used, " -l%s", manifest.library_names[j]) != 0) {
                    build_failed = 1;
                    break;
                }
                used = strlen(command);
            }
            if (!build_failed && safe_snprintf(command + used, sizeof(command) - used, " -o %s", executable_name) != 0) {
                build_failed = 1;
            }
        }
        if (!build_failed) {
            (void)write_text_file(link_command_file, command);
            compiler_executed = 1;
            link_exit = run_command_capture_both(command, link_output_file);
            (void)append_file_to_diagnostics(diagnostics_name, "=== PROJECT_LINK ===", link_output_file);
            if (link_exit != 0) {
                build_failed = 1;
            }
        }
    }

    if (!build_failed) {
        if (safe_snprintf(command, sizeof(command), "%s", executable_name) != 0) {
            build_failed = 1;
        } else {
            program_exit = run_command_capture_both(command, run_output_file);
        }
    }

    artifact_fp = fopen(argv[1], "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DIRECTORY=%s\n", project_dir);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_MANIFEST=%s\n", manifest_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_MANIFEST_STATUS=%s\n", parse_rc == 0 ? "ok" : "invalid");
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SOURCE_COUNT=%d\n", parse_rc == 0 ? manifest.source_count : 0);
    for (i = 0; parse_rc == 0 && i < manifest.source_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_SOURCE_%d=%s\n", i, manifest.source_names[i]);
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_OBJECT_%d=%s\n", i, object_names[i][0] ? object_names[i] : "missing");
        if (compile_attempted[i]) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=%d\n", i, compile_exit[i]);
        } else {
            (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_COMPILE_%d_EXIT=missing\n", i);
        }
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_HEADER_COUNT=%d\n", parse_rc == 0 ? manifest.header_count : 0);
    for (i = 0; parse_rc == 0 && i < manifest.header_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_HEADER_%d=%s\n", i, manifest.header_names[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INCLUDE_COUNT=%d\n", parse_rc == 0 ? manifest.include_count : 0);
    for (i = 0; parse_rc == 0 && i < manifest.include_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INCLUDE_%d=%s\n", i, manifest.include_names[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEFINE_COUNT=%d\n", parse_rc == 0 ? manifest.define_count : 0);
    for (i = 0; parse_rc == 0 && i < manifest.define_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEFINE_%d=%s\n", i, manifest.define_entries[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LIBRARY_COUNT=%d\n", parse_rc == 0 ? manifest.library_count : 0);
    for (i = 0; parse_rc == 0 && i < manifest.library_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LIBRARY_%d=%s\n", i, manifest.library_names[i]);
    }

    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_C_STANDARD=%s\n", parse_rc == 0 ? manifest.c_standard : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_WARNING_LEVEL=%s\n", parse_rc == 0 ? manifest.warning_level : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_OPTIMIZATION=%s\n", parse_rc == 0 ? manifest.optimization : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_DEBUG_SYMBOLS=%s\n", parse_rc == 0 ? manifest.debug_symbols : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_ID=%s\n", parse_rc == 0 ? manifest.toolchain : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_SOURCE=%s\n", parse_rc == 0 ? manifest.toolchain_source : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_FAMILY=%s\n", parse_rc == 0 ? manifest.toolchain_family : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_TOOLCHAIN_VERSION=%s\n", parse_rc == 0 ? manifest.toolchain_version : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_CC1_PREFIX=n/a\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_GCC_BIN_PREFIX=n/a\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_INTERNAL_INCLUDE_DIR=n/a\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LD_PATH=%s\n", parse_rc == 0 ? manifest.vbcc_linker_path : "unknown");

    (void)fprintf(artifact_fp, "OS4TB_VBCC_DRIVER=%s\n", parse_rc == 0 ? manifest.vbcc_driver : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_DRIVER_PATH=%s\n", parse_rc == 0 ? manifest.vbcc_driver_path : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_COMPILER=%s\n", parse_rc == 0 ? manifest.vbcc_compiler : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_ASSEMBLER=%s\n", parse_rc == 0 ? manifest.vbcc_assembler : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_LINKER=%s\n", parse_rc == 0 ? manifest.vbcc_linker : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_LINKER_PATH=%s\n", parse_rc == 0 ? manifest.vbcc_linker_path : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_UNSUPPORTED_STANDARD=%s\n", unsupported_standard ? "yes" : "no");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_UNSUPPORTED_WARNING=%s\n", unsupported_warning ? "yes" : "no");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_COMPILER_EXECUTED=%s\n", compiler_executed ? "yes" : "no");

    if (link_exit == 127) {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LINK_EXIT=missing\n");
    } else {
        (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_LINK_EXIT=%d\n", link_exit);
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_EXECUTABLE_STATUS=%s\n", file_is_readable(executable_name) ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROJECT_BUILD_FINAL=%s\n", (parse_rc == 0 && !build_failed) ? "PASS" : "FAIL");
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_FINAL=%s\n", (parse_rc == 0 && !build_failed) ? "PASS" : "FAIL");
    if (parse_rc == 0 && !build_failed) {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=%d\n", program_exit);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_OUTPUT_FILE=%s\n", run_output_file);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=%s\n", program_exit == 0 ? "PASS" : "FAIL");
    } else {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=not_run\n");
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=NOT_RUN\n");
    }
    fclose(artifact_fp);
    return 0;
}
