#include <dos/dos.h>
#include <dos/dosextens.h>
#include <proto/dos.h>
#include <dirent.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static const char *kConfiguredCc1Path =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/cc1";
static const char *kConfiguredCc1Prefix =
    "Work:SDK/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/11.5.0/";
static const char *kConfiguredAsPath =
    "Work:SDK/gcc/ppc-amigaos/bin/as";
static const char *kConfiguredAsPrefix =
    "Work:SDK/gcc/ppc-amigaos/bin/";
static const char *kConfiguredRuntimeLibPath =
    "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/";
static const char *kSmallDataRuntimeLibPath =
    "GCC:lib/gcc/ppc-amigaos/11.5.0/newlib/lib/small-data/";
static const char *kConfiguredLibgccPath =
    "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a";
static const char *kConfiguredLibgccEhPath =
    "Work:SDK/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a";
static const char *kDirectLibgccPath =
    "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc.a";
static const char *kDirectLibgccEhPath =
    "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/libgcc_eh.a";
static const char *kConfiguredLdPath = "Work:SDK/gcc/ppc-amigaos/bin/ld";
static const char *kSdkStartupScriptPath = "Work:SDK/S/gcc-startup";
static const char *kSetDefGccPath = "Work:SDK/Tools/set_defGCC";
static const char *kCapturePath = "T:os4tb_gcc_build_capture.txt";
static const char *kTraceModeHeaderPrefix = "=== MODE: ";
static const int kUseUserShell = 1;
static const size_t kRuntimeTreeMaxEntries = 128U;

static const char *kRuntimeTreeAuditDirs[] = {
    "GCC:lib/",
    "GCC:lib/gcc/",
    "GCC:lib/gcc/ppc-amigaos/",
    "GCC:lib/gcc/ppc-amigaos/11.5.0/",
    "GCC:lib/gcc/ppc-amigaos/11.5.0/newlib/",
    "GCC:lib/gcc/ppc-amigaos/11.5.0/newlib/lib/",
    "GCC:lib/gcc/ppc-amigaos/11.5.0/newlib/lib/small-data/",
    "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/11.5.0/"
};

static int run_command_capture_both(const char *command, const char *output_path);

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

static int append_mode_header(const char *dst_path, const char *mode_name) {
    char header[192];
    (void)snprintf(header, sizeof(header), "%s%s ===\n", kTraceModeHeaderPrefix, mode_name);
    return append_text_to_file(dst_path, header);
}

static int copy_file_bounded(const char *src_path, const char *dst_path, size_t max_bytes) {
    FILE *src = fopen(src_path, "rb");
    FILE *dst = NULL;
    char buf[512];
    size_t total = 0U;
    if (src == NULL) {
        return 1;
    }
    dst = fopen(dst_path, "wb");
    if (dst == NULL) {
        fclose(src);
        return 1;
    }
    while (total < max_bytes) {
        size_t remaining = max_bytes - total;
        size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
        size_t n = fread(buf, 1U, chunk, src);
        if (n == 0U) {
            break;
        }
        if (fwrite(buf, 1U, n, dst) != n) {
            fclose(src);
            fclose(dst);
            return 1;
        }
        total += n;
    }
    if (!feof(src)) {
        (void)fputs("\n[TRUNCATED]\n", dst);
    }
    fclose(src);
    return fclose(dst) == 0 ? 0 : 1;
}

static int is_text_file_bounded(const char *path, size_t max_bytes) {
    FILE *fp = fopen(path, "rb");
    unsigned char buf[256];
    size_t total = 0U;
    if (fp == NULL) {
        return 0;
    }
    while (total < max_bytes) {
        size_t remaining = max_bytes - total;
        size_t chunk = remaining < sizeof(buf) ? remaining : sizeof(buf);
        size_t n = fread(buf, 1U, chunk, fp);
        size_t i = 0U;
        if (n == 0U) {
            break;
        }
        for (i = 0U; i < n; ++i) {
            unsigned char c = buf[i];
            if (c == 0U) {
                fclose(fp);
                return 0;
            }
            if (c < 32U && c != '\n' && c != '\r' && c != '\t') {
                fclose(fp);
                return 0;
            }
        }
        total += n;
    }
    fclose(fp);
    return 1;
}

