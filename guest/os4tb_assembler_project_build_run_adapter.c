#include <proto/dos.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define OS4TB_MAX_PATH 320
#define OS4TB_MAX_TEXT 320
#define OS4TB_MAX_CMD 1024
#define OS4TB_MAX_SOURCES 8
#define OS4TB_MAX_INCLUDES 4
#define OS4TB_MAX_DEFINES 16

typedef struct Manifest {
    char assembler_id[32];
    char assembler_family[16];
    char assembler_path[OS4TB_MAX_PATH];
    char linker_model[16];
    char linker_path[OS4TB_MAX_PATH];
    char object_format[32];
    char run_program[8];
    int source_count;
    int include_count;
    int define_count;
    char source_names[OS4TB_MAX_SOURCES][160];
    char include_names[OS4TB_MAX_INCLUDES][160];
    char define_entries[OS4TB_MAX_DEFINES][96];
} Manifest;

static int is_safe_basename(const char *name) {
    size_t i = 0U;
    size_t len = strlen(name);
    if (len == 0U || len > 128U) {
        return 0;
    }
    if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0 || strstr(name, "..") != NULL) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)name[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int is_safe_relative_path(const char *name) {
    size_t i = 0U;
    size_t len = strlen(name);
    if (len == 0U || len > 159U || name[0] == '/' || name[len - 1] == '/') {
        return 0;
    }
    if (strstr(name, "..") != NULL || strstr(name, "//") != NULL || strchr(name, '\\') != NULL || strchr(name, ':') != NULL) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)name[i];
        if (c == '/') {
            continue;
        }
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.')) {
            return 0;
        }
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

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
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

static int join_project_path(char *dst, size_t cap, const char *project_dir, const char *name) {
    if (strstr(name, "..") != NULL || strchr(name, '\\') != NULL || strchr(name, ':') != NULL) {
        return -1;
    }
    return safe_snprintf(dst, cap, "%s/%s", project_dir, name);
}

static int is_valid_define(const char *token) {
    size_t i = 0U;
    size_t len = strlen(token);
    if (len == 0U || len > 95U) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)token[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '+' || c == '-' || c == '=')) {
            return 0;
        }
    }
    return 1;
}

