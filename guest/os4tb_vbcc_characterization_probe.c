#include <proto/dos.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define OS4TB_MAX_TEXT 320
#define OS4TB_MAX_CMD 700
#define OS4TB_MAX_CASES 8

typedef struct CommandProbe {
    const char *name;
    const char *command;
} CommandProbe;

typedef struct CaseResult {
    const char *name;
    const char *command;
    int exit_code;
    int output_present;
    long output_size;
    char output_file[OS4TB_MAX_TEXT];
} CaseResult;

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
        while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r' || line[len - 1] == '\t' || line[len - 1] == ' ')) {
            line[len - 1] = '\0';
            len -= 1;
        }
        if (len > 0) {
            snprintf(out, out_cap, "%s", line);
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

static int line_indicates_useless_version(const char *line) {
    return strstr(line, "No objects to link") != NULL;
}

static void detect_command_presence_and_version(
    const char *command_name,
    const char *probe1,
    const char *probe2,
    char out_status[24],
    char out_version[OS4TB_MAX_TEXT],
    char out_path[OS4TB_MAX_TEXT]) {
    char first_line[OS4TB_MAX_TEXT];
    const char *capture = "vbcc_probe_cmd.txt";
    char which_cmd[OS4TB_MAX_TEXT];
    snprintf(out_status, 24, "%s", "missing");
    snprintf(out_version, OS4TB_MAX_TEXT, "%s", "unknown");
    snprintf(out_path, OS4TB_MAX_TEXT, "%s", "unknown");

    if (run_command_capture_both(probe1, capture) == 0 && read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0) {
        if (!line_indicates_missing_command(first_line)) {
            snprintf(out_status, 24, "%s", "present");
            if (!line_indicates_useless_version(first_line)) {
                snprintf(out_version, OS4TB_MAX_TEXT, "%s", first_line);
            }
        }
    }
    if (strcmp(out_status, "missing") == 0 &&
        run_command_capture_both(probe2, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        !line_indicates_missing_command(first_line)) {
        snprintf(out_status, 24, "%s", "present");
        if (!line_indicates_useless_version(first_line)) {
            snprintf(out_version, OS4TB_MAX_TEXT, "%s", first_line);
        }
    }

    snprintf(which_cmd, sizeof(which_cmd), "Which %s", command_name);
    if (run_command_capture_both(which_cmd, capture) == 0 && read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0) {
        if (!line_indicates_missing_command(first_line)) {
            snprintf(out_path, OS4TB_MAX_TEXT, "%s", first_line);
            return;
        }
    }
    snprintf(which_cmd, sizeof(which_cmd), "which %s", command_name);
    if (run_command_capture_both(which_cmd, capture) == 0 && read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0) {
        if (!line_indicates_missing_command(first_line)) {
            snprintf(out_path, OS4TB_MAX_TEXT, "%s", first_line);
        }
    }
}

static int write_text_file(const char *path, const char *content) {
    FILE *fp = fopen(path, "wb");
    if (fp == NULL) {
        return -1;
    }
    if (fputs(content, fp) == EOF) {
        fclose(fp);
        return -1;
    }
    if (fclose(fp) != 0) {
        return -1;
    }
    return 0;
}

static void run_probe_case(
    const char *stage,
    const char *probe_name,
    int index,
    const char *command,
    const char *expected_output,
    CaseResult *out_result) {
    char output_file[OS4TB_MAX_TEXT];
    snprintf(output_file, sizeof(output_file), "vbcc_probe_%s_%s_%d.out.txt", stage, probe_name, index);
    out_result->name = probe_name;
    out_result->command = command;
    out_result->exit_code = run_command_capture_both(command, output_file);
    out_result->output_present = file_exists_non_empty(expected_output) ? 1 : 0;
    out_result->output_size = file_size_or_zero(expected_output);
    snprintf(out_result->output_file, sizeof(out_result->output_file), "%s", output_file);
}

int main(int argc, char **argv) {
    const char *artifact_name = "vbcc_probe.artifact";
    FILE *artifact_fp = NULL;
    int i = 0;

    char vc_status[24], vc_version[OS4TB_MAX_TEXT], vc_path[OS4TB_MAX_TEXT];
    char vbcc_status[24], vbcc_version[OS4TB_MAX_TEXT], vbcc_path[OS4TB_MAX_TEXT];
    char vasm_status[24], vasm_version[OS4TB_MAX_TEXT], vasm_path[OS4TB_MAX_TEXT];
    char vlink_status[24], vlink_version[OS4TB_MAX_TEXT], vlink_path[OS4TB_MAX_TEXT];

    const char *single_src = "vbcc_single_main.c";
    const char *single_exe = "vbcc_single_exec";
    const char *multi_main = "vbcc_multi_main.c";
    const char *multi_helper = "vbcc_multi_helper.c";
    const char *multi_exe = "vbcc_multi_exec";
    const char *include_header = "vbcc_demo.h";
    const char *include_src = "vbcc_include_main.c";
    const char *include_exe = "vbcc_include_exec";
    const char *define_src = "vbcc_define_main.c";
    const char *define_exe = "vbcc_define_exec";
    const char *diag_src = "vbcc_diag_error.c";
    const char *diag_obj = "vbcc_diag_error.o";
    const char *lib_src = "vbcc_lib_main.c";
    const char *lib_exe = "vbcc_lib_exec";

    char run_single_cmd[OS4TB_MAX_CMD];
    char run_multi_cmd[OS4TB_MAX_CMD];
    char run_include_cmd[OS4TB_MAX_CMD];
    char run_define_cmd[OS4TB_MAX_CMD];
    char driver_choice[16];
    CaseResult single_cases[OS4TB_MAX_CASES];
    CaseResult multi_cases[OS4TB_MAX_CASES];
    CaseResult include_cases[OS4TB_MAX_CASES];
    CaseResult define_cases[OS4TB_MAX_CASES];
    CaseResult lib_cases[OS4TB_MAX_CASES];
    CaseResult diag_cases[OS4TB_MAX_CASES];

    const CommandProbe single_probe_cmds[] = {
        {"vc-default", "vc vbcc_single_main.c -o vbcc_single_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_single_main.c -o vbcc_single_exec"},
        {"vbcc-default", "vbcc vbcc_single_main.c -o vbcc_single_exec"},
        {"vbcc-aosppc", "vbcc +aosppc vbcc_single_main.c -o vbcc_single_exec"}
    };
    const CommandProbe multi_probe_cmds[] = {
        {"vc-default", "vc vbcc_multi_main.c vbcc_multi_helper.c -o vbcc_multi_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_multi_main.c vbcc_multi_helper.c -o vbcc_multi_exec"},
        {"vbcc-default", "vbcc vbcc_multi_main.c vbcc_multi_helper.c -o vbcc_multi_exec"},
        {"vbcc-aosppc", "vbcc +aosppc vbcc_multi_main.c vbcc_multi_helper.c -o vbcc_multi_exec"}
    };
    const CommandProbe include_probe_cmds[] = {
        {"vc-default", "vc vbcc_include_main.c -I. -o vbcc_include_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_include_main.c -I. -o vbcc_include_exec"},
        {"vbcc-default", "vbcc vbcc_include_main.c -I. -o vbcc_include_exec"},
        {"vbcc-aosppc", "vbcc +aosppc vbcc_include_main.c -I. -o vbcc_include_exec"}
    };
    const CommandProbe define_probe_cmds[] = {
        {"vc-default", "vc vbcc_define_main.c -DVALUE=7 -o vbcc_define_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_define_main.c -DVALUE=7 -o vbcc_define_exec"},
        {"vbcc-default", "vbcc vbcc_define_main.c -DVALUE=7 -o vbcc_define_exec"},
        {"vbcc-aosppc", "vbcc +aosppc vbcc_define_main.c -DVALUE=7 -o vbcc_define_exec"}
    };
    const CommandProbe lib_probe_cmds[] = {
        {"vc-default", "vc vbcc_lib_main.c -lexpat -o vbcc_lib_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_lib_main.c -lexpat -o vbcc_lib_exec"},
        {"vbcc-default", "vbcc vbcc_lib_main.c -lexpat -o vbcc_lib_exec"},
        {"vbcc-aosppc", "vbcc +aosppc vbcc_lib_main.c -lexpat -o vbcc_lib_exec"}
    };
    const CommandProbe diag_probe_cmds[] = {
        {"vc-default", "vc -c vbcc_diag_error.c -o vbcc_diag_error.o"},
        {"vc-aosppc", "vc +aosppc -c vbcc_diag_error.c -o vbcc_diag_error.o"},
        {"vbcc-default", "vbcc -c vbcc_diag_error.c -o vbcc_diag_error.o"},
        {"vbcc-aosppc", "vbcc +aosppc -c vbcc_diag_error.c -o vbcc_diag_error.o"}
    };
    const CommandProbe std_c90_probe_cmds[] = {
        {"vc-default", "vc vbcc_std_c90.c -o vbcc_std_c90_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_std_c90.c -o vbcc_std_c90_exec"}
    };
    const CommandProbe std_c99_probe_cmds[] = {
        {"vc-default", "vc vbcc_std_c99.c -o vbcc_std_c99_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_std_c99.c -o vbcc_std_c99_exec"},
        {"vc-c99", "vc -c99 vbcc_std_c99.c -o vbcc_std_c99_exec"}
    };
    const CommandProbe std_c11_probe_cmds[] = {
        {"vc-default", "vc vbcc_std_c11.c -o vbcc_std_c11_exec"},
        {"vc-aosppc", "vc +aosppc vbcc_std_c11.c -o vbcc_std_c11_exec"},
        {"vc-c11", "vc -c11 vbcc_std_c11.c -o vbcc_std_c11_exec"}
    };
    const int std_c90_probe_count = (int)(sizeof(std_c90_probe_cmds) / sizeof(std_c90_probe_cmds[0]));
    const int std_c99_probe_count = (int)(sizeof(std_c99_probe_cmds) / sizeof(std_c99_probe_cmds[0]));
    const int std_c11_probe_count = (int)(sizeof(std_c11_probe_cmds) / sizeof(std_c11_probe_cmds[0]));
    const CommandProbe warning_probe_cmds[] = {
        {"default", "vc -c vbcc_single_main.c -o vbcc_warn_default.o"},
        {"extra", "vc -Wall -Wextra -c vbcc_single_main.c -o vbcc_warn_extra.o"},
        {"strict", "vc -Wall -Wextra -Werror -c vbcc_single_main.c -o vbcc_warn_strict.o"}
    };
    const CommandProbe optimization_probe_cmds[] = {
        {"none", "vc -O0 -c vbcc_single_main.c -o vbcc_opt_none.o"},
        {"debug", "vc -Og -c vbcc_single_main.c -o vbcc_opt_debug.o"},
        {"release", "vc -O2 -c vbcc_single_main.c -o vbcc_opt_release.o"}
    };
    const CommandProbe debug_probe_cmds[] = {
        {"debug_no", "vc -c vbcc_single_main.c -o vbcc_dbg_no.o"},
        {"debug_yes", "vc -g -c vbcc_single_main.c -o vbcc_dbg_yes.o"}
    };
    const int warning_probe_count = (int)(sizeof(warning_probe_cmds) / sizeof(warning_probe_cmds[0]));
    const int optimization_probe_count = (int)(sizeof(optimization_probe_cmds) / sizeof(optimization_probe_cmds[0]));
    const int debug_probe_count = (int)(sizeof(debug_probe_cmds) / sizeof(debug_probe_cmds[0]));
    const int single_probe_count = (int)(sizeof(single_probe_cmds) / sizeof(single_probe_cmds[0]));
    const int multi_probe_count = (int)(sizeof(multi_probe_cmds) / sizeof(multi_probe_cmds[0]));
    const int include_probe_count = (int)(sizeof(include_probe_cmds) / sizeof(include_probe_cmds[0]));
    const int define_probe_count = (int)(sizeof(define_probe_cmds) / sizeof(define_probe_cmds[0]));
    const int lib_probe_count = (int)(sizeof(lib_probe_cmds) / sizeof(lib_probe_cmds[0]));
    const int diag_probe_count = (int)(sizeof(diag_probe_cmds) / sizeof(diag_probe_cmds[0]));
    int single_success_index = -1;
    int multi_success_index = -1;
    int include_success_index = -1;
    int define_success_index = -1;
    int lib_success_index = -1;
    int diag_failure_index = -1;
    int std_c90_success_index = -1;
    int std_c99_success_index = -1;
    int std_c11_success_index = -1;
    int warning_success_mask = 0;
    int optimization_success_mask = 0;
    int debug_success_mask = 0;
    int single_run_rc = 127;
    int multi_run_rc = 127;
    int include_run_rc = 127;
    int define_run_rc = 127;
    CaseResult std_c90_cases[4];
    CaseResult std_c99_cases[4];
    CaseResult std_c11_cases[4];
    CaseResult warning_cases[4];
    CaseResult optimization_cases[4];
    CaseResult debug_cases[4];
    CaseResult verbose_case;

    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }

    (void)remove(single_exe);
    (void)remove(multi_exe);
    (void)remove(include_exe);
    (void)remove(define_exe);
    (void)remove(lib_exe);
    (void)remove(diag_obj);

    if (write_text_file(single_src, "int main(void){return 0;}\n") != 0 ||
        write_text_file(multi_main, "int helper(void);\nint main(void){return helper();}\n") != 0 ||
        write_text_file(multi_helper, "int helper(void){return 0;}\n") != 0 ||
        write_text_file(include_header, "#define DEMO_VALUE 0\n") != 0 ||
        write_text_file(include_src, "#include \"vbcc_demo.h\"\nint main(void){return DEMO_VALUE;}\n") != 0 ||
        write_text_file(define_src, "#ifndef VALUE\n#error VALUE missing\n#endif\nint main(void){return (VALUE==7)?0:1;}\n") != 0 ||
        write_text_file(diag_src, "int main(void){ return missing_symbol; }\n") != 0 ||
        write_text_file("vbcc_std_c90.c", "int main(void){ int x=0; x+=1; return x-1; }\n") != 0 ||
        write_text_file("vbcc_std_c99.c", "int main(void){ for(int i=0;i<1;i++){} return 0; }\n") != 0 ||
        write_text_file("vbcc_std_c11.c", "_Static_assert(1,\"ok\"); int main(void){ return 0; }\n") != 0 ||
        write_text_file(lib_src, "#include <expat.h>\nint main(void){ XML_Parser p = XML_ParserCreate(NULL); return p?0:1; }\n") != 0) {
        return 3;
    }

    detect_command_presence_and_version("vc", "vc -version", "vc --version", vc_status, vc_version, vc_path);
    detect_command_presence_and_version("vbcc", "vbcc -version", "vbcc --version", vbcc_status, vbcc_version, vbcc_path);
    detect_command_presence_and_version("vasm", "vasm -version", "vasm --version", vasm_status, vasm_version, vasm_path);
    detect_command_presence_and_version("vlink", "vlink -version", "vlink --version", vlink_status, vlink_version, vlink_path);

    for (i = 0; i < single_probe_count; i += 1) {
        run_probe_case("single", single_probe_cmds[i].name, i, single_probe_cmds[i].command, single_exe, &single_cases[i]);
        if (single_success_index < 0 && single_cases[i].exit_code == 0 && single_cases[i].output_present == 1) {
            single_success_index = i;
        }
    }
    for (i = 0; i < multi_probe_count; i += 1) {
        run_probe_case("multi", multi_probe_cmds[i].name, i, multi_probe_cmds[i].command, multi_exe, &multi_cases[i]);
        if (multi_success_index < 0 && multi_cases[i].exit_code == 0 && multi_cases[i].output_present == 1) {
            multi_success_index = i;
        }
    }
    for (i = 0; i < include_probe_count; i += 1) {
        run_probe_case("include", include_probe_cmds[i].name, i, include_probe_cmds[i].command, include_exe, &include_cases[i]);
        if (include_success_index < 0 && include_cases[i].exit_code == 0 && include_cases[i].output_present == 1) {
            include_success_index = i;
        }
    }
    for (i = 0; i < define_probe_count; i += 1) {
        run_probe_case("define", define_probe_cmds[i].name, i, define_probe_cmds[i].command, define_exe, &define_cases[i]);
        if (define_success_index < 0 && define_cases[i].exit_code == 0 && define_cases[i].output_present == 1) {
            define_success_index = i;
        }
    }
    for (i = 0; i < lib_probe_count; i += 1) {
        run_probe_case("library", lib_probe_cmds[i].name, i, lib_probe_cmds[i].command, lib_exe, &lib_cases[i]);
        if (lib_success_index < 0 && lib_cases[i].exit_code == 0 && lib_cases[i].output_present == 1) {
            lib_success_index = i;
        }
    }
    for (i = 0; i < diag_probe_count; i += 1) {
        run_probe_case("diag", diag_probe_cmds[i].name, i, diag_probe_cmds[i].command, diag_obj, &diag_cases[i]);
        if (diag_failure_index < 0 && diag_cases[i].exit_code != 0) {
            diag_failure_index = i;
        }
    }
    for (i = 0; i < std_c90_probe_count; i += 1) {
        run_probe_case("stdc90", std_c90_probe_cmds[i].name, i, std_c90_probe_cmds[i].command, "vbcc_std_c90_exec", &std_c90_cases[i]);
        if (std_c90_success_index < 0 && std_c90_cases[i].exit_code == 0 && std_c90_cases[i].output_present == 1) {
            std_c90_success_index = i;
        }
    }
    for (i = 0; i < std_c99_probe_count; i += 1) {
        run_probe_case("stdc99", std_c99_probe_cmds[i].name, i, std_c99_probe_cmds[i].command, "vbcc_std_c99_exec", &std_c99_cases[i]);
        if (std_c99_success_index < 0 && std_c99_cases[i].exit_code == 0 && std_c99_cases[i].output_present == 1) {
            std_c99_success_index = i;
        }
    }
    for (i = 0; i < std_c11_probe_count; i += 1) {
        run_probe_case("stdc11", std_c11_probe_cmds[i].name, i, std_c11_probe_cmds[i].command, "vbcc_std_c11_exec", &std_c11_cases[i]);
        if (std_c11_success_index < 0 && std_c11_cases[i].exit_code == 0 && std_c11_cases[i].output_present == 1) {
            std_c11_success_index = i;
        }
    }
    for (i = 0; i < warning_probe_count; i += 1) {
        char obj_name[32];
        snprintf(obj_name, sizeof(obj_name), "vbcc_warn_%s.o", warning_probe_cmds[i].name);
        run_probe_case("warning", warning_probe_cmds[i].name, i, warning_probe_cmds[i].command, obj_name, &warning_cases[i]);
        if (warning_cases[i].exit_code == 0) {
            warning_success_mask |= (1 << i);
        }
    }
    for (i = 0; i < optimization_probe_count; i += 1) {
        char obj_name[32];
        snprintf(obj_name, sizeof(obj_name), "vbcc_opt_%s.o", optimization_probe_cmds[i].name);
        run_probe_case("opt", optimization_probe_cmds[i].name, i, optimization_probe_cmds[i].command, obj_name, &optimization_cases[i]);
        if (optimization_cases[i].exit_code == 0) {
            optimization_success_mask |= (1 << i);
        }
    }
    for (i = 0; i < debug_probe_count; i += 1) {
        char obj_name[32];
        snprintf(obj_name, sizeof(obj_name), "vbcc_dbg_%s.o", i == 0 ? "no" : "yes");
        run_probe_case("debug", debug_probe_cmds[i].name, i, debug_probe_cmds[i].command, obj_name, &debug_cases[i]);
        if (debug_cases[i].exit_code == 0) {
            debug_success_mask |= (1 << i);
        }
    }

    if (single_success_index >= 0) {
        snprintf(run_single_cmd, sizeof(run_single_cmd), "%s", single_exe);
        single_run_rc = run_command_capture_both(run_single_cmd, "vbcc_probe_single_run.out.txt");
    }
    if (multi_success_index >= 0) {
        snprintf(run_multi_cmd, sizeof(run_multi_cmd), "%s", multi_exe);
        multi_run_rc = run_command_capture_both(run_multi_cmd, "vbcc_probe_multi_run.out.txt");
    }
    if (include_success_index >= 0) {
        snprintf(run_include_cmd, sizeof(run_include_cmd), "%s", include_exe);
        include_run_rc = run_command_capture_both(run_include_cmd, "vbcc_probe_include_run.out.txt");
    }
    if (define_success_index >= 0) {
        snprintf(run_define_cmd, sizeof(run_define_cmd), "%s", define_exe);
        define_run_rc = run_command_capture_both(run_define_cmd, "vbcc_probe_define_run.out.txt");
    }
    run_probe_case("verbose", "vc", 0, "vc -v vbcc_single_main.c -o vbcc_verbose_exec", "vbcc_verbose_exec", &verbose_case);

    if (strcmp(vc_status, "present") == 0) {
        snprintf(driver_choice, sizeof(driver_choice), "%s", "vc");
    } else if (strcmp(vbcc_status, "present") == 0) {
        snprintf(driver_choice, sizeof(driver_choice), "%s", "vbcc");
    } else {
        snprintf(driver_choice, sizeof(driver_choice), "%s", "unknown");
    }

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }

    fprintf(artifact_fp, "OS4TB_VBCC_PROBE_VERSION=1\n");
    fprintf(artifact_fp, "OS4TB_VBCC_DRIVER_CHOICE=%s\n", driver_choice);
    fprintf(artifact_fp, "OS4TB_VBCC_VC_STATUS=%s\n", vc_status);
    fprintf(artifact_fp, "OS4TB_VBCC_VC_VERSION=%s\n", vc_version);
    fprintf(artifact_fp, "OS4TB_VBCC_VC_PATH=%s\n", vc_path);
    fprintf(artifact_fp, "OS4TB_VBCC_VBCC_STATUS=%s\n", vbcc_status);
    fprintf(artifact_fp, "OS4TB_VBCC_VBCC_VERSION=%s\n", vbcc_version);
    fprintf(artifact_fp, "OS4TB_VBCC_VBCC_PATH=%s\n", vbcc_path);
    fprintf(artifact_fp, "OS4TB_VBCC_VASM_STATUS=%s\n", vasm_status);
    fprintf(artifact_fp, "OS4TB_VBCC_VASM_VERSION=%s\n", vasm_version);
    fprintf(artifact_fp, "OS4TB_VBCC_VASM_PATH=%s\n", vasm_path);
    fprintf(artifact_fp, "OS4TB_VBCC_VLINK_STATUS=%s\n", vlink_status);
    fprintf(artifact_fp, "OS4TB_VBCC_VLINK_VERSION=%s\n", vlink_version);
    fprintf(artifact_fp, "OS4TB_VBCC_VLINK_PATH=%s\n", vlink_path);

    fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_PROBE_COUNT=%d\n", single_probe_count);
    for (i = 0; i < single_probe_count; i += 1) {
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_NAME=%s\n", i, single_probe_cmds[i].name);
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_COMMAND=%s\n", i, single_probe_cmds[i].command);
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_EXIT=%d\n", i, single_cases[i].exit_code);
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_OUTPUT_PRESENT=%d\n", i, single_cases[i].output_present);
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_OUTPUT_SIZE=%ld\n", i, single_cases[i].output_size);
        fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_%d_LOG_FILE=%s\n", i, single_cases[i].output_file);
    }
    fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_SUCCESS_INDEX=%d\n", single_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_RUN_EXIT=%d\n", single_run_rc);
    fprintf(artifact_fp, "OS4TB_VBCC_SINGLE_EXEC_SIZE=%ld\n", file_size_or_zero(single_exe));

    fprintf(artifact_fp, "OS4TB_VBCC_MULTI_PROBE_COUNT=%d\n", multi_probe_count);
    for (i = 0; i < multi_probe_count; i += 1) {
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_NAME=%s\n", i, multi_probe_cmds[i].name);
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_COMMAND=%s\n", i, multi_probe_cmds[i].command);
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_EXIT=%d\n", i, multi_cases[i].exit_code);
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_OUTPUT_PRESENT=%d\n", i, multi_cases[i].output_present);
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_OUTPUT_SIZE=%ld\n", i, multi_cases[i].output_size);
        fprintf(artifact_fp, "OS4TB_VBCC_MULTI_%d_LOG_FILE=%s\n", i, multi_cases[i].output_file);
    }
    fprintf(artifact_fp, "OS4TB_VBCC_MULTI_SUCCESS_INDEX=%d\n", multi_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_MULTI_RUN_EXIT=%d\n", multi_run_rc);
    fprintf(artifact_fp, "OS4TB_VBCC_MULTI_EXEC_SIZE=%ld\n", file_size_or_zero(multi_exe));

    fprintf(artifact_fp, "OS4TB_VBCC_INCLUDE_SUCCESS_INDEX=%d\n", include_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_INCLUDE_RUN_EXIT=%d\n", include_run_rc);
    fprintf(artifact_fp, "OS4TB_VBCC_DEFINE_SUCCESS_INDEX=%d\n", define_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_DEFINE_RUN_EXIT=%d\n", define_run_rc);
    fprintf(artifact_fp, "OS4TB_VBCC_LIBRARY_SUCCESS_INDEX=%d\n", lib_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_DIAG_FAILURE_INDEX=%d\n", diag_failure_index);
    fprintf(artifact_fp, "OS4TB_VBCC_STD_C90_SUCCESS_INDEX=%d\n", std_c90_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_STD_C99_SUCCESS_INDEX=%d\n", std_c99_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_STD_C11_SUCCESS_INDEX=%d\n", std_c11_success_index);
    fprintf(artifact_fp, "OS4TB_VBCC_WARNING_SUCCESS_MASK=%d\n", warning_success_mask);
    fprintf(artifact_fp, "OS4TB_VBCC_OPT_SUCCESS_MASK=%d\n", optimization_success_mask);
    fprintf(artifact_fp, "OS4TB_VBCC_DEBUG_SUCCESS_MASK=%d\n", debug_success_mask);
    fprintf(artifact_fp, "OS4TB_VBCC_VERBOSE_COMMAND=%s\n", verbose_case.command);
    fprintf(artifact_fp, "OS4TB_VBCC_VERBOSE_EXIT=%d\n", verbose_case.exit_code);
    fprintf(artifact_fp, "OS4TB_VBCC_VERBOSE_LOG_FILE=%s\n", verbose_case.output_file);

    if (fclose(artifact_fp) != 0) {
        return 5;
    }
    return 0;
}