static int extract_assign_target_from_listing(
    const char *assign_name,
    char *out,
    size_t out_size
) {
    struct DosList *dos_list = NULL;
    struct DosList *entry = NULL;
    const ULONG flags = LDF_READ | LDF_ASSIGNS;
    if (out_size == 0U) {
        return 0;
    }
    out[0] = '\0';
    dos_list = IDOS->LockDosList(flags);
    if (dos_list == NULL) {
        return 0;
    }
    entry = IDOS->FindDosEntry(dos_list, (STRPTR)assign_name, LDF_ASSIGNS);
    IDOS->UnLockDosList(flags);
    if (entry == NULL) {
        return 0;
    }
    (void)snprintf(out, out_size, "present_unresolved");
    return 1;
}

static int append_progress_marker(const char *progress_path, const char *marker) {
    FILE *fp = fopen(progress_path, "ab");
    if (fp == NULL) {
        return 1;
    }
    if (fputs(marker, fp) == EOF || fputs("\n", fp) == EOF) {
        fclose(fp);
        return 1;
    }
    (void)fflush(fp);
    return fclose(fp) == 0 ? 0 : 1;
}

typedef struct RuntimeDirAuditSummary {
    const char *status;
    size_t entry_count;
    int truncated;
    const char *libgcc_status;
    const char *libgcc_eh_status;
} RuntimeDirAuditSummary;

static const char *file_type_from_mode(mode_t mode) {
    if (S_ISLNK(mode)) {
        return "softlink";
    }
    if (S_ISDIR(mode)) {
        return "directory";
    }
    if (S_ISREG(mode)) {
        return "file";
    }
    return "other";
}

static int read_softlink_target_bounded(const char *path, char *out, size_t out_size) {
    ssize_t n = 0;
    if (out_size == 0U) {
        return 0;
    }
    out[0] = '\0';
    n = readlink(path, out, out_size - 1U);
    if (n <= 0 || (size_t)n >= out_size) {
        out[0] = '\0';
        return 0;
    }
    out[n] = '\0';
    return 1;
}

static const char *resolve_softlink_status(const char *path) {
    struct stat st;
    if (stat(path, &st) == 0) {
        return "valid";
    }
    if (errno == ENOENT || errno == ENOTDIR) {
        return "broken";
    }
    return "unknown";
}

static int should_capture_entry(const char *name) {
    return strstr(name, "libgcc") != NULL || strstr(name, "libgcov") != NULL ||
           strstr(name, "libatomic") != NULL || strstr(name, "libstdc++") != NULL ||
           strcmp(name, "gthr-amigaos-single.o") == 0 || strcmp(name, "gthr-amigaos-native.o") == 0 ||
           strcmp(name, "newlib") == 0 || strcmp(name, "lib") == 0;
}

static void update_lib_status(
    const char *name,
    const char *entry_type,
    const char *link_status,
    const char **status_out
) {
    if (strcmp(name, "libgcc.a") != 0 && strcmp(name, "libgcc_eh.a") != 0) {
        return;
    }
    if (strcmp(entry_type, "softlink") != 0) {
        *status_out = "present";
        return;
    }
    if (strcmp(link_status, "valid") == 0) {
        *status_out = "link";
    } else if (strcmp(link_status, "broken") == 0) {
        *status_out = "broken_link";
    } else {
        *status_out = "unknown";
    }
}