static int parse_manifest(const char *path, Manifest *m) {
    char line[OS4TB_MAX_TEXT];
    FILE *fp = fopen(path, "rb");
    int seen_id = 0, seen_family = 0, seen_assembler = 0, seen_linker_model = 0, seen_linker_path = 0, seen_format = 0;
    int seen_source_count = 0, seen_include_count = 0, seen_define_count = 0, seen_run = 0;
    if (fp == NULL || m == NULL) {
        return -1;
    }
    memset(m, 0, sizeof(*m));
    while (fgets(line, sizeof(line), fp) != NULL) {
        char *eq = NULL;
        char *key = NULL;
        char *value = NULL;
        size_t len = strlen(line);
        while (len > 0U && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
            line[len - 1] = '\0';
            len -= 1U;
        }
        if (len == 0U) {
            continue;
        }
        eq = strchr(line, '=');
        if (eq == NULL || eq == line) {
            fclose(fp);
            return -2;
        }
        *eq = '\0';
        key = line;
        value = eq + 1;
        if (strcmp(key, "ASSEMBLER_ID") == 0) {
            if (!is_safe_basename(value)) {
                fclose(fp);
                return -3;
            }
            seen_id = 1;
            (void)snprintf(m->assembler_id, sizeof(m->assembler_id), "%s", value);
        } else if (strcmp(key, "ASSEMBLER_FAMILY") == 0) {
            if (strcmp(value, "gnu_as") != 0 && strcmp(value, "vasm") != 0) {
                fclose(fp);
                return -4;
            }
            seen_family = 1;
            (void)snprintf(m->assembler_family, sizeof(m->assembler_family), "%s", value);
        } else if (strcmp(key, "ASSEMBLER_PATH") == 0) {
            if (strstr(value, "..") != NULL || strchr(value, '\\') != NULL || strlen(value) >= sizeof(m->assembler_path)) {
                fclose(fp);
                return -5;
            }
            seen_assembler = 1;
            (void)snprintf(m->assembler_path, sizeof(m->assembler_path), "%s", value);
        } else if (strcmp(key, "LINKER_MODEL") == 0) {
            if (strcmp(value, "vlink") != 0) {
                fclose(fp);
                return -6;
            }
            seen_linker_model = 1;
            (void)snprintf(m->linker_model, sizeof(m->linker_model), "%s", value);
        } else if (strcmp(key, "LINKER_PATH") == 0) {
            if (strstr(value, "..") != NULL || strchr(value, '\\') != NULL || strlen(value) >= sizeof(m->linker_path)) {
                fclose(fp);
                return -7;
            }
            seen_linker_path = 1;
            (void)snprintf(m->linker_path, sizeof(m->linker_path), "%s", value);
        } else if (strcmp(key, "OBJECT_FORMAT") == 0) {
            if (strcmp(value, "elf32-powerpc") != 0) {
                fclose(fp);
                return -8;
            }
            seen_format = 1;
            (void)snprintf(m->object_format, sizeof(m->object_format), "%s", value);
        } else if (strcmp(key, "RUN_PROGRAM") == 0) {
            if (strcmp(value, "yes") != 0 && strcmp(value, "no") != 0) {
                fclose(fp);
                return -9;
            }
            seen_run = 1;
            (void)snprintf(m->run_program, sizeof(m->run_program), "%s", value);
        } else if (strcmp(key, "SOURCE_COUNT") == 0) {
            m->source_count = atoi(value);
            if (m->source_count < 1 || m->source_count > OS4TB_MAX_SOURCES) {
                fclose(fp);
                return -10;
            }
            seen_source_count = 1;
        } else if (strcmp(key, "INCLUDE_COUNT") == 0) {
            m->include_count = atoi(value);
            if (m->include_count < 0 || m->include_count > OS4TB_MAX_INCLUDES) {
                fclose(fp);
                return -11;
            }
            seen_include_count = 1;
        } else if (strcmp(key, "DEFINE_COUNT") == 0) {
            m->define_count = atoi(value);
            if (m->define_count < 0 || m->define_count > OS4TB_MAX_DEFINES) {
                fclose(fp);
                return -12;
            }
            seen_define_count = 1;
        } else if (strncmp(key, "SOURCE_", 7) == 0) {
            int idx = atoi(key + 7);
            if (idx < 0 || idx >= OS4TB_MAX_SOURCES || !is_safe_relative_path(value)) {
                fclose(fp);
                return -13;
            }
            (void)snprintf(m->source_names[idx], sizeof(m->source_names[idx]), "%s", value);
        } else if (strncmp(key, "INCLUDE_", 8) == 0) {
            int idx = atoi(key + 8);
            if (idx < 0 || idx >= OS4TB_MAX_INCLUDES || !is_safe_relative_path(value)) {
                fclose(fp);
                return -14;
            }
            (void)snprintf(m->include_names[idx], sizeof(m->include_names[idx]), "%s", value);
        } else if (strncmp(key, "DEFINE_", 7) == 0) {
            int idx = atoi(key + 7);
            if (idx < 0 || idx >= OS4TB_MAX_DEFINES || !is_valid_define(value)) {
                fclose(fp);
                return -15;
            }
            (void)snprintf(m->define_entries[idx], sizeof(m->define_entries[idx]), "%s", value);
        } else {
            fclose(fp);
            return -16;
        }
    }
    fclose(fp);
    if (!seen_id || !seen_family || !seen_assembler || !seen_linker_model || !seen_linker_path || !seen_format ||
        !seen_source_count || !seen_include_count || !seen_define_count || !seen_run) {
        return -17;
    }
    return 0;
}

