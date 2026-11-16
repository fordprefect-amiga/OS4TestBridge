#include <dos/dos.h>
#include <proto/dos.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *kConfiguredCc1Path =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1";
static const char *kConfiguredCc1Prefix =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/";
static const char *kConfiguredAsPath =
    "Work:SDK/gcc/ppc-amigaos/bin/as";
static const char *kConfiguredAsPrefix =
    "Work:SDK/gcc/ppc-amigaos/bin/";
static const char *kCapturePath = "T:os4tb_gcc_compile_capture.txt";
static const int kUseUserShell = 1;

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

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
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

int main(int argc, char **argv) {
    const char *artifact_name = "phase7c_gcc_compile.artifact";
    char request_id[96];
    char staged_source[128];
    char staged_source_path[256];
    char diagnostics_name[160];
    char object_name[128];
    char command_buf[640];
    int compile_rc = 127;
    int cc1_found = 0;
    int as_found = 0;
    int toolchain_ready = 0;
    int source_present = 0;
    int object_present = 0;
    int compile_ok = 0;
    FILE *artifact_fp = NULL;
    size_t artifact_len = 0U;

    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }
    if (!is_safe_basename(artifact_name)) {
        return 7;
    }
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

    (void)snprintf(staged_source, sizeof(staged_source), "compile_%s_source.c", request_id);
    (void)snprintf(staged_source_path, sizeof(staged_source_path), "SAMDROP:incoming/%s", staged_source);
    (void)snprintf(object_name, sizeof(object_name), "compile_%s.o", request_id);
    (void)snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.gcc.txt", artifact_name);
    if (!is_safe_basename(diagnostics_name) || !is_safe_basename(object_name) || !is_safe_basename(staged_source)) {
        return 10;
    }

    if (write_text_file(diagnostics_name, "") != 0) {
        return 2;
    }

    cc1_found = file_is_readable(kConfiguredCc1Path);
    as_found = file_is_readable(kConfiguredAsPath);
    toolchain_ready = (cc1_found && as_found) ? 1 : 0;
    source_present = file_is_readable(staged_source_path);

    if (toolchain_ready && source_present) {
        (void)snprintf(
            command_buf,
            sizeof(command_buf),
            "gcc -B%s -B%s -Wall -Wextra -c %s -o %s",
            kConfiguredCc1Prefix,
            kConfiguredAsPrefix,
            staged_source_path,
            object_name);
        compile_rc = run_command_capture_both(command_buf, kCapturePath);
        (void)append_file_to_file(diagnostics_name, kCapturePath);
    } else {
        if (!toolchain_ready) {
            (void)write_text_file(diagnostics_name, "toolchain helper discovery failed; skipping compile\n");
        } else {
            (void)write_text_file(diagnostics_name, "source file missing; skipping compile\n");
        }
        compile_rc = 127;
    }

    object_present = file_exists_non_empty(object_name);
    compile_ok = (compile_rc == 0 && object_present) ? 1 : 0;

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_COMPILE_SOURCE=%s\n", staged_source_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_COMPILE_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_COMPILE_EXIT=%d\n", compile_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_OBJECT_STATUS=%s\n", object_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_OBJECT_NAME=%s\n", object_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_CC1_DISCOVERY=%s\n", cc1_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_AS_DISCOVERY=%s\n", as_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_TOOLCHAIN_ENV=%s\n", toolchain_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_SOURCE_STATUS=%s\n", source_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_COMPILE_FINAL=%s\n", compile_ok ? "PASS" : "FAIL");
    if (fclose(artifact_fp) != 0) {
        return 5;
    }

    return 0;
}

