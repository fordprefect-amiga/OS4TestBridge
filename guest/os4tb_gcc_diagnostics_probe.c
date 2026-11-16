#include <dos/dos.h>
#include <proto/dos.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char *kErrorFixturePath = "SAMDROP:incoming/error_missing_semicolon.c";
static const char *kWarningFixturePath = "SAMDROP:incoming/warning_unused_variable.c";
static const char *kConfiguredCc1Path =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1";
static const char *kConfiguredCc1Prefix =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/";
static const char *kConfiguredAsPath =
    "Work:SDK/gcc/ppc-amigaos/bin/as";
static const char *kConfiguredAsPrefix =
    "Work:SDK/gcc/ppc-amigaos/bin/";
static const char *kVersionPath = "T:os4tb_gcc_diag_version.txt";
static const char *kCapturePath = "T:os4tb_gcc_diag_capture.txt";
static const char *kCc1PathReport = "T:os4tb_gcc_diag_cc1_path.txt";
static const char *kSearchDirsReport = "T:os4tb_gcc_diag_search_dirs.txt";
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

static int append_text_file(const char *path, const char *text) {
    FILE *fp = fopen(path, "ab");
    if (fp == NULL) {
        return 1;
    }
    if (fputs(text, fp) == EOF) {
        fclose(fp);
        return 1;
    }
    return fclose(fp) == 0 ? 0 : 1;
}

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
}

static BPTR open_output_file(const char *path) {
    return IDOS->Open(path, MODE_NEWFILE);
}

static int run_command_capture_both(const char *command, const char *output_path) {
    BPTR out_fh = open_output_file(output_path);
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

static int read_first_nonempty_line(const char *path, char *out, size_t out_cap) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 1;
    }

    while (fgets(out, (int)out_cap, fp) != NULL) {
        size_t len = strlen(out);
        while (len > 0U && (out[len - 1U] == '\n' || out[len - 1U] == '\r')) {
            out[--len] = '\0';
        }
        if (len > 0U) {
            fclose(fp);
            return 0;
        }
    }

    fclose(fp);
    return 1;
}