int main(int argc, char **argv) {
    static Manifest manifest;
    static char request_id[128];
    static char project_dir[OS4TB_MAX_PATH];
    static char manifest_path[OS4TB_MAX_PATH];
    static char executable_name[220];
    static char diagnostics_name[220];
    static char link_command_file[220];
    static char link_output_file[220];
    static char run_output_file[220];
    static char assemble_cmd_file[OS4TB_MAX_SOURCES][220];
    static char assemble_output_file[OS4TB_MAX_SOURCES][220];
    static char source_paths[OS4TB_MAX_SOURCES][OS4TB_MAX_PATH];
    static char object_names[OS4TB_MAX_SOURCES][160];
    static int assemble_exit[OS4TB_MAX_SOURCES];
    static int assemble_attempted[OS4TB_MAX_SOURCES];
    static char command[OS4TB_MAX_CMD];
    int i = 0;
    int parse_rc = 0;
    int link_exit = 127;
    int program_exit = 127;
    int build_failed = 0;
    FILE *artifact_fp = NULL;

    if (argc < 2 || !is_safe_basename(argv[1])) {
        return 2;
    }
    memset(request_id, 0, sizeof(request_id));
    if (strlen(argv[1]) > strlen(".artifact") && strcmp(argv[1] + strlen(argv[1]) - strlen(".artifact"), ".artifact") == 0) {
        size_t n = strlen(argv[1]) - strlen(".artifact");
        if (n == 0U || n >= sizeof(request_id)) {
            return 2;
        }
        memcpy(request_id, argv[1], n);
        request_id[n] = '\0';
    } else {
        (void)snprintf(request_id, sizeof(request_id), "%s", argv[1]);
    }
    if (!is_safe_basename(request_id)) {
        return 2;
    }

    if (safe_snprintf(project_dir, sizeof(project_dir), "SAMDROP:incoming/project_%s", request_id) != 0 ||
        safe_snprintf(manifest_path, sizeof(manifest_path), "%s/assembler_project_manifest.txt", project_dir) != 0 ||
        safe_snprintf(executable_name, sizeof(executable_name), "build_%s_exec", request_id) != 0 ||
        safe_snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.asm.txt", argv[1]) != 0 ||
        safe_snprintf(link_command_file, sizeof(link_command_file), "%s.project-link-command.txt", argv[1]) != 0 ||
        safe_snprintf(link_output_file, sizeof(link_output_file), "%s.project-link.txt", argv[1]) != 0 ||
        safe_snprintf(run_output_file, sizeof(run_output_file), "%s.program.txt", argv[1]) != 0) {
        return 2;
    }

    (void)write_text_file(diagnostics_name, "");
    (void)write_text_file(link_command_file, "");
    (void)write_text_file(link_output_file, "");
    (void)write_text_file(run_output_file, "");

    parse_rc = parse_manifest(manifest_path, &manifest);
    if (parse_rc != 0) {
        build_failed = 1;
    }

    for (i = 0; i < OS4TB_MAX_SOURCES; i += 1) {
        assemble_exit[i] = 127;
        assemble_attempted[i] = 0;
    }

    for (i = 0; !build_failed && i < manifest.source_count; i += 1) {
        if (join_project_path(source_paths[i], sizeof(source_paths[i]), project_dir, manifest.source_names[i]) != 0 ||
            !file_is_readable(source_paths[i])) {
            build_failed = 1;
            break;
        }
        if (safe_snprintf(object_names[i], sizeof(object_names[i]), "build_%s_asm%d.o", request_id, i) != 0 ||
            safe_snprintf(assemble_cmd_file[i], sizeof(assemble_cmd_file[i]), "%s.project-assemble-command-%d.txt", argv[1], i) != 0 ||
            safe_snprintf(assemble_output_file[i], sizeof(assemble_output_file[i]), "%s.project-assemble-%d.txt", argv[1], i) != 0) {
            build_failed = 1;
            break;
        }
        (void)write_text_file(assemble_output_file[i], "");
        if (safe_snprintf(command, sizeof(command), "%s", manifest.assembler_path) != 0) {
            build_failed = 1;
            break;
        }
        {
            size_t used = strlen(command);
            int j = 0;
            for (j = 0; j < manifest.include_count; j += 1) {
                char include_path[OS4TB_MAX_PATH];
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
                if (strcmp(manifest.assembler_family, "gnu_as") == 0) {
                    if (safe_snprintf(command + used, sizeof(command) - used, " --defsym %s", manifest.define_entries[j]) != 0) {
                        build_failed = 1;
                        break;
                    }
                } else {
                    if (safe_snprintf(command + used, sizeof(command) - used, " -D%s", manifest.define_entries[j]) != 0) {
                        build_failed = 1;
                        break;
                    }
                }
                used = strlen(command);
            }
            if (build_failed) {
                break;
            }
            if (strcmp(manifest.assembler_family, "vasm") == 0) {
                if (safe_snprintf(command + used, sizeof(command) - used, " -Felf") != 0) {
                    build_failed = 1;
                    break;
                }
                used = strlen(command);
            }
            if (safe_snprintf(command + used, sizeof(command) - used, " -o %s %s", object_names[i], source_paths[i]) != 0) {
                build_failed = 1;
                break;
            }
        }
        (void)write_text_file(assemble_cmd_file[i], command);
        assemble_attempted[i] = 1;
        assemble_exit[i] = run_command_capture_both(command, assemble_output_file[i]);
        (void)append_text_file(diagnostics_name, "=== PROJECT_ASSEMBLE ===\n");
        {
            FILE *src = fopen(assemble_output_file[i], "rb");
            if (src != NULL) {
                char chunk[256];
                while (fgets(chunk, sizeof(chunk), src) != NULL) {
                    (void)append_text_file(diagnostics_name, chunk);
                }
                fclose(src);
            }
        }
        if (assemble_exit[i] != 0 || !file_is_readable(object_names[i])) {
            build_failed = 1;
            break;
        }
    }

    if (!build_failed) {
        int j = 0;
        if (safe_snprintf(command, sizeof(command), "%s -belf32amigaos -q -n -Cvbccelf -P_start -P__amigaos4__ -nostdlib -fixunnamed -interp \"vbcc 0.9\" -Tvlibos4:script vlibos4:startup.o", manifest.linker_path) != 0) {
            build_failed = 1;
        }
        for (j = 0; !build_failed && j < manifest.source_count; j += 1) {
            size_t used = strlen(command);
            if (safe_snprintf(command + used, sizeof(command) - used, " %s", object_names[j]) != 0) {
                build_failed = 1;
                break;
            }
        }
        if (!build_failed) {
            size_t used = strlen(command);
            if (safe_snprintf(command + used, sizeof(command) - used, " -s -x -Lvlibos4: -LSObjs: -lvc -o %s", executable_name) != 0) {
                build_failed = 1;
            }
        }
        if (!build_failed) {
            (void)write_text_file(link_command_file, command);
            link_exit = run_command_capture_both(command, link_output_file);
            (void)append_text_file(diagnostics_name, "=== PROJECT_LINK ===\n");
            {
                FILE *src = fopen(link_output_file, "rb");
                if (src != NULL) {
                    char chunk[256];
                    while (fgets(chunk, sizeof(chunk), src) != NULL) {
                        (void)append_text_file(diagnostics_name, chunk);
                    }
                    fclose(src);
                }
            }
            if (link_exit != 0 || !file_is_readable(executable_name)) {
                build_failed = 1;
            }
        }
    }

    if (!build_failed && strcmp(manifest.run_program, "yes") == 0) {
        if (safe_snprintf(command, sizeof(command), "%s", executable_name) != 0) {
            build_failed = 1;
        } else {
            program_exit = run_command_capture_both(command, run_output_file);
            if (program_exit != 0) {
                build_failed = 1;
            }
        }
    } else if (!build_failed) {
        program_exit = 0;
    }

    artifact_fp = fopen(argv[1], "wb");
    if (artifact_fp == NULL) {
        return 2;
    }
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_DIRECTORY=%s\n", project_dir);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_MANIFEST=%s\n", manifest_path);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_MANIFEST_STATUS=%s\n", parse_rc == 0 ? "ok" : "invalid");
    (void)fprintf(artifact_fp, "OS4TB_ASM_BUILD_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_ASSEMBLER_ID=%s\n", manifest.assembler_id[0] ? manifest.assembler_id : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_ASSEMBLER_FAMILY=%s\n", manifest.assembler_family[0] ? manifest.assembler_family : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_ASSEMBLER_PATH=%s\n", manifest.assembler_path[0] ? manifest.assembler_path : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_LINKER=%s\n", manifest.linker_model[0] ? manifest.linker_model : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_LINKER_PATH=%s\n", manifest.linker_path[0] ? manifest.linker_path : "unknown");
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_SOURCE_COUNT=%d\n", manifest.source_count);
    for (i = 0; i < manifest.source_count && i < OS4TB_MAX_SOURCES; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_SOURCE_%d=%s\n", i, manifest.source_names[i]);
        (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_OBJECT_%d=%s\n", i, object_names[i]);
        if (assemble_attempted[i]) {
            (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_ASSEMBLE_%d_EXIT=%d\n", i, assemble_exit[i]);
        } else {
            (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_ASSEMBLE_%d_EXIT=missing\n", i);
        }
    }
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_INCLUDE_COUNT=%d\n", manifest.include_count);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_DEFINE_COUNT=%d\n", manifest.define_count);
    if (link_exit != 127) {
        (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_LINK_EXIT=%d\n", link_exit);
    } else {
        (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_LINK_EXIT=missing\n");
    }
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_EXECUTABLE_NAME=%s\n", executable_name);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_EXECUTABLE_STATUS=%s\n", file_is_readable(executable_name) ? "present" : "missing");
    if (program_exit == 127) {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=not_run\n");
    } else {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=%d\n", program_exit);
    }
    (void)fprintf(artifact_fp, "OS4TB_PROGRAM_OUTPUT_FILE=%s\n", run_output_file);
    (void)fprintf(artifact_fp, "OS4TB_ASM_PROJECT_BUILD_FINAL=%s\n", build_failed ? "FAIL" : "PASS");
    (void)fprintf(artifact_fp, "OS4TB_ASM_BUILD_FINAL=%s\n", build_failed ? "FAIL" : "PASS");
    (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=%s\n", build_failed ? "NOT_RUN" : "PASS");
    fclose(artifact_fp);
    return 0;
}