static int audit_runtime_directory(
    const char *dir_path,
    const char *artifact_path,
    RuntimeDirAuditSummary *summary
) {
    DIR *dir = NULL;
    struct dirent *entry = NULL;
    size_t entry_count = 0U;
    int truncated = 0;
    int saw_libgcc = 0;
    int saw_libgcc_eh = 0;

    summary->status = "error";
    summary->entry_count = 0U;
    summary->truncated = 0;
    summary->libgcc_status = "missing";
    summary->libgcc_eh_status = "missing";

    (void)append_text_to_file(artifact_path, "=== ");
    (void)append_text_to_file(artifact_path, dir_path);
    (void)append_text_to_file(artifact_path, " ===\n");

    dir = opendir(dir_path);
    if (dir == NULL) {
        if (errno == ENOENT || errno == ENOTDIR) {
            summary->status = "missing";
            (void)append_text_to_file(artifact_path, "STATUS=missing\n\n");
        } else {
            summary->status = "error";
            (void)append_text_to_file(artifact_path, "STATUS=error\n\n");
        }
        return 1;
    }

    while ((entry = readdir(dir)) != NULL) {
        char full_path[640];
        struct stat st;
        int stat_ok = 0;
        const char *entry_type = "other";
        const char *link_status = "unknown";
        char link_target[320];
        char line[1024];

        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }
        if (entry_count >= kRuntimeTreeMaxEntries) {
            truncated = 1;
            break;
        }
        entry_count += 1U;

        (void)snprintf(full_path, sizeof(full_path), "%s%s", dir_path, entry->d_name);
        if (lstat(full_path, &st) == 0) {
            stat_ok = 1;
            entry_type = file_type_from_mode(st.st_mode);
        }
        link_target[0] = '\0';
        if (strcmp(entry_type, "softlink") == 0) {
            link_status = resolve_softlink_status(full_path);
            (void)read_softlink_target_bounded(full_path, link_target, sizeof(link_target));
        }
        if (should_capture_entry(entry->d_name)) {
            long entry_size = stat_ok ? (long)st.st_size : 0L;
            (void)snprintf(
                line,
                sizeof(line),
                "ENTRY name=%s type=%s size=%lu link_target=%s link_status=%s\n",
                entry->d_name,
                entry_type,
                (unsigned long)entry_size,
                link_target[0] == '\0' ? "-" : link_target,
                strcmp(entry_type, "softlink") == 0 ? link_status : "unknown");
            (void)append_text_to_file(artifact_path, line);
            if (strcmp(entry->d_name, "libgcc.a") == 0) {
                saw_libgcc = 1;
                update_lib_status("libgcc.a", entry_type, link_status, &summary->libgcc_status);
            } else if (strcmp(entry->d_name, "libgcc_eh.a") == 0) {
                saw_libgcc_eh = 1;
                update_lib_status("libgcc_eh.a", entry_type, link_status, &summary->libgcc_eh_status);
            }
        }
    }

    summary->status = "present";
    summary->entry_count = entry_count;
    summary->truncated = truncated;
    if (!saw_libgcc) {
        summary->libgcc_status = "missing";
    }
    if (!saw_libgcc_eh) {
        summary->libgcc_eh_status = "missing";
    }
    {
        char status_line[96];
        char count_line[96];
        char trunc_line[64];
        (void)snprintf(status_line, sizeof(status_line), "STATUS=%s\n", summary->status);
        (void)snprintf(count_line, sizeof(count_line), "ENTRY_COUNT=%lu\n", (unsigned long)summary->entry_count);
        (void)snprintf(trunc_line, sizeof(trunc_line), "TRUNCATED=%s\n\n", summary->truncated ? "yes" : "no");
        (void)append_text_to_file(artifact_path, status_line);
        (void)append_text_to_file(artifact_path, count_line);
        (void)append_text_to_file(artifact_path, trunc_line);
    }

    (void)closedir(dir);
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

static int capture_has_runtime_lib_link_error(const char *path) {
    FILE *fp = fopen(path, "rb");
    char line[512];
    if (fp == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), fp) != NULL) {
        if (strstr(line, "cannot find -lgcc") != NULL || strstr(line, "cannot find -lgcc_eh") != NULL) {
            fclose(fp);
            return 1;
        }
    }
    fclose(fp);
    return 0;
}