int main(int argc, char **argv) {
    const char *artifact_name = "phase7a_gcc_diagnostics.artifact";
    int version_rc = 1;
    int error_compile_rc = 1;
    int warning_compile_rc = 1;
    int error_fixture_present = 0;
    int warning_fixture_present = 0;
    int cc1_discovery_found = 0;
    int as_discovery_found = 0;
    int child_env_ready = 0;
    int toolchain_env_ready = 0;
    const char *cc1_discovery_method = "none";
    char version[64];
    char cc1_path[256];
    char as_path[256];
    char summary[1024];
    char diagnostics_name[160];
    char command_buf[640];
    int probe_ok = 0;
    FILE *artifact_fp = NULL;

    (void)argv;
    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }
    if (!is_safe_basename(artifact_name)) {
        return 7;
    }

    if (snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.gcc.txt", artifact_name) <= 0) {
        return 8;
    }
    if (!is_safe_basename(diagnostics_name)) {
        return 9;
    }

    if (write_text_file(diagnostics_name, "") != 0) {
        return 2;
    }

    version_rc = run_command_capture_both(
        "gcc -dumpfullversion -dumpversion",
        kVersionPath);
    if (version_rc != 0 || read_first_nonempty_line(kVersionPath, version, sizeof(version)) != 0) {
        (void)snprintf(version, sizeof(version), "unknown");
    }

    (void)snprintf(summary, sizeof(summary), "OS4TB_GCC_VERSION=%s\n", version);
    if (append_text_file(diagnostics_name, summary) != 0) {
        return 3;
    }
    if (append_text_file(
            diagnostics_name,
            "OS4TB_GCC_SYSTEMTAGS_USER_SHELL=TRUE\n") != 0) {
        return 3;
    }

    cc1_path[0] = '\0';
    as_path[0] = '\0';
    (void)run_command_capture_both("gcc -print-prog-name=cc1", kCc1PathReport);
    (void)run_command_capture_both("gcc -print-search-dirs", kSearchDirsReport);
    if (append_text_file(diagnostics_name, "=== GCC CC1 DISCOVERY ===\n") != 0) {
        return 3;
    }
    (void)append_file_to_file(diagnostics_name, kCc1PathReport);
    if (append_text_file(diagnostics_name, "=== GCC SEARCH DIRS ===\n") != 0) {
        return 3;
    }
    (void)append_file_to_file(diagnostics_name, kSearchDirsReport);

    if (file_is_readable(kConfiguredCc1Path)) {
        (void)snprintf(cc1_path, sizeof(cc1_path), "%s", kConfiguredCc1Path);
        cc1_discovery_found = 1;
        cc1_discovery_method = "configured_sdk_path";
    } else {
        cc1_discovery_found = 0;
        cc1_discovery_method = "configured_sdk_path";
    }
    if (file_is_readable(kConfiguredAsPath)) {
        (void)snprintf(as_path, sizeof(as_path), "%s", kConfiguredAsPath);
        as_discovery_found = 1;
    } else {
        as_discovery_found = 0;
    }
    child_env_ready = cc1_discovery_found ? 1 : 0;
    toolchain_env_ready = (cc1_discovery_found && as_discovery_found) ? 1 : 0;

    error_fixture_present = file_is_readable(kErrorFixturePath);
    warning_fixture_present = file_is_readable(kWarningFixturePath);
    if (append_text_file(
            diagnostics_name,
            "=== ERROR FIXTURE ===\n") != 0) {
        return 3;
    }
    if (!toolchain_env_ready) {
        (void)append_text_file(
            diagnostics_name,
            "toolchain helper discovery failed; skipping compile attempts\n");
        error_compile_rc = 127;
    } else if (error_fixture_present) {
        (void)snprintf(
            command_buf,
            sizeof(command_buf),
            "gcc -B%s -B%s -Wall -Wextra -c %s -o T:os4tb_gcc_diag_error.o",
            kConfiguredCc1Prefix,
            kConfiguredAsPrefix,
            kErrorFixturePath);
        error_compile_rc = run_command_capture_both(command_buf, kCapturePath);
        (void)append_file_to_file(diagnostics_name, kCapturePath);
    } else {
        (void)append_text_file(diagnostics_name, "fixture missing: SAMDROP:incoming/error_missing_semicolon.c\n");
        error_compile_rc = 127;
    }

    if (append_text_file(
            diagnostics_name,
            "=== WARNING FIXTURE ===\n") != 0) {
        return 3;
    }
    if (!toolchain_env_ready) {
        warning_compile_rc = 127;
    } else if (warning_fixture_present) {
        (void)snprintf(
            command_buf,
            sizeof(command_buf),
            "gcc -B%s -B%s -Wall -Wextra -Wno-error -c %s -o T:os4tb_gcc_diag_warning.o",
            kConfiguredCc1Prefix,
            kConfiguredAsPrefix,
            kWarningFixturePath);
        warning_compile_rc = run_command_capture_both(command_buf, kCapturePath);
        (void)append_file_to_file(diagnostics_name, kCapturePath);
    } else {
        (void)append_text_file(diagnostics_name, "fixture missing: SAMDROP:incoming/warning_unused_variable.c\n");
        warning_compile_rc = 127;
    }

    probe_ok = (version_rc == 0 && cc1_discovery_found && as_discovery_found &&
                child_env_ready && toolchain_env_ready &&
                error_fixture_present && warning_fixture_present &&
                error_compile_rc != 0 && warning_compile_rc == 0);

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_VERSION=%s\n", version);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_SYSTEMTAGS_USER_SHELL=%s\n",
        kUseUserShell ? "TRUE" : "FALSE");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_CC1_DISCOVERY=%s\n",
        cc1_discovery_found ? "found" : "missing");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_CC1_DISCOVERY_METHOD=%s\n",
        cc1_discovery_method);
    (void)fprintf(artifact_fp, "OS4TB_GCC_CC1_PATH=%s\n", cc1_discovery_found ? cc1_path : "unknown");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_AS_DISCOVERY=%s\n",
        as_discovery_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_AS_PATH=%s\n", as_discovery_found ? as_path : "unknown");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_CHILD_ENV=%s\n",
        child_env_ready ? "ready" : "not_ready");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_TOOLCHAIN_ENV=%s\n",
        toolchain_env_ready ? "ready" : "not_ready");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_ERROR_FIXTURE=%s\n",
        error_fixture_present ? "present" : "missing");
    (void)fprintf(
        artifact_fp,
        "OS4TB_GCC_WARNING_FIXTURE=%s\n",
        warning_fixture_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_VERSION_QUERY_EXIT=%d\n", version_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ERROR_COMPILE_EXIT=%d\n", error_compile_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_WARNING_COMPILE_EXIT=%d\n", warning_compile_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_PROBE_FINAL=%s\n", probe_ok ? "PASS" : "FAIL");
    if (fclose(artifact_fp) != 0) {
        return 5;
    }
    return probe_ok ? 0 : 6;
}
