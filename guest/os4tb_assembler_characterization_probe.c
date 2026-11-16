#include <proto/dos.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define OS4TB_MAX_TEXT 320
#define OS4TB_MAX_CMD 900
#define OS4TB_MAX_PATH 260

static int has_suffix(const char *value, const char *suffix) {
    size_t value_len = 0U;
    size_t suffix_len = 0U;
    if (value == NULL || suffix == NULL) {
        return 0;
    }
    value_len = strlen(value);
    suffix_len = strlen(suffix);
    if (suffix_len > value_len) {
        return 0;
    }
    return strcmp(value + value_len - suffix_len, suffix) == 0;
}

static int is_safe_basename(const char *name) {
    const unsigned char *p = (const unsigned char *)name;
    size_t n = 0U;
    if (name == NULL || name[0] == '\0') {
        return 0;
    }
    while (*p != '\0') {
        unsigned char c = *p;
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.')) {
            return 0;
        }
        n += 1U;
        if (n > 100U) {
            return 0;
        }
        p += 1;
    }
    return 1;
}

static int safe_snprintf(char *dst, size_t cap, const char *fmt, ...) {
    int n = 0;
    va_list ap;
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

static int write_text_file(const char *path, const char *content) {
    FILE *fp = fopen(path, "wb");
    if (fp == NULL) {
        return -1;
    }
    if (content != NULL && fputs(content, fp) == EOF) {
        fclose(fp);
        return -1;
    }
    if (fclose(fp) != 0) {
        return -1;
    }
    return 0;
}

static int append_text_file(const char *path, const char *content) {
    FILE *fp = fopen(path, "ab");
    if (fp == NULL) {
        return -1;
    }
    if (content != NULL && fputs(content, fp) == EOF) {
        fclose(fp);
        return -1;
    }
    if (fclose(fp) != 0) {
        return -1;
    }
    return 0;
}

static int file_exists_non_empty(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    return (st.st_mode & S_IFREG) != 0 && st.st_size > 0;
}

static long file_size_or_zero(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    return st.st_size;
}

static int run_command_capture_both(const char *command, const char *output_path) {
    BPTR out_fh = IDOS->Open((STRPTR)output_path, MODE_NEWFILE);
    LONG rc = 0;
    if (out_fh == ZERO) {
        return 127;
    }
    rc = IDOS->SystemTags(
        (STRPTR)command,
        SYS_Asynch, FALSE,
        SYS_UserShell, TRUE,
        SYS_Output, out_fh,
        SYS_Error, out_fh,
        TAG_DONE);
    IDOS->Close(out_fh);
    return (int)rc;
}

static int read_first_nonempty_line(const char *path, char *out, size_t out_cap) {
    FILE *fp = fopen(path, "rb");
    char line[OS4TB_MAX_TEXT];
    if (fp == NULL) {
        return -1;
    }
    while (fgets(line, sizeof(line), fp) != NULL) {
        size_t len = strlen(line);
        while (len > 0U && (line[len - 1] == '\n' || line[len - 1] == '\r' || line[len - 1] == ' ' || line[len - 1] == '\t')) {
            line[len - 1] = '\0';
            len -= 1U;
        }
        if (len > 0U) {
            (void)snprintf(out, out_cap, "%s", line);
            fclose(fp);
            return 0;
        }
    }
    fclose(fp);
    return -1;
}

static int line_indicates_missing_command(const char *line) {
    return strstr(line, "Unknown command") != NULL || strstr(line, "not found") != NULL;
}

static void detect_command_path(const char *command_name, char out_path[OS4TB_MAX_PATH], char out_status[24]) {
    char which_cmd[OS4TB_MAX_TEXT];
    char capture[OS4TB_MAX_PATH];
    char first_line[OS4TB_MAX_PATH];
    (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", "unknown");
    (void)snprintf(out_status, 24, "%s", "missing");
    (void)snprintf(capture, sizeof(capture), "asm_probe_%s_which.txt", command_name);

    (void)snprintf(which_cmd, sizeof(which_cmd), "Which %s", command_name);
    if (run_command_capture_both(which_cmd, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        !line_indicates_missing_command(first_line)) {
        (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", first_line);
        (void)snprintf(out_status, 24, "%s", "present");
        return;
    }

    (void)snprintf(which_cmd, sizeof(which_cmd), "which %s", command_name);
    if (run_command_capture_both(which_cmd, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        !line_indicates_missing_command(first_line)) {
        (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", first_line);
        (void)snprintf(out_status, 24, "%s", "present");
    }
}

static void detect_tool_version(const char *tool_path_or_name, const char *capture_name, char out_version[OS4TB_MAX_TEXT]) {
    const char *flags[] = {"--version", "-version", "-v"};
    size_t i = 0U;
    char cmd[OS4TB_MAX_CMD];
    char first_line[OS4TB_MAX_TEXT];
    (void)snprintf(out_version, OS4TB_MAX_TEXT, "%s", "unknown");
    for (i = 0U; i < sizeof(flags) / sizeof(flags[0]); i += 1U) {
        if (safe_snprintf(cmd, sizeof(cmd), "%s %s", tool_path_or_name, flags[i]) != 0) {
            continue;
        }
        if (run_command_capture_both(cmd, capture_name) == 0 &&
            read_first_nonempty_line(capture_name, first_line, sizeof(first_line)) == 0 &&
            !line_indicates_missing_command(first_line)) {
            (void)snprintf(out_version, OS4TB_MAX_TEXT, "%s", first_line);
            return;
        }
    }
}

static int run_named_command(
    const char *prefix,
    const char *name,
    const char *command,
    char *out_log_path,
    size_t out_log_cap) {
    if (safe_snprintf(out_log_path, out_log_cap, "%s.%s.txt", prefix, name) != 0) {
        return 127;
    }
    return run_command_capture_both(command, out_log_path);
}

int main(int argc, char **argv) {
    char request_id[128];
    char artifact_name[160];
    char gnu_as_path[OS4TB_MAX_PATH];
    char gnu_as_status[24];
    char gnu_as_version[OS4TB_MAX_TEXT];
    char vasm_path[OS4TB_MAX_PATH];
    char vasm_status[24];
    char vasm_version[OS4TB_MAX_TEXT];
    char vlink_path[OS4TB_MAX_PATH];
    char vlink_status[24];
    char gcc_path[OS4TB_MAX_PATH];
    char gcc_status[24];
    FILE *artifact_fp = NULL;

    int gnu_obj_exit = 127;
    int gnu_include_exit = 127;
    int gnu_define_exit = 127;
    int gnu_error_exit = 127;
    int gnu_link_exit = 127;
    int gnu_run_exit = 127;
    int gnu_vlink_run_exit = 127;
    int gnu_undef_obj_exit = 127;
    int gnu_undef_link_exit = 127;
    int gnu_undef_vlink_exit = 127;
    int gnu_to_vlink_exit = 127;
    int c_plus_gnu_exit = 127;
    int vasm_obj_exit = 127;
    int vasm_include_exit = 127;
    int vasm_define_exit = 127;
    int vasm_error_exit = 127;
    int vasm_to_gnu_exit = 127;
    int vasm_to_vlink_exit = 127;
    int vasm_run_exit = 127;
    int vasm_vlink_run_exit = 127;
    int vasm_undef_obj_exit = 127;
    int vasm_undef_link_exit = 127;
    int vasm_undef_vlink_exit = 127;
    int c_plus_vasm_exit = 127;

    long gnu_obj_size = 0;
    long gnu_exec_size = 0;
    long vasm_obj_size = 0;
    long vasm_exec_size = 0;
    char gnu_obj_cmd[OS4TB_MAX_CMD];
    char vasm_obj_cmd[OS4TB_MAX_CMD];
    char request_log_prefix[200];
    char log_gnu_object[220];
    char log_gnu_include[220];
    char log_gnu_define[220];
    char log_gnu_error[220];
    char log_gnu_link[220];
    char log_gnu_run[220];
    char log_gnu_undef_object[220];
    char log_gnu_undef_link[220];
    char log_gnu_to_vlink[220];
    char log_c_gnu_interop[220];
    char log_vasm_object[220];
    char log_vasm_object_retry[220];
    char log_vasm_include[220];
    char log_vasm_define[220];
    char log_vasm_error[220];
    char log_vasm_to_gnu[220];
    char log_vasm_to_vlink[220];
    char log_vasm_run[220];
    char log_vasm_undef_object[220];
    char log_vasm_undef_link[220];
    char log_c_vasm_interop[220];
    char log_gnu_vlink_run[220];
    char log_vasm_vlink_run[220];
    char log_gnu_undef_vlink[220];
    char log_vasm_undef_vlink[220];
    char as_probe_cmd[OS4TB_MAX_CMD];
    char gnu_as_tool[OS4TB_MAX_PATH];
    char vasm_tool[OS4TB_MAX_PATH];
    const char *vasm_candidates[] = {
        "Work:SDK/vbcc/bin/vasmppc_std",
        "vasmppc_std"
    };

    (void)memset(gnu_obj_cmd, 0, sizeof(gnu_obj_cmd));
    (void)memset(vasm_obj_cmd, 0, sizeof(vasm_obj_cmd));
    (void)memset(log_gnu_object, 0, sizeof(log_gnu_object));
    (void)memset(log_gnu_include, 0, sizeof(log_gnu_include));
    (void)memset(log_gnu_define, 0, sizeof(log_gnu_define));
    (void)memset(log_gnu_error, 0, sizeof(log_gnu_error));
    (void)memset(log_gnu_link, 0, sizeof(log_gnu_link));
    (void)memset(log_gnu_run, 0, sizeof(log_gnu_run));
    (void)memset(log_gnu_undef_object, 0, sizeof(log_gnu_undef_object));
    (void)memset(log_gnu_undef_link, 0, sizeof(log_gnu_undef_link));
    (void)memset(log_gnu_to_vlink, 0, sizeof(log_gnu_to_vlink));
    (void)memset(log_c_gnu_interop, 0, sizeof(log_c_gnu_interop));
    (void)memset(log_vasm_object, 0, sizeof(log_vasm_object));
    (void)memset(log_vasm_object_retry, 0, sizeof(log_vasm_object_retry));
    (void)memset(log_vasm_include, 0, sizeof(log_vasm_include));
    (void)memset(log_vasm_define, 0, sizeof(log_vasm_define));
    (void)memset(log_vasm_error, 0, sizeof(log_vasm_error));
    (void)memset(log_vasm_to_gnu, 0, sizeof(log_vasm_to_gnu));
    (void)memset(log_vasm_to_vlink, 0, sizeof(log_vasm_to_vlink));
    (void)memset(log_vasm_run, 0, sizeof(log_vasm_run));
    (void)memset(log_vasm_undef_object, 0, sizeof(log_vasm_undef_object));
    (void)memset(log_vasm_undef_link, 0, sizeof(log_vasm_undef_link));
    (void)memset(log_c_vasm_interop, 0, sizeof(log_c_vasm_interop));
    (void)memset(log_gnu_vlink_run, 0, sizeof(log_gnu_vlink_run));
    (void)memset(log_vasm_vlink_run, 0, sizeof(log_vasm_vlink_run));
    (void)memset(log_gnu_undef_vlink, 0, sizeof(log_gnu_undef_vlink));
    (void)memset(log_vasm_undef_vlink, 0, sizeof(log_vasm_undef_vlink));
    (void)memset(as_probe_cmd, 0, sizeof(as_probe_cmd));
    (void)memset(gnu_as_tool, 0, sizeof(gnu_as_tool));
    (void)memset(vasm_tool, 0, sizeof(vasm_tool));
    (void)memset(request_id, 0, sizeof(request_id));
    (void)memset(artifact_name, 0, sizeof(artifact_name));
    (void)memset(request_log_prefix, 0, sizeof(request_log_prefix));

    if (argc < 2 || !is_safe_basename(argv[1])) {
        return 2;
    }
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
    if (safe_snprintf(artifact_name, sizeof(artifact_name), "%s", argv[1]) != 0) {
        return 2;
    }
    if (safe_snprintf(request_log_prefix, sizeof(request_log_prefix), "%s.asm", artifact_name) != 0) {
        return 2;
    }

    detect_command_path("as", gnu_as_path, gnu_as_status);
    detect_command_path("gcc", gcc_path, gcc_status);
    detect_command_path("vlink", vlink_path, vlink_status);
    (void)snprintf(vasm_status, sizeof(vasm_status), "%s", "missing");
    (void)snprintf(vasm_path, sizeof(vasm_path), "%s", "unknown");
    {
        size_t i = 0U;
        for (i = 0U; i < sizeof(vasm_candidates) / sizeof(vasm_candidates[0]); i += 1U) {
            if (file_exists_non_empty(vasm_candidates[i])) {
                (void)snprintf(vasm_path, sizeof(vasm_path), "%s", vasm_candidates[i]);
                (void)snprintf(vasm_status, sizeof(vasm_status), "%s", "present");
                break;
            }
        }
    }
    if (strcmp(vasm_status, "missing") == 0) {
        char vasm_detected_path[OS4TB_MAX_PATH];
        char vasm_detected_status[24];
        detect_command_path("vasmppc_std", vasm_detected_path, vasm_detected_status);
        if (strcmp(vasm_detected_status, "present") == 0) {
            (void)snprintf(vasm_status, sizeof(vasm_status), "%s", "present");
            (void)snprintf(vasm_path, sizeof(vasm_path), "%s", vasm_detected_path);
        }
    }

    if (strcmp(gnu_as_status, "missing") == 0 && file_exists_non_empty("Work:SDK/gcc/ppc-amigaos/bin/as")) {
        (void)snprintf(gnu_as_status, sizeof(gnu_as_status), "%s", "present");
        (void)snprintf(gnu_as_path, sizeof(gnu_as_path), "%s", "Work:SDK/gcc/ppc-amigaos/bin/as");
    }
    if (strcmp(gcc_status, "missing") == 0 && file_exists_non_empty("/System/C/gcc")) {
        (void)snprintf(gcc_status, sizeof(gcc_status), "%s", "present");
        (void)snprintf(gcc_path, sizeof(gcc_path), "%s", "/System/C/gcc");
    }

    (void)snprintf(gnu_as_tool, sizeof(gnu_as_tool), "%s", strcmp(gnu_as_status, "present") == 0 ? gnu_as_path : "as");
    (void)snprintf(vasm_tool, sizeof(vasm_tool), "%s", strcmp(vasm_status, "present") == 0 ? vasm_path : "vasmppc_std");

    detect_tool_version(strcmp(gnu_as_status, "present") == 0 ? gnu_as_path : "as", "asm_probe_as_version.txt", gnu_as_version);
    detect_tool_version(strcmp(vasm_status, "present") == 0 ? vasm_path : "vasmppc_std", "asm_probe_vasm_version.txt", vasm_version);

    (void)run_command_capture_both("makedir include", "asm_probe_makedir_include.txt");
    (void)write_text_file("gnu_main.s", ".text\n.globl main\nmain:\n    li 3,0\n    blr\n");
    (void)write_text_file("gnu_helper.s", ".text\n.globl asm_helper\nasm_helper:\n    li 3,7\n    blr\n");
    (void)write_text_file("gnu_include.s", ".text\n.globl main\n.include \"include/constants.inc\"\nmain:\n    li 3,VALUE\n    blr\n");
    (void)write_text_file("include/constants.inc", "VALUE=7\n");
    (void)write_text_file("gnu_define.s", ".text\n.globl main\nmain:\n    li 3,VALUE\n    blr\n");
    (void)write_text_file("gnu_invalid.s", ".text\n.globl main\nmain:\n    invalid_mnemonic 3,7\n    blr\n");
    (void)write_text_file("gnu_undef.s", ".text\n.globl main\n.extern missing_symbol\nmain:\n    bl missing_symbol\n    li 3,0\n    blr\n");
    (void)write_text_file("interop_main.c", "extern int asm_helper(void);\nint main(void){return asm_helper();}\n");
    (void)write_text_file("vasm_main.s", ".text\n.globl main\nmain:\n    li 3,0\n    blr\n");
    (void)write_text_file("vasm_helper.s", ".text\n.globl asm_helper\nasm_helper:\n    li 3,7\n    blr\n");
    (void)write_text_file("vasm_include.s", ".text\n.globl main\n.include \"include/constants.inc\"\nmain:\n    li 3,VALUE\n    blr\n");
    (void)write_text_file("vasm_define.s", ".text\n.globl main\nmain:\n    li 3,VALUE\n    blr\n");
    (void)write_text_file("vasm_invalid.s", ".text\n.globl main\nmain:\n    badop 3,4\n    blr\n");
    (void)write_text_file("vasm_undef.s", ".text\n.globl main\n.extern missing_symbol\nmain:\n    bl missing_symbol\n    li 3,0\n    blr\n");

    if (strcmp(gnu_as_status, "present") == 0) {
        if (safe_snprintf(gnu_obj_cmd, sizeof(gnu_obj_cmd), "%s -o gnu_main.o gnu_main.s", gnu_as_tool) == 0) {
            gnu_obj_exit = run_named_command(request_log_prefix, "gnu-object", gnu_obj_cmd, log_gnu_object, sizeof(log_gnu_object));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -o gnu_include.o gnu_include.s", gnu_as_tool) == 0) {
            gnu_include_exit = run_named_command(request_log_prefix, "gnu-include", as_probe_cmd, log_gnu_include, sizeof(log_gnu_include));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s --defsym VALUE=7 -o gnu_define.o gnu_define.s", gnu_as_tool) == 0) {
            gnu_define_exit = run_named_command(request_log_prefix, "gnu-define", as_probe_cmd, log_gnu_define, sizeof(log_gnu_define));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -o gnu_invalid.o gnu_invalid.s", gnu_as_tool) == 0) {
            gnu_error_exit = run_named_command(request_log_prefix, "gnu-error", as_probe_cmd, log_gnu_error, sizeof(log_gnu_error));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -o gnu_undef.o gnu_undef.s", gnu_as_tool) == 0) {
            gnu_undef_obj_exit = run_named_command(request_log_prefix, "gnu-undef-object", as_probe_cmd, log_gnu_undef_object, sizeof(log_gnu_undef_object));
        }
        if (strcmp(gcc_status, "present") == 0) {
            gnu_link_exit = run_named_command(request_log_prefix, "gnu-link", "gcc gnu_main.o -o gnu_main_exec", log_gnu_link, sizeof(log_gnu_link));
            if (gnu_link_exit == 0) {
                gnu_run_exit = run_named_command(request_log_prefix, "gnu-run", "gnu_main_exec", log_gnu_run, sizeof(log_gnu_run));
            }
            if (run_named_command(request_log_prefix, "c-gnu-interop-compile", "gcc -c interop_main.c -o interop_main.o", log_c_gnu_interop, sizeof(log_c_gnu_interop)) == 0 &&
                safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -o interop_gnu_helper.o gnu_helper.s", gnu_as_tool) == 0 &&
                run_named_command(request_log_prefix, "c-gnu-interop-assemble", as_probe_cmd, log_c_gnu_interop, sizeof(log_c_gnu_interop)) == 0) {
                c_plus_gnu_exit = run_named_command(request_log_prefix, "c-gnu-interop-link", "gcc interop_main.o interop_gnu_helper.o -o interop_gnu_exec", log_c_gnu_interop, sizeof(log_c_gnu_interop));
            }
            gnu_undef_link_exit = run_named_command(request_log_prefix, "gnu-undef-link", "gcc gnu_undef.o -o gnu_undef_exec", log_gnu_undef_link, sizeof(log_gnu_undef_link));
        }
        if (strcmp(vlink_status, "present") == 0) {
            gnu_to_vlink_exit = run_named_command(
                request_log_prefix,
                "gnu-to-vlink",
                "vlink -belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ -nostdlib -fixunnamed -interp \"vbcc 0.9\" -Tvlibos4:script vlibos4:startup.o gnu_main.o -s -x -Lvlibos4: -LSObjs: -lvc -o gnu_vlink_exec",
                log_gnu_to_vlink,
                sizeof(log_gnu_to_vlink));
            if (gnu_to_vlink_exit == 0) {
                gnu_vlink_run_exit = run_named_command(request_log_prefix, "gnu-vlink-run", "gnu_vlink_exec", log_gnu_vlink_run, sizeof(log_gnu_vlink_run));
            }
            gnu_undef_vlink_exit = run_named_command(
                request_log_prefix,
                "gnu-undef-vlink",
                "vlink -belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ -nostdlib -fixunnamed -interp \"vbcc 0.9\" -Tvlibos4:script vlibos4:startup.o gnu_undef.o -s -x -Lvlibos4: -LSObjs: -lvc -o gnu_undef_vlink_exec",
                log_gnu_undef_vlink,
                sizeof(log_gnu_undef_vlink));
        }
    }

    if (strcmp(vasm_status, "present") == 0) {
        if (safe_snprintf(vasm_obj_cmd, sizeof(vasm_obj_cmd), "%s -Felf -o vasm_main.o vasm_main.s", vasm_tool) == 0) {
            vasm_obj_exit = run_named_command(request_log_prefix, "vasm-object", vasm_obj_cmd, log_vasm_object, sizeof(log_vasm_object));
        }
        if (vasm_obj_exit != 0 && strcmp(vasm_path, "vasmppc_std") != 0 && safe_snprintf(vasm_obj_cmd, sizeof(vasm_obj_cmd), "%s -Felf -o vasm_main.o vasm_main.s", vasm_path) == 0) {
            (void)append_text_file(log_vasm_object, "\n=== RETRY_WITH_DISCOVERED_PATH ===\n");
            vasm_obj_exit = run_named_command(request_log_prefix, "vasm-object-retry", vasm_obj_cmd, log_vasm_object_retry, sizeof(log_vasm_object_retry));
        } else {
            (void)safe_snprintf(vasm_obj_cmd, sizeof(vasm_obj_cmd), "%s -Felf -o vasm_main.o vasm_main.s", vasm_tool);
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -Felf -o vasm_include.o vasm_include.s", vasm_tool) == 0) {
            vasm_include_exit = run_named_command(request_log_prefix, "vasm-include", as_probe_cmd, log_vasm_include, sizeof(log_vasm_include));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -Felf -DVALUE=7 -o vasm_define.o vasm_define.s", vasm_tool) == 0) {
            vasm_define_exit = run_named_command(request_log_prefix, "vasm-define", as_probe_cmd, log_vasm_define, sizeof(log_vasm_define));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -Felf -o vasm_invalid.o vasm_invalid.s", vasm_tool) == 0) {
            vasm_error_exit = run_named_command(request_log_prefix, "vasm-error", as_probe_cmd, log_vasm_error, sizeof(log_vasm_error));
        }
        if (safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -Felf -o vasm_undef.o vasm_undef.s", vasm_tool) == 0) {
            vasm_undef_obj_exit = run_named_command(request_log_prefix, "vasm-undef-object", as_probe_cmd, log_vasm_undef_object, sizeof(log_vasm_undef_object));
        }
        if (strcmp(gcc_status, "present") == 0) {
            vasm_to_gnu_exit = run_named_command(request_log_prefix, "vasm-to-gnu", "gcc vasm_main.o -o vasm_gnu_exec", log_vasm_to_gnu, sizeof(log_vasm_to_gnu));
            if (vasm_to_gnu_exit == 0) {
                vasm_run_exit = run_named_command(request_log_prefix, "vasm-run", "vasm_gnu_exec", log_vasm_run, sizeof(log_vasm_run));
            }
            if (run_named_command(request_log_prefix, "c-vasm-interop-compile", "gcc -c interop_main.c -o interop_main2.o", log_c_vasm_interop, sizeof(log_c_vasm_interop)) == 0 &&
                safe_snprintf(as_probe_cmd, sizeof(as_probe_cmd), "%s -Felf -o interop_vasm_helper.o vasm_helper.s", vasm_tool) == 0 &&
                run_named_command(request_log_prefix, "c-vasm-interop-assemble", as_probe_cmd, log_c_vasm_interop, sizeof(log_c_vasm_interop)) == 0) {
                c_plus_vasm_exit = run_named_command(request_log_prefix, "c-vasm-interop-link", "gcc interop_main2.o interop_vasm_helper.o -o interop_vasm_exec", log_c_vasm_interop, sizeof(log_c_vasm_interop));
            }
            vasm_undef_link_exit = run_named_command(request_log_prefix, "vasm-undef-link", "gcc vasm_undef.o -o vasm_undef_exec", log_vasm_undef_link, sizeof(log_vasm_undef_link));
        }
        if (strcmp(vlink_status, "present") == 0) {
            vasm_to_vlink_exit = run_named_command(
                request_log_prefix,
                "vasm-to-vlink",
                "vlink -belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ -nostdlib -fixunnamed -interp \"vbcc 0.9\" -Tvlibos4:script vlibos4:startup.o vasm_main.o -s -x -Lvlibos4: -LSObjs: -lvc -o vasm_vlink_exec",
                log_vasm_to_vlink,
                sizeof(log_vasm_to_vlink));
            if (vasm_to_vlink_exit == 0) {
                vasm_vlink_run_exit = run_named_command(request_log_prefix, "vasm-vlink-run", "vasm_vlink_exec", log_vasm_vlink_run, sizeof(log_vasm_vlink_run));
            }
            vasm_undef_vlink_exit = run_named_command(
                request_log_prefix,
                "vasm-undef-vlink",
                "vlink -belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ -nostdlib -fixunnamed -interp \"vbcc 0.9\" -Tvlibos4:script vlibos4:startup.o vasm_undef.o -s -x -Lvlibos4: -LSObjs: -lvc -o vasm_undef_vlink_exec",
                log_vasm_undef_vlink,
                sizeof(log_vasm_undef_vlink));
        }
    }

    gnu_obj_size = file_size_or_zero("gnu_main.o");
    gnu_exec_size = file_size_or_zero("gnu_main_exec");
    vasm_obj_size = file_size_or_zero("vasm_main.o");
    vasm_exec_size = file_size_or_zero("vasm_gnu_exec");

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 2;
    }
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROBE_VERSION=1\n");
    (void)fprintf(artifact_fp, "OS4TB_ASM_REQUEST_ID=%s\n", request_id);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_AS_STATUS=%s\n", gnu_as_status);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_AS_PATH=%s\n", gnu_as_path);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_AS_VERSION=%s\n", gnu_as_version);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_STATUS=%s\n", vasm_status);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_PATH=%s\n", vasm_path);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_VERSION=%s\n", vasm_version);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VLINK_STATUS=%s\n", vlink_status);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VLINK_PATH=%s\n", vlink_path);

    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_OBJECT_CMD=%s\n", gnu_obj_cmd[0] ? gnu_obj_cmd : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_OBJECT_EXIT=%d\n", gnu_obj_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_OBJECT_SIZE=%ld\n", gnu_obj_size);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_INCLUDE_EXIT=%d\n", gnu_include_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_DEFINE_EXIT=%d\n", gnu_define_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_ERROR_EXIT=%d\n", gnu_error_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_LINK_EXIT=%d\n", gnu_link_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_EXEC_SIZE=%ld\n", gnu_exec_size);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_RUN_EXIT=%d\n", gnu_run_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_UNDEF_OBJECT_EXIT=%d\n", gnu_undef_obj_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_UNDEF_LINK_EXIT=%d\n", gnu_undef_link_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_UNDEF_VLINK_EXIT=%d\n", gnu_undef_vlink_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_TO_VLINK_EXIT=%d\n", gnu_to_vlink_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_GNU_TO_VLINK_RUN_EXIT=%d\n", gnu_vlink_run_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_C_PLUS_GNU_EXIT=%d\n", c_plus_gnu_exit);

    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_OBJECT_CMD=%s\n", vasm_obj_cmd[0] ? vasm_obj_cmd : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_OBJECT_EXIT=%d\n", vasm_obj_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_OBJECT_SIZE=%ld\n", vasm_obj_size);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_INCLUDE_EXIT=%d\n", vasm_include_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_DEFINE_EXIT=%d\n", vasm_define_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_ERROR_EXIT=%d\n", vasm_error_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_TO_GNU_EXIT=%d\n", vasm_to_gnu_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_TO_VLINK_EXIT=%d\n", vasm_to_vlink_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_TO_VLINK_RUN_EXIT=%d\n", vasm_vlink_run_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_RUN_EXIT=%d\n", vasm_run_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_EXEC_SIZE=%ld\n", vasm_exec_size);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_UNDEF_OBJECT_EXIT=%d\n", vasm_undef_obj_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_UNDEF_LINK_EXIT=%d\n", vasm_undef_link_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_VASM_UNDEF_VLINK_EXIT=%d\n", vasm_undef_vlink_exit);
    (void)fprintf(artifact_fp, "OS4TB_ASM_C_PLUS_VASM_EXIT=%d\n", c_plus_vasm_exit);

    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_OBJECT=%s\n", log_gnu_object[0] ? log_gnu_object : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_INCLUDE=%s\n", log_gnu_include[0] ? log_gnu_include : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_DEFINE=%s\n", log_gnu_define[0] ? log_gnu_define : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_ERROR=%s\n", log_gnu_error[0] ? log_gnu_error : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_LINK=%s\n", log_gnu_link[0] ? log_gnu_link : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_RUN=%s\n", log_gnu_run[0] ? log_gnu_run : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_UNDEF_OBJECT=%s\n", log_gnu_undef_object[0] ? log_gnu_undef_object : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_UNDEF_LINK=%s\n", log_gnu_undef_link[0] ? log_gnu_undef_link : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_UNDEF_VLINK=%s\n", log_gnu_undef_vlink[0] ? log_gnu_undef_vlink : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_TO_VLINK=%s\n", log_gnu_to_vlink[0] ? log_gnu_to_vlink : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_GNU_VLINK_RUN=%s\n", log_gnu_vlink_run[0] ? log_gnu_vlink_run : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_C_GNU_INTEROP=%s\n", log_c_gnu_interop[0] ? log_c_gnu_interop : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_OBJECT=%s\n", log_vasm_object[0] ? log_vasm_object : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_OBJECT_RETRY=%s\n", log_vasm_object_retry[0] ? log_vasm_object_retry : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_INCLUDE=%s\n", log_vasm_include[0] ? log_vasm_include : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_DEFINE=%s\n", log_vasm_define[0] ? log_vasm_define : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_ERROR=%s\n", log_vasm_error[0] ? log_vasm_error : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_TO_GNU=%s\n", log_vasm_to_gnu[0] ? log_vasm_to_gnu : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_TO_VLINK=%s\n", log_vasm_to_vlink[0] ? log_vasm_to_vlink : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_VLINK_RUN=%s\n", log_vasm_vlink_run[0] ? log_vasm_vlink_run : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_RUN=%s\n", log_vasm_run[0] ? log_vasm_run : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_UNDEF_OBJECT=%s\n", log_vasm_undef_object[0] ? log_vasm_undef_object : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_UNDEF_LINK=%s\n", log_vasm_undef_link[0] ? log_vasm_undef_link : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_VASM_UNDEF_VLINK=%s\n", log_vasm_undef_vlink[0] ? log_vasm_undef_vlink : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_LOG_C_VASM_INTEROP=%s\n", log_c_vasm_interop[0] ? log_c_vasm_interop : "unavailable");
    (void)fprintf(artifact_fp, "OS4TB_ASM_FINAL=PASS\n");
    fclose(artifact_fp);
    return 0;
}