int main(int argc, char **argv) {
    const char *artifact_name = "phase7d_gcc_build_run.artifact";
    char request_id[96];
    char staged_source[128];
    char staged_source_path[256];
    char diagnostics_name[160];
    char link_trace_name[180];
    char startup_audit_name[180];
    char setdefgcc_audit_name[180];
    char sdk_env_audit_name[180];
    char sdk_progress_name[200];
    char runtime_tree_audit_name[220];
    char direct_link_output_name[220];
    char direct_object_name[180];
    char executable_name[128];
    char program_output_name[160];
    char command_buf[1600];
    int build_rc = 127;
    int program_rc = -1;
    int cc1_found = 0;
    int as_found = 0;
    int toolchain_ready = 0;
    int libgcc_found = 0;
    int libgcc_eh_found = 0;
    int runtime_lib_ready = 0;
    int source_present = 0;
    int executable_present = 0;
    int build_ok = 0;
    int program_ok = 0;
    int trace_rc = -1;
    int direct_compile_rc = 127;
    int direct_link_rc = 127;
    int startup_script_copied = 0;
    int setdefgcc_copied = 0;
    int assign_enum_ok = 0;
    int runtime_tree_audit_partial = 0;
    int sdk_assign_found = 0;
    int gcc_assign_found = 0;
    const char *program_status = "not_run";
    const char *program_final = "NOT_RUN";
    const char *build_final = "FAIL";
    const char *runtime_probe = "NOT_RUN";
    const char *runtime_path_mode = "not_run";
    const char *runtime_linker_path = "not_run";
    const char *direct_link_final = "NOT_RUN";
    const char *direct_link_exec_status = "missing";
    const char *sdk_audit_stage = "incomplete";
    const char *sdk_audit_assign_enum = "FAIL";
    const char *sdk_audit_startup_capture = "FAIL";
    const char *sdk_audit_setdefgcc_capture = "FAIL";
    const char *runtime_tree_audit_status = "FAIL";
    const char *startup_script_status = "missing";
    const char *setdefgcc_status = "missing";
    const char *sdk_env_audit_status = "missing";
    const char *expected_runtime_dir_status = "unknown";
    const char *expected_libgcc_status = "unknown";
    const char *expected_libgcc_eh_status = "unknown";
    const char *actual_runtime_dir_status = "unknown";
    const char *actual_libgcc_status = "missing";
    const char *actual_libgcc_eh_status = "missing";
    const char *small_data_dir_status = "unknown";
    const char *small_data_libgcc_status = "missing";
    const char *small_data_libgcc_eh_status = "missing";
    const char *direct_libgcc_status = "missing";
    const char *direct_libgcc_eh_status = "missing";
    char runtime_probe_attempts[256];
    char mode_note[160];
    char trace_modes[256];
    char sdk_assign_target[320];
    char gcc_assign_target[320];
    RuntimeDirAuditSummary runtime_dir_summaries[sizeof(kRuntimeTreeAuditDirs) / sizeof(kRuntimeTreeAuditDirs[0])];
    const char *link_trace_status = "missing";
    const char *link_trace_mode = "not_run";
    FILE *artifact_fp = NULL;
    size_t artifact_len = 0U;
    long direct_libgcc_size = -1L;
    long direct_libgcc_eh_size = -1L;

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
    (void)snprintf(executable_name, sizeof(executable_name), "build_%s", request_id);
    (void)snprintf(diagnostics_name, sizeof(diagnostics_name), "%s.gcc.txt", artifact_name);
    (void)snprintf(link_trace_name, sizeof(link_trace_name), "%s.gcc-link-trace.txt", artifact_name);
    (void)snprintf(startup_audit_name, sizeof(startup_audit_name), "%s.gcc-startup.txt", artifact_name);
    (void)snprintf(setdefgcc_audit_name, sizeof(setdefgcc_audit_name), "%s.setdefgcc.txt", artifact_name);
    (void)snprintf(sdk_env_audit_name, sizeof(sdk_env_audit_name), "%s.sdk-env.txt", artifact_name);
    (void)snprintf(sdk_progress_name, sizeof(sdk_progress_name), "%s.sdk-audit-progress.txt", artifact_name);
    (void)snprintf(runtime_tree_audit_name, sizeof(runtime_tree_audit_name), "%s.gcc-runtime-tree.txt", artifact_name);
    (void)snprintf(direct_link_output_name, sizeof(direct_link_output_name), "%s.direct-link.txt", artifact_name);
    (void)snprintf(direct_object_name, sizeof(direct_object_name), "build_%s.direct.o", request_id);
    (void)snprintf(program_output_name, sizeof(program_output_name), "%s.program.txt", artifact_name);
    if (!is_safe_basename(diagnostics_name) || !is_safe_basename(executable_name) ||
        !is_safe_basename(staged_source) || !is_safe_basename(program_output_name) ||
        !is_safe_basename(link_trace_name) || !is_safe_basename(startup_audit_name) ||
        !is_safe_basename(setdefgcc_audit_name) || !is_safe_basename(sdk_env_audit_name) ||
        !is_safe_basename(sdk_progress_name) || !is_safe_basename(runtime_tree_audit_name) ||
        !is_safe_basename(direct_link_output_name) || !is_safe_basename(direct_object_name)) {
        return 10;
    }

    if (write_text_file(diagnostics_name, "") != 0) {
        return 2;
    }
    (void)write_text_file(sdk_progress_name, "");
    (void)append_progress_marker(sdk_progress_name, "AUDIT_START");
    runtime_probe_attempts[0] = '\0';
    trace_modes[0] = '\0';
    sdk_assign_target[0] = '\0';
    gcc_assign_target[0] = '\0';

    cc1_found = file_is_readable(kConfiguredCc1Path);
    as_found = file_is_readable(kConfiguredAsPath);
    toolchain_ready = (cc1_found && as_found) ? 1 : 0;
    libgcc_found = file_is_readable(kConfiguredLibgccPath);
    libgcc_eh_found = file_is_readable(kConfiguredLibgccEhPath);
    runtime_lib_ready = (libgcc_found && libgcc_eh_found) ? 1 : 0;
    (void)append_progress_marker(sdk_progress_name, "BEFORE_ASSIGN_ENUM");
    if (write_text_file(sdk_env_audit_name, "") == 0) {
        sdk_env_audit_status = "present";
        sdk_assign_found = extract_assign_target_from_listing("SDK", sdk_assign_target, sizeof(sdk_assign_target));
        gcc_assign_found = extract_assign_target_from_listing("GCC", gcc_assign_target, sizeof(gcc_assign_target));
        assign_enum_ok = 1;
        sdk_audit_assign_enum = "PASS";
        (void)append_text_to_file(sdk_env_audit_name, "ASSIGN_ENUM_METHOD=doslist_find\n");
        (void)append_text_to_file(sdk_env_audit_name, sdk_assign_found ? "SDK_STATUS=found\n" : "SDK_STATUS=missing\n");
        (void)append_text_to_file(sdk_env_audit_name, gcc_assign_found ? "GCC_STATUS=found\n" : "GCC_STATUS=missing\n");
    } else {
        sdk_env_audit_status = "failed";
        sdk_audit_assign_enum = "FAIL";
    }
    (void)append_progress_marker(sdk_progress_name, "AFTER_ASSIGN_ENUM");

    (void)append_progress_marker(sdk_progress_name, "BEFORE_GCC_STARTUP_READ");
    if (file_is_readable(kSdkStartupScriptPath)) {
        startup_script_copied = copy_file_bounded(kSdkStartupScriptPath, startup_audit_name, 65536U) == 0 ? 1 : 0;
        startup_script_status = startup_script_copied ? "present" : "error";
        sdk_audit_startup_capture = startup_script_copied ? "PASS" : "FAIL";
    } else {
        startup_script_status = "missing";
        sdk_audit_startup_capture = "FAIL";
    }
    (void)append_progress_marker(sdk_progress_name, "AFTER_GCC_STARTUP_READ");

    (void)append_progress_marker(sdk_progress_name, "BEFORE_SETDEFGCC_READ");
    if (file_is_readable(kSetDefGccPath)) {
        int setdef_is_text = is_text_file_bounded(kSetDefGccPath, 65536U);
        if (setdef_is_text) {
            setdefgcc_copied = copy_file_bounded(kSetDefGccPath, setdefgcc_audit_name, 65536U) == 0 ? 1 : 0;
            setdefgcc_status = setdefgcc_copied ? "present_text" : "error";
            sdk_audit_setdefgcc_capture = setdefgcc_copied ? "PASS" : "FAIL";
        } else {
            setdefgcc_status = "present_binary_or_nontext";
            sdk_audit_setdefgcc_capture = "PASS";
        }
    } else {
        setdefgcc_status = "missing";
        sdk_audit_setdefgcc_capture = "FAIL";
    }
    (void)append_progress_marker(sdk_progress_name, "AFTER_SETDEFGCC_READ");
    sdk_audit_stage = (assign_enum_ok != 0) ? "complete" : "incomplete";
    (void)append_progress_marker(sdk_progress_name, "BEFORE_RUNTIME_TREE_AUDIT");
    if (write_text_file(runtime_tree_audit_name, "") == 0) {
        size_t d = 0U;
        for (d = 0U; d < (sizeof(kRuntimeTreeAuditDirs) / sizeof(kRuntimeTreeAuditDirs[0])); ++d) {
            int rc = audit_runtime_directory(kRuntimeTreeAuditDirs[d], runtime_tree_audit_name, &runtime_dir_summaries[d]);
            if (rc != 0 || strcmp(runtime_dir_summaries[d].status, "error") == 0) {
                runtime_tree_audit_partial = 1;
            }
        }
        expected_runtime_dir_status = runtime_dir_summaries[5].status;
        expected_libgcc_status = runtime_dir_summaries[5].libgcc_status;
        expected_libgcc_eh_status = runtime_dir_summaries[5].libgcc_eh_status;
        small_data_dir_status = runtime_dir_summaries[6].status;
        small_data_libgcc_status = strcmp(runtime_dir_summaries[6].libgcc_status, "missing") == 0 ? "missing" : "present";
        small_data_libgcc_eh_status = strcmp(runtime_dir_summaries[6].libgcc_eh_status, "missing") == 0 ? "missing" : "present";
        actual_runtime_dir_status = runtime_dir_summaries[7].status;
        actual_libgcc_status = strcmp(runtime_dir_summaries[7].libgcc_status, "missing") == 0 ? "missing" : "present";
        actual_libgcc_eh_status = strcmp(runtime_dir_summaries[7].libgcc_eh_status, "missing") == 0 ? "missing" : "present";
        runtime_tree_audit_status = runtime_tree_audit_partial ? "PARTIAL" : "PASS";
    } else {
        runtime_tree_audit_status = "FAIL";
        expected_runtime_dir_status = "error";
        expected_libgcc_status = "unknown";
        expected_libgcc_eh_status = "unknown";
        small_data_dir_status = "error";
        small_data_libgcc_status = "missing";
        small_data_libgcc_eh_status = "missing";
        actual_runtime_dir_status = "error";
        actual_libgcc_status = "missing";
        actual_libgcc_eh_status = "missing";
    }
    (void)append_progress_marker(sdk_progress_name, "AFTER_RUNTIME_TREE_AUDIT");
    (void)append_progress_marker(sdk_progress_name, "AUDIT_COMPLETE");
    source_present = file_is_readable(staged_source_path);

    if (toolchain_ready && source_present) {
        runtime_path_mode = "direct_runtime_archives";
        runtime_linker_path = "direct_runtime_archives";
        link_trace_mode = "direct_runtime_archives";
        (void)snprintf(runtime_probe_attempts, sizeof(runtime_probe_attempts), "%s", "direct_runtime_archives");
        (void)snprintf(trace_modes, sizeof(trace_modes), "%s", "direct_runtime_archives");
        (void)snprintf(mode_note, sizeof(mode_note), "OS4TB_GCC_RUNTIME_LIB_PATH_MODE_TRY=%s\n", runtime_path_mode);
        (void)append_text_to_file(diagnostics_name, mode_note);

        if (write_text_file(link_trace_name, "") == 0) {
            link_trace_status = "present";
            (void)append_mode_header(link_trace_name, link_trace_mode);
            (void)snprintf(
                command_buf,
                sizeof(command_buf),
                "gcc -B%s -B%s -Wall -Wextra %s -o %s -###",
                kConfiguredCc1Prefix,
                kConfiguredAsPrefix,
                staged_source_path,
                executable_name);
            trace_rc = run_command_capture_both(command_buf, kCapturePath);
            if (trace_rc != 0) {
                link_trace_status = "failed";
            }
            (void)append_file_to_file(link_trace_name, kCapturePath);
            (void)append_text_to_file(link_trace_name, "\n");
        } else {
            link_trace_status = "failed";
        }

        direct_libgcc_status = classify_file_readable_status(kDirectLibgccPath);
        direct_libgcc_eh_status = classify_file_readable_status(kDirectLibgccEhPath);
        direct_libgcc_size = file_size_bytes(kDirectLibgccPath);
        direct_libgcc_eh_size = file_size_bytes(kDirectLibgccEhPath);

        if (write_text_file(direct_link_output_name, "") != 0) {
            runtime_probe = "FAIL";
            direct_link_final = "FAIL";
            direct_link_rc = 127;
            build_rc = 127;
        } else {
            (void)snprintf(
                command_buf,
                sizeof(command_buf),
                "gcc -B%s -B%s -Wall -Wextra -c %s -o %s",
                kConfiguredCc1Prefix,
                kConfiguredAsPrefix,
                staged_source_path,
                direct_object_name);
            direct_compile_rc = run_command_capture_both(command_buf, kCapturePath);
            (void)append_text_to_file(diagnostics_name, "=== DIRECT_COMPILE ===\n");
            (void)append_file_to_file(diagnostics_name, kCapturePath);
            (void)append_text_to_file(diagnostics_name, "\n");

            if (direct_compile_rc != 0) {
                runtime_probe = "NOT_RUN";
                direct_link_final = "NOT_RUN";
                direct_link_rc = 127;
                build_rc = direct_compile_rc;
            } else if (strcmp(direct_libgcc_status, "present") != 0 || strcmp(direct_libgcc_eh_status, "present") != 0) {
                runtime_probe = "FAIL";
                direct_link_final = "NOT_RUN";
                direct_link_rc = 127;
                build_rc = 126;
                (void)append_text_to_file(
                    diagnostics_name,
                    "direct runtime archive validation failed; skipping direct link\n");
            } else {
                (void)snprintf(
                    command_buf,
                    sizeof(command_buf),
                    "%s --defsym \"__amigaos4__=1\" -Bstatic -q -d -Qy "
                    "-L/SDK/newlib/lib "
                    "-L/GCC/lib/gcc/ppc-amigaos/11.5.0/newlib/lib "
                    "-L/SDK/local/newlib/lib "
                    "-L/SDK/local/common/lib "
                    "-o %s "
                    "/SDK/newlib/lib/crtbegin.o "
                    "%s "
                    "%s "
                    "%s "
                    "--start-group -lc --end-group "
                    "%s "
                    "%s "
                    "/SDK/newlib/lib/crtend.o",
                    kConfiguredLdPath,
                    executable_name,
                    direct_object_name,
                    kDirectLibgccPath,
                    kDirectLibgccEhPath,
                    kDirectLibgccPath,
                    kDirectLibgccEhPath);
                direct_link_rc = run_command_capture_both(command_buf, direct_link_output_name);
                (void)append_text_to_file(diagnostics_name, "=== DIRECT_LINK ===\n");
                (void)append_file_to_file(diagnostics_name, direct_link_output_name);
                (void)append_text_to_file(diagnostics_name, "\n");
                build_rc = direct_link_rc;
                if (direct_link_rc == 0) {
                    runtime_probe = "PASS";
                    direct_link_final = "PASS";
                } else {
                    (void)capture_has_runtime_lib_link_error(direct_link_output_name);
                    runtime_probe = "FAIL";
                    direct_link_final = "FAIL";
                }
            }
        }
    } else {
        runtime_probe = "NOT_RUN";
        link_trace_status = "missing";
        direct_link_final = "NOT_RUN";
        direct_link_rc = 127;
        direct_compile_rc = 127;
        if (!toolchain_ready) {
            (void)write_text_file(diagnostics_name, "toolchain helper discovery failed; skipping build\n");
        } else {
            (void)write_text_file(diagnostics_name, "source file missing; skipping build\n");
        }
        build_rc = 127;
    }

    executable_present = file_exists_non_empty(executable_name);
    direct_link_exec_status = executable_present ? "present" : "missing";
    if (strcmp(direct_link_final, "PASS") == 0 && !executable_present) {
        direct_link_final = "FAIL";
    }
    build_ok = (build_rc == 0 && executable_present) ? 1 : 0;
    if (build_ok) {
        program_rc = run_command_capture_both(executable_name, program_output_name);
        if (program_rc == 0) {
            program_ok = 1;
            program_status = "success";
            program_final = "PASS";
        } else {
            program_ok = 0;
            program_status = "failure";
            program_final = "FAIL";
        }
        build_final = "PASS";
    }

    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_SOURCE=%s\n", staged_source_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_DIAGNOSTIC_FILE=%s\n", diagnostics_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_EXIT=%d\n", build_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_EXIT=%d\n", build_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXECUTABLE_STATUS=%s\n", executable_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXECUTABLE_NAME=%s\n", executable_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_CC1_DISCOVERY=%s\n", cc1_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_AS_DISCOVERY=%s\n", as_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_TOOLCHAIN_ENV=%s\n", toolchain_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TOOLCHAIN_ENV=%s\n", toolchain_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_LIBGCC_DISCOVERY=%s\n", libgcc_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_LIBGCC_EH_DISCOVERY=%s\n", libgcc_eh_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_ENV=%s\n", runtime_lib_ready ? "ready" : "not_ready");
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_PATH=%s\n", kConfiguredRuntimeLibPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_NATIVE_PATH=%s\n", kConfiguredRuntimeLibPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_SMALL_DATA_PATH=%s\n", kSmallDataRuntimeLibPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_LINKER_PATH=%s\n", runtime_linker_path);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_PATH_MODE=%s\n", runtime_path_mode);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_PROBE=%s\n", runtime_probe);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_LIB_PROBE_ATTEMPTS=%s\n",
                  runtime_probe_attempts[0] == '\0' ? "none" : runtime_probe_attempts);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TRACE_STATUS=%s\n", link_trace_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TRACE_FILE=%s\n", link_trace_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TRACE_MODE=%s\n", link_trace_mode);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TRACE_EXIT=%d\n", trace_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_TRACE_MODES=%s\n",
                  trace_modes[0] == '\0' ? "none" : trace_modes);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_AUDIT_STAGE=%s\n", sdk_audit_stage);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_AUDIT_ASSIGN_ENUM=%s\n", sdk_audit_assign_enum);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_AUDIT_STARTUP_CAPTURE=%s\n", sdk_audit_startup_capture);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_AUDIT_SETDEFGCC_CAPTURE=%s\n", sdk_audit_setdefgcc_capture);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_ASSIGN_STATUS=%s\n", sdk_assign_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_ASSIGN_TARGET=%s\n", sdk_assign_found ? sdk_assign_target : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_GCC_ASSIGN_STATUS=%s\n", gcc_assign_found ? "found" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_GCC_ASSIGN_TARGET=%s\n", gcc_assign_found ? gcc_assign_target : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_STARTUP_SCRIPT_STATUS=%s\n", startup_script_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_STARTUP_SCRIPT_PATH=%s\n", kSdkStartupScriptPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_STARTUP_SCRIPT_AUDIT_FILE=%s\n", startup_audit_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_STARTUP_SEMANTICS=captured_text_review_required\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_SETDEFGCC_STATUS=%s\n", setdefgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SETDEFGCC_PATH=%s\n", kSetDefGccPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SETDEFGCC_AUDIT_FILE=%s\n", setdefgcc_audit_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_ENV_AUDIT_STATUS=%s\n", sdk_env_audit_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_ENV_AUDIT_FILE=%s\n", sdk_env_audit_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SDK_AUDIT_PROGRESS_FILE=%s\n", sdk_progress_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_TREE_AUDIT_STATUS=%s\n", runtime_tree_audit_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_RUNTIME_TREE_AUDIT_FILE=%s\n", runtime_tree_audit_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXPECTED_RUNTIME_DIR_STATUS=%s\n", expected_runtime_dir_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXPECTED_LIBGCC_STATUS=%s\n", expected_libgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_EXPECTED_LIBGCC_EH_STATUS=%s\n", expected_libgcc_eh_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SMALL_DATA_DIR_STATUS=%s\n", small_data_dir_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SMALL_DATA_LIBGCC_STATUS=%s\n", small_data_libgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SMALL_DATA_LIBGCC_EH_STATUS=%s\n", small_data_libgcc_eh_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ACTUAL_RUNTIME_DIR_STATUS=%s\n", actual_runtime_dir_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ACTUAL_LIBGCC_STATUS=%s\n", actual_libgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ACTUAL_LIBGCC_EH_STATUS=%s\n", actual_libgcc_eh_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_LINK_STRATEGY=direct_runtime_archives\n");
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_OBJECT=%s\n", direct_object_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_LIBGCC=%s\n", kDirectLibgccPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_LIBGCC_EH=%s\n", kDirectLibgccEhPath);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_STATUS=%s\n", direct_libgcc_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_EH_STATUS=%s\n", direct_libgcc_eh_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_SIZE=%ld\n", direct_libgcc_size);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LIBGCC_EH_SIZE=%ld\n", direct_libgcc_eh_size);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_OUTPUT_FILE=%s\n", direct_link_output_name);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_EXIT=%d\n", direct_link_rc);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_EXECUTABLE_STATUS=%s\n", direct_link_exec_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_DIRECT_LINK_FINAL=%s\n", direct_link_final);
    (void)fprintf(artifact_fp, "OS4TB_GCC_SOURCE_STATUS=%s\n", source_present ? "present" : "missing");
    (void)fprintf(artifact_fp, "OS4TB_GCC_BUILD_FINAL=%s\n", build_final);
    if (build_ok) {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=%d\n", program_rc);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_STATUS=%s\n", program_status);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_OUTPUT_FILE=%s\n", program_output_name);
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=%s\n", program_final);
    } else {
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_EXIT=not_run\n");
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_STATUS=not_run\n");
        (void)fprintf(artifact_fp, "OS4TB_PROGRAM_FINAL=NOT_RUN\n");
    }
    if (fclose(artifact_fp) != 0) {
        return 5;
    }

    (void)program_ok;
    return 0;
}
