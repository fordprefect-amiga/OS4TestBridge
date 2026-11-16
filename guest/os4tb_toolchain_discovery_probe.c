#include <dirent.h>
#include <dos/dos.h>
#include <dos/dosextens.h>
#include <proto/dos.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define OS4TB_DISCOVERY_VERSION 1
#define OS4TB_MAX_GCC 8
#define OS4TB_MAX_INCLUDE_DIRS 16
#define OS4TB_MAX_LIBRARY_DIRS 16
#define OS4TB_MAX_LIBRARY_INVENTORY 256
#define OS4TB_MAX_PATH 320
#define OS4TB_MAX_VERSION 32
#define OS4TB_MAX_LIBRARY_NAME 96
#define OS4TB_MAX_LINE 520
#define OS4TB_MAX_INTERNAL_INCLUDE_DIRS 8
#define OS4TB_MAX_CHECKPOINTS 64
#define OS4TB_MAX_CHECKPOINT_LINE 128
#define OS4TB_MAX_ASSIGN_TARGETS 8

#ifndef OS4TB_DISCOVERY_DEBUG_STAGE
#define OS4TB_DISCOVERY_DEBUG_STAGE 11
#endif

#ifndef OS4TB_INCLUDE_PROBE_ISOLATION_MODE
#define OS4TB_INCLUDE_PROBE_ISOLATION_MODE 0
#endif

typedef struct GccInfo {
    char version[OS4TB_MAX_VERSION];
    char driver[OS4TB_MAX_PATH];
    char cc1[OS4TB_MAX_PATH];
    char as_path[OS4TB_MAX_PATH];
    char ld_path[OS4TB_MAX_PATH];
    char include_dirs[OS4TB_MAX_INCLUDE_DIRS][OS4TB_MAX_PATH];
    char include_kinds[OS4TB_MAX_INCLUDE_DIRS][24];
    int include_count;
    char include_probe_stream[16];
    char include_probe_command[256];
    char include_discovery_status[24];
    int include_probe_exit;
    int include_probe_stdout_has_block;
    int include_probe_stderr_has_block;
    char internal_include_dirs[OS4TB_MAX_INTERNAL_INCLUDE_DIRS][OS4TB_MAX_PATH];
    int internal_include_count;
    char internal_stddef_dir[OS4TB_MAX_PATH];
    char internal_stdarg_dir[OS4TB_MAX_PATH];
    char internal_stdint_dir[OS4TB_MAX_PATH];
    char library_dirs[OS4TB_MAX_LIBRARY_DIRS][OS4TB_MAX_PATH];
    int library_dir_count;
    char libraries[OS4TB_MAX_LIBRARY_INVENTORY][OS4TB_MAX_LIBRARY_NAME];
    int library_count;
    int library_inventory_truncated;
    char libgcc[OS4TB_MAX_PATH];
    char libgcc_eh[OS4TB_MAX_PATH];
    char crtbegin[OS4TB_MAX_PATH];
    char crtend[OS4TB_MAX_PATH];
} GccInfo;

typedef struct AssignResolution {
    char status[16];
    char type[16];
    int target_count;
    char targets[OS4TB_MAX_ASSIGN_TARGETS][OS4TB_MAX_PATH];
    char lock_status[16];
} AssignResolution;

static const int kUseUserShell = 1;
static const char *kSdkCandidates[] = {"Work:SDK", "SDK:", "/SDK"};
static const char *kVbccCommands[] = {"vc -version", "vbcc -version"};

static char g_progress_path[OS4TB_MAX_PATH];
static int g_progress_ready = 0;
static int g_checkpoint_count = 0;
static int g_trace_split_systemtags = 0;
static GccInfo g_gcc_infos[OS4TB_MAX_GCC];
static AssignResolution g_assign_sdk;
static AssignResolution g_assign_gcc;
static AssignResolution g_assign_lib;
static AssignResolution g_assign_c;
static AssignResolution g_assign_system;
static AssignResolution g_assign_t;

static void checkpoint(const char *name);

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
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' ||
              c == '.')) {
            return 0;
        }
    }
    return 1;
}

static int copy_text(char *dst, size_t cap, const char *src) {
    size_t len = strlen(src);
    if (len + 1U > cap) {
        return 0;
    }
    memcpy(dst, src, len + 1U);
    return 1;
}

static int join_path3(char *dst, size_t cap, const char *left, const char *middle, const char *right) {
    size_t left_len = strlen(left);
    size_t middle_len = strlen(middle);
    size_t right_len = strlen(right);
    size_t total = left_len + middle_len + right_len;
    if (total + 1U > cap) {
        return 0;
    }
    memcpy(dst, left, left_len);
    memcpy(dst + left_len, middle, middle_len);
    memcpy(dst + left_len + middle_len, right, right_len);
    dst[total] = '\0';
    return 1;
}

static int join_path4(char *dst, size_t cap, const char *a, const char *b, const char *c, const char *d) {
    size_t a_len = strlen(a);
    size_t b_len = strlen(b);
    size_t c_len = strlen(c);
    size_t d_len = strlen(d);
    size_t total = a_len + b_len + c_len + d_len;
    if (total + 1U > cap) {
        return 0;
    }
    memcpy(dst, a, a_len);
    memcpy(dst + a_len, b, b_len);
    memcpy(dst + a_len + b_len, c, c_len);
    memcpy(dst + a_len + b_len + c_len, d, d_len);
    dst[total] = '\0';
    return 1;
}

static int starts_with(const char *s, const char *prefix) {
    return strncmp(s, prefix, strlen(prefix)) == 0;
}

static int is_ascii_case_equal(const char *lhs, const char *rhs) {
    size_t i = 0U;
    size_t lhs_len = strlen(lhs);
    if (lhs_len != strlen(rhs)) {
        return 0;
    }
    for (i = 0U; i < lhs_len; i += 1U) {
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

static int is_directory(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return 0;
    }
    return (st.st_mode & S_IFDIR) != 0;
}

static int file_is_readable(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return 0;
    }
    fclose(fp);
    return 1;
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

static int run_command_capture_split(const char *command, const char *stdout_path, const char *stderr_path) {
    BPTR out_fh = IDOS->Open((STRPTR)stdout_path, MODE_NEWFILE);
    BPTR err_fh = IDOS->Open((STRPTR)stderr_path, MODE_NEWFILE);
    LONG rc = 0;
    if (out_fh == ZERO || err_fh == ZERO) {
        if (out_fh != ZERO) {
            IDOS->Close(out_fh);
        }
        if (err_fh != ZERO) {
            IDOS->Close(err_fh);
        }
        return 127;
    }
    if (g_trace_split_systemtags) {
        checkpoint("07B_SPLIT_SYSTEMTAGS_BEGIN");
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
        err_fh,
        TAG_DONE);
    if (g_trace_split_systemtags) {
        checkpoint("07B_SPLIT_SYSTEMTAGS_RETURN");
    }
    IDOS->Close(out_fh);
    IDOS->Close(err_fh);
    return (int)rc;
}

static int run_command_no_capture(const char *command) {
    BPTR nil_fh = IDOS->Open((STRPTR)"NIL:", MODE_OLDFILE);
    LONG rc = 0;
    if (nil_fh == ZERO) {
        return 127;
    }
    rc = IDOS->SystemTags(
        (STRPTR)command,
        SYS_Asynch,
        FALSE,
        SYS_UserShell,
        kUseUserShell ? TRUE : FALSE,
        SYS_Output,
        nil_fh,
        SYS_Error,
        nil_fh,
        TAG_DONE);
    IDOS->Close(nil_fh);
    return (int)rc;
}

static int run_command_passthrough(const char *command) {
    LONG rc = IDOS->SystemTags(
        (STRPTR)command,
        SYS_Asynch,
        FALSE,
        SYS_UserShell,
        kUseUserShell ? TRUE : FALSE,
        TAG_DONE);
    return (int)rc;
}

static int run_command_capture_split_direct(const char *command, const char *stdout_path, const char *stderr_path) {
    BPTR out_fh = IDOS->Open((STRPTR)stdout_path, MODE_NEWFILE);
    BPTR err_fh = IDOS->Open((STRPTR)stderr_path, MODE_NEWFILE);
    LONG rc = 0;
    if (out_fh == ZERO || err_fh == ZERO) {
        if (out_fh != ZERO) {
            IDOS->Close(out_fh);
        }
        if (err_fh != ZERO) {
            IDOS->Close(err_fh);
        }
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
        err_fh,
        TAG_DONE);
    IDOS->Close(out_fh);
    IDOS->Close(err_fh);
    return (int)rc;
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

static int line_has_include_block_marker(const char *line) {
    return strstr(line, "#include <...> search starts here:") != NULL;
}

static int line_has_include_end_marker(const char *line) {
    return strstr(line, "End of search list.") != NULL;
}

static void classify_include_kind(const char *path, char *out_kind, size_t out_cap) {
    if (strstr(path, "/include-fixed") != NULL) {
        (void)snprintf(out_kind, out_cap, "%s", "gcc-include-fixed");
    } else if (strstr(path, "/lib/gcc/") != NULL && strstr(path, "/include") != NULL) {
        (void)snprintf(out_kind, out_cap, "%s", "gcc-internal");
    } else if (strstr(path, "/newlib/include") != NULL) {
        (void)snprintf(out_kind, out_cap, "%s", "sdk-newlib");
    } else if (strstr(path, "/local/") != NULL && strstr(path, "/include") != NULL) {
        (void)snprintf(out_kind, out_cap, "%s", "sdk-local");
    } else if (starts_with(path, "Work:SDK") || starts_with(path, "SDK:") || starts_with(path, "/SDK")) {
        (void)snprintf(out_kind, out_cap, "%s", "other-known");
    } else {
        (void)snprintf(out_kind, out_cap, "%s", "unknown");
    }
}

static int add_unique_library(char libraries[][OS4TB_MAX_LIBRARY_NAME], int *count, const char *name, int *truncated) {
    int i = 0;
    for (i = 0; i < *count; i += 1) {
        if (strcmp(libraries[i], name) == 0) {
            return 0;
        }
    }
    if (*count >= OS4TB_MAX_LIBRARY_INVENTORY) {
        *truncated = 1;
        return 1;
    }
    (void)snprintf(libraries[*count], OS4TB_MAX_LIBRARY_NAME, "%s", name);
    *count += 1;
    return 0;
}

static int is_gcc_version_name(const char *name) {
    size_t i = 0U;
    int has_digit = 0;
    size_t len = strlen(name);
    if (len == 0U || len >= OS4TB_MAX_VERSION) {
        return 0;
    }
    for (i = 0U; i < len; i += 1U) {
        unsigned char c = (unsigned char)name[i];
        if (c >= '0' && c <= '9') {
            has_digit = 1;
        } else if (c != '.') {
            return 0;
        }
    }
    return has_digit;
}

static int compare_gcc_info(const void *lhs, const void *rhs) {
    const GccInfo *a = (const GccInfo *)lhs;
    const GccInfo *b = (const GccInfo *)rhs;
    return strcmp(a->version, b->version);
}

static int compare_library_name(const void *lhs, const void *rhs) {
    const char *a = (const char *)lhs;
    const char *b = (const char *)rhs;
    return strcmp(a, b);
}

static void detect_path_status(const char *path, char out_status[24]) {
    struct stat st;
    struct stat target;
    if (lstat(path, &st) != 0) {
        (void)snprintf(out_status, 24, "%s", "missing");
        return;
    }
    if ((st.st_mode & S_IFLNK) != 0) {
        if (stat(path, &target) == 0) {
            (void)snprintf(out_status, 24, "%s", "symlink");
        } else {
            (void)snprintf(out_status, 24, "%s", "broken_symlink");
        }
        return;
    }
    (void)snprintf(out_status, 24, "%s", "present");
}

static int detect_sdk_root(char out_sdk_root[OS4TB_MAX_PATH]) {
    size_t i = 0U;
    for (i = 0U; i < sizeof(kSdkCandidates) / sizeof(kSdkCandidates[0]); i += 1U) {
        if (is_directory(kSdkCandidates[i])) {
            (void)snprintf(out_sdk_root, OS4TB_MAX_PATH, "%s", kSdkCandidates[i]);
            return 1;
        }
    }
    (void)snprintf(out_sdk_root, OS4TB_MAX_PATH, "%s", "unknown");
    return 0;
}

static void trim_assign_name(const char *name, char out_name[32]) {
    size_t i = 0U;
    while (name[i] != '\0' && name[i] != ':' && i + 1U < 32U) {
        out_name[i] = name[i];
        i += 1U;
    }
    out_name[i] = '\0';
}

static void detect_dos_object_type(const char *name, char out_type[16]) {
    struct DosList *dos_list = NULL;
    char trimmed_name[32];
    trim_assign_name(name, trimmed_name);
    (void)snprintf(out_type, 16, "%s", "unknown");

    dos_list = IDOS->LockDosList((ULONG)(LDF_READ | LDF_ASSIGNS | LDF_DEVICES | LDF_VOLUMES));
    if (dos_list == NULL) {
        return;
    }

    if (IDOS->FindDosEntry(dos_list, (STRPTR)trimmed_name, LDF_ASSIGNS) != NULL) {
        (void)snprintf(out_type, 16, "%s", "assign");
    } else if (IDOS->FindDosEntry(dos_list, (STRPTR)trimmed_name, LDF_DEVICES) != NULL) {
        (void)snprintf(out_type, 16, "%s", "device");
    } else if (IDOS->FindDosEntry(dos_list, (STRPTR)trimmed_name, LDF_VOLUMES) != NULL) {
        (void)snprintf(out_type, 16, "%s", "volume");
    }

    IDOS->UnLockDosList((ULONG)(LDF_READ | LDF_ASSIGNS | LDF_DEVICES | LDF_VOLUMES));
}

static void resolve_assign_targets(const char *name, AssignResolution *out_resolution) {
    BPTR lock = ZERO;
    char lock_name[16];
    char resolved_path[OS4TB_MAX_PATH];
    int i = 0;

    out_resolution->target_count = 0;
    for (i = 0; i < OS4TB_MAX_ASSIGN_TARGETS; i += 1) {
        out_resolution->targets[i][0] = '\0';
    }
    (void)snprintf(out_resolution->status, sizeof(out_resolution->status), "%s", "missing");
    (void)snprintf(out_resolution->type, sizeof(out_resolution->type), "%s", "unknown");
    (void)snprintf(out_resolution->lock_status, sizeof(out_resolution->lock_status), "%s", "unknown");

    detect_dos_object_type(name, out_resolution->type);

    if ((int)snprintf(lock_name, sizeof(lock_name), "%s:", name) >= (int)sizeof(lock_name)) {
        return;
    }
    lock = IDOS->Lock((STRPTR)lock_name, SHARED_LOCK);
    if (lock == ZERO) {
        if (strcmp(out_resolution->type, "unknown") != 0) {
            (void)snprintf(out_resolution->status, sizeof(out_resolution->status), "%s", "present");
            (void)snprintf(out_resolution->lock_status, sizeof(out_resolution->lock_status), "%s", "not_lockable");
        } else {
            (void)snprintf(out_resolution->lock_status, sizeof(out_resolution->lock_status), "%s", "not_lockable");
        }
        return;
    }

    (void)snprintf(out_resolution->status, sizeof(out_resolution->status), "%s", "present");
    (void)snprintf(out_resolution->lock_status, sizeof(out_resolution->lock_status), "%s", "lockable");
    resolved_path[0] = '\0';
    if (IDOS->NameFromLock(lock, (STRPTR)resolved_path, sizeof(resolved_path)) != FALSE) {
        (void)snprintf(out_resolution->targets[0], OS4TB_MAX_PATH, "%s", resolved_path);
        out_resolution->target_count = 1;
        if (strcmp(out_resolution->type, "unknown") == 0) {
            (void)snprintf(out_resolution->type, sizeof(out_resolution->type), "%s", "directory");
        }
    }
    IDOS->UnLock(lock);
}

static void run_real_output_preprocess_control(
    const char *gcc_command,
    const char *sdk_root,
    const char *gcc_version,
    int *out_return_code,
    char out_status[16],
    long *out_size) {
    const char *empty_file = "T:os4tb_discovery_empty.c";
    const char *output_file = "T:os4tb_discovery_output.i";
    char cc1_prefix[OS4TB_MAX_PATH];
    char as_prefix[OS4TB_MAX_PATH];
    char command_buf[(OS4TB_MAX_PATH * 3) + 180];
    FILE *fp = NULL;
    struct stat st;

    *out_return_code = 127;
    *out_size = 0L;
    (void)snprintf(out_status, 16, "%s", "missing");

    fp = fopen(empty_file, "wb");
    if (fp == NULL) {
        return;
    }
    (void)fputs("int os4tb_discovery_empty(void){return 0;}\n", fp);
    (void)fclose(fp);

    if (!join_path4(
            cc1_prefix,
            sizeof(cc1_prefix),
            sdk_root,
            "/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/",
            gcc_version,
            "/")) {
        return;
    }
    if (!join_path3(as_prefix, sizeof(as_prefix), sdk_root, "/gcc/ppc-amigaos/bin/", "")) {
        return;
    }
    if ((int)snprintf(
            command_buf,
            sizeof(command_buf),
            "%s -B%s -B%s -E -x c T:os4tb_discovery_empty.c -o T:os4tb_discovery_output.i",
            gcc_command,
            cc1_prefix,
            as_prefix) >= (int)sizeof(command_buf)) {
        return;
    }

    (void)remove(output_file);
    checkpoint("07D_REAL_OUTPUT_BEGIN");
    *out_return_code = run_command_passthrough(command_buf);
    checkpoint("07D_REAL_OUTPUT_RETURN");

    if (stat(output_file, &st) == 0) {
        (void)snprintf(out_status, 16, "%s", "present");
        *out_size = (long)st.st_size;
    }
}

static int detect_gcc_versions(const char *sdk_root, GccInfo gcc_infos[OS4TB_MAX_GCC], int *out_count) {
    char version_root[OS4TB_MAX_PATH];
    DIR *dir = NULL;
    struct dirent *ent = NULL;
    int count = 0;
    (void)snprintf(version_root, sizeof(version_root), "%s/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos", sdk_root);
    dir = opendir(version_root);
    if (dir == NULL) {
        *out_count = 0;
        return 0;
    }
    while ((ent = readdir(dir)) != NULL) {
        char cc1_path[OS4TB_MAX_PATH];
        if (count >= OS4TB_MAX_GCC) {
            break;
        }
        if (!is_gcc_version_name(ent->d_name)) {
            continue;
        }
        if (!join_path4(cc1_path, sizeof(cc1_path), version_root, "/", ent->d_name, "/cc1")) {
            continue;
        }
        if (!file_is_readable(cc1_path)) {
            continue;
        }
        memset(&gcc_infos[count], 0, sizeof(GccInfo));
        if (!copy_text(gcc_infos[count].version, sizeof(gcc_infos[count].version), ent->d_name) ||
            !copy_text(gcc_infos[count].cc1, sizeof(gcc_infos[count].cc1), cc1_path)) {
            continue;
        }
        count += 1;
    }
    closedir(dir);
    if (count > 1) {
        qsort(gcc_infos, (size_t)count, sizeof(GccInfo), compare_gcc_info);
    }
    *out_count = count;
    return 0;
}

static int parse_include_search_block_file(
    const char *capture_path,
    char dirs[OS4TB_MAX_INCLUDE_DIRS][OS4TB_MAX_PATH],
    char kinds[OS4TB_MAX_INCLUDE_DIRS][24],
    int *count) {
    FILE *fp = fopen(capture_path, "rb");
    char line[OS4TB_MAX_LINE];
    int in_search_block = 0;
    int has_block = 0;
    *count = 0;
    if (fp == NULL) {
        return 0;
    }
    while (fgets(line, sizeof(line), fp) != NULL) {
        char *trim = line;
        size_t len = strlen(trim);
        while (len > 0U && (trim[len - 1U] == '\n' || trim[len - 1U] == '\r')) {
            trim[--len] = '\0';
        }
        if (line_has_include_block_marker(trim)) {
            in_search_block = 1;
            has_block = 1;
            continue;
        }
        if (line_has_include_end_marker(trim)) {
            if (in_search_block) {
                break;
            }
            continue;
        }
        if (!in_search_block) {
            continue;
        }
        while (*trim == ' ' || *trim == '\t') {
            trim += 1;
        }
        if (*trim == '\0') {
            continue;
        }
        if (*count >= OS4TB_MAX_INCLUDE_DIRS) {
            break;
        }
        (void)snprintf(dirs[*count], OS4TB_MAX_PATH, "%s", trim);
        classify_include_kind(trim, kinds[*count], 24);
        *count += 1;
    }
    fclose(fp);
    return has_block;
}

static void detect_include_search_paths(
    const char *gcc_command,
    const char *sdk_root,
    const char *gcc_version,
    char dirs[OS4TB_MAX_INCLUDE_DIRS][OS4TB_MAX_PATH],
    char kinds[OS4TB_MAX_INCLUDE_DIRS][24],
    int *count,
    char *probe_command,
    size_t probe_command_cap,
    char *probe_stream,
    size_t probe_stream_cap,
    char *discovery_status,
    size_t discovery_status_cap,
    int *probe_exit,
    int *stdout_has_block,
    int *stderr_has_block) {
    const char *empty_file = "T:os4tb_discovery_empty.c";
    const char *preprocess_out = "T:os4tb_discovery_output.i";
    const char *capture_out = "T:os4tb_discovery_stdout.txt";
    const char *capture_err = "T:os4tb_discovery_stderr.txt";
    char cc1_prefix[OS4TB_MAX_PATH];
    char as_prefix[OS4TB_MAX_PATH];
    char command_buf[(OS4TB_MAX_PATH * 3) + 160];
    FILE *fp = NULL;

    *count = 0;
    *probe_exit = 127;
    *stdout_has_block = 0;
    *stderr_has_block = 0;
    (void)snprintf(probe_command, probe_command_cap, "%s", "none");
    (void)snprintf(probe_stream, probe_stream_cap, "%s", "none");
    (void)snprintf(discovery_status, discovery_status_cap, "%s", "probe_failed");

    (void)remove(empty_file);
    (void)remove(preprocess_out);
    (void)remove(capture_out);
    (void)remove(capture_err);

    fp = fopen(empty_file, "wb");
    if (fp == NULL) {
        return;
    }
    (void)fputs("int os4tb_discovery_empty(void){return 0;}\n", fp);
    (void)fclose(fp);

    if (!join_path4(
            cc1_prefix,
            sizeof(cc1_prefix),
            sdk_root,
            "/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/",
            gcc_version,
            "/")) {
        return;
    }
    if (!join_path3(as_prefix, sizeof(as_prefix), sdk_root, "/gcc/ppc-amigaos/bin/", "")) {
        return;
    }
    if ((int)snprintf(
            command_buf,
            sizeof(command_buf),
            "%s -B%s -B%s -v -E -x c T:os4tb_discovery_empty.c -o T:os4tb_discovery_output.i",
            gcc_command,
            cc1_prefix,
            as_prefix) >= (int)sizeof(command_buf)) {
        return;
    }
    (void)snprintf(probe_command, probe_command_cap, "%s", command_buf);
    if (OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 1) {
        checkpoint("07A_GCC_NO_CAPTURE_BEGIN");
        *probe_exit = run_command_no_capture(command_buf);
        checkpoint("07A_GCC_NO_CAPTURE_RETURN");
    } else if (OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 2) {
        checkpoint("07B_FILE_CAPTURE_BEGIN");
        *probe_exit = run_command_capture_split_direct(command_buf, capture_out, capture_err);
        checkpoint("07B_FILE_CAPTURE_RETURN");
    } else if (OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 3) {
        checkpoint("07B_SPLIT_HELPER_BEGIN");
        g_trace_split_systemtags = 1;
        *probe_exit = run_command_capture_split(command_buf, capture_out, capture_err);
        g_trace_split_systemtags = 0;
        checkpoint("07B_SPLIT_HELPER_RETURN");
    } else if (OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 4) {
        if ((int)snprintf(
                command_buf,
                sizeof(command_buf),
                "%s -B%s -B%s -E -x c T:os4tb_discovery_empty.c -o T:os4tb_discovery_output.i",
                gcc_command,
                cc1_prefix,
                as_prefix) >= (int)sizeof(command_buf)) {
            return;
        }
        (void)snprintf(probe_command, probe_command_cap, "%s", command_buf);
        checkpoint("07C_PREPROCESS_NO_VERBOSE_BEGIN");
        *probe_exit = run_command_no_capture(command_buf);
        checkpoint("07C_PREPROCESS_NO_VERBOSE_RETURN");
    } else {
        *probe_exit = run_command_capture_split(command_buf, capture_out, capture_err);
    }
    if (*probe_exit != 0) {
        (void)remove(empty_file);
        (void)remove(preprocess_out);
        (void)remove(capture_out);
        (void)remove(capture_err);
        return;
    }

    if (OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 1 || OS4TB_INCLUDE_PROBE_ISOLATION_MODE == 4) {
        (void)snprintf(discovery_status, discovery_status_cap, "%s", "probe_failed");
        (void)remove(empty_file);
        (void)remove(preprocess_out);
        (void)remove(capture_out);
        (void)remove(capture_err);
        return;
    }

    *stderr_has_block = parse_include_search_block_file(capture_err, dirs, kinds, count);

    if (*stderr_has_block) {
        (void)snprintf(probe_stream, probe_stream_cap, "%s", "stderr");
        (void)snprintf(discovery_status, discovery_status_cap, "%s", *count > 0 ? "found" : "empty");
        (void)remove(empty_file);
        (void)remove(preprocess_out);
        (void)remove(capture_out);
        (void)remove(capture_err);
        return;
    }

    (void)snprintf(discovery_status, discovery_status_cap, "%s", "probe_failed");
    (void)remove(empty_file);
    (void)remove(preprocess_out);
    (void)remove(capture_out);
    (void)remove(capture_err);
}

static void detect_library_dirs(const char *sdk_root, const char *gcc_version, char dirs[OS4TB_MAX_LIBRARY_DIRS][OS4TB_MAX_PATH], int *count) {
    char candidates[4][OS4TB_MAX_PATH];
    int i = 0;
    *count = 0;
    (void)snprintf(candidates[0], sizeof(candidates[0]), "%s/newlib/lib", sdk_root);
    (void)snprintf(candidates[1], sizeof(candidates[1]), "%s/local/newlib/lib", sdk_root);
    (void)snprintf(candidates[2], sizeof(candidates[2]), "%s/local/common/lib", sdk_root);
    (void)snprintf(candidates[3], sizeof(candidates[3]), "%s/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/%s", sdk_root, gcc_version);
    for (i = 0; i < 4; i += 1) {
        if (*count >= OS4TB_MAX_LIBRARY_DIRS) {
            break;
        }
        if (is_directory(candidates[i])) {
            (void)snprintf(dirs[*count], OS4TB_MAX_PATH, "%s", candidates[i]);
            *count += 1;
        }
    }
}

static int add_unique_internal_include(char dirs[OS4TB_MAX_INTERNAL_INCLUDE_DIRS][OS4TB_MAX_PATH], int *count, const char *dir) {
    int i = 0;
    for (i = 0; i < *count; i += 1) {
        if (strcmp(dirs[i], dir) == 0) {
            return 1;
        }
    }
    if (*count >= OS4TB_MAX_INTERNAL_INCLUDE_DIRS) {
        return 0;
    }
    (void)snprintf(dirs[*count], OS4TB_MAX_PATH, "%s", dir);
    *count += 1;
    return 1;
}

static void detect_internal_include_dirs(
    const char *sdk_root,
    const char *gcc_version,
    char dirs[OS4TB_MAX_INTERNAL_INCLUDE_DIRS][OS4TB_MAX_PATH],
    int *count) {
    char candidate[OS4TB_MAX_PATH];
    *count = 0;

    if (join_path4(
            candidate,
            sizeof(candidate),
            sdk_root,
            "/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/",
            gcc_version,
            "/include") &&
        is_directory(candidate)) {
        (void)add_unique_internal_include(dirs, count, candidate);
    }

    if (join_path4(
            candidate,
            sizeof(candidate),
            sdk_root,
            "/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/",
            gcc_version,
            "/include-fixed") &&
        is_directory(candidate)) {
        (void)add_unique_internal_include(dirs, count, candidate);
    }

    if (join_path4(
            candidate,
            sizeof(candidate),
            sdk_root,
            "/gcc/ppc-amigaos/bin/libexec/gcc/ppc-amigaos/",
            gcc_version,
            "/include") &&
        is_directory(candidate)) {
        (void)add_unique_internal_include(dirs, count, candidate);
    }
}

static void detect_internal_header_dirs(GccInfo *info) {
    int i = 0;
    char candidate[OS4TB_MAX_PATH];
    (void)snprintf(info->internal_stddef_dir, sizeof(info->internal_stddef_dir), "%s", "unknown");
    (void)snprintf(info->internal_stdarg_dir, sizeof(info->internal_stdarg_dir), "%s", "unknown");
    (void)snprintf(info->internal_stdint_dir, sizeof(info->internal_stdint_dir), "%s", "unknown");
    for (i = 0; i < info->internal_include_count; i += 1) {
        if (join_path3(candidate, sizeof(candidate), info->internal_include_dirs[i], "/", "stddef.h") &&
            file_is_readable(candidate) &&
            strcmp(info->internal_stddef_dir, "unknown") == 0) {
            (void)snprintf(info->internal_stddef_dir, sizeof(info->internal_stddef_dir), "%s", info->internal_include_dirs[i]);
        }
        if (join_path3(candidate, sizeof(candidate), info->internal_include_dirs[i], "/", "stdarg.h") &&
            file_is_readable(candidate) &&
            strcmp(info->internal_stdarg_dir, "unknown") == 0) {
            (void)snprintf(info->internal_stdarg_dir, sizeof(info->internal_stdarg_dir), "%s", info->internal_include_dirs[i]);
        }
        if (join_path3(candidate, sizeof(candidate), info->internal_include_dirs[i], "/", "stdint.h") &&
            file_is_readable(candidate) &&
            strcmp(info->internal_stdint_dir, "unknown") == 0) {
            (void)snprintf(info->internal_stdint_dir, sizeof(info->internal_stdint_dir), "%s", info->internal_include_dirs[i]);
        }
    }
}

static void detect_library_inventory(char dirs[OS4TB_MAX_LIBRARY_DIRS][OS4TB_MAX_PATH], int dir_count, char libraries[OS4TB_MAX_LIBRARY_INVENTORY][OS4TB_MAX_LIBRARY_NAME], int *library_count, int *truncated) {
    int i = 0;
    *library_count = 0;
    *truncated = 0;
    for (i = 0; i < dir_count; i += 1) {
        DIR *dir = opendir(dirs[i]);
        struct dirent *ent = NULL;
        if (dir == NULL) {
            continue;
        }
        while ((ent = readdir(dir)) != NULL) {
            size_t len = strlen(ent->d_name);
            char logical_name[OS4TB_MAX_LIBRARY_NAME];
            if (len <= 5U || len >= OS4TB_MAX_LIBRARY_NAME) {
                continue;
            }
            if (!starts_with(ent->d_name, "lib")) {
                continue;
            }
            if (!is_ascii_case_equal(ent->d_name + len - 2U, ".a")) {
                continue;
            }
            (void)snprintf(logical_name, sizeof(logical_name), "%.*s", (int)(len - 5U), ent->d_name + 3);
            (void)add_unique_library(libraries, library_count, logical_name, truncated);
        }
        closedir(dir);
    }
    if (*library_count > 1) {
        qsort(libraries, (size_t)(*library_count), sizeof(libraries[0]), compare_library_name);
    }
}

static void detect_runtime_paths(const char *sdk_root, const char *gcc_version, GccInfo *info) {
    (void)snprintf(info->libgcc, sizeof(info->libgcc), "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/%s/libgcc.a", gcc_version);
    (void)snprintf(info->libgcc_eh, sizeof(info->libgcc_eh), "GCC:ppc-amigaos/bin/lib/gcc/ppc-amigaos/%s/libgcc_eh.a", gcc_version);
    if (!file_is_readable(info->libgcc)) {
        (void)snprintf(info->libgcc, sizeof(info->libgcc), "%s/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/%s/libgcc.a", sdk_root, gcc_version);
    }
    if (!file_is_readable(info->libgcc_eh)) {
        (void)snprintf(info->libgcc_eh, sizeof(info->libgcc_eh), "%s/gcc/ppc-amigaos/bin/lib/gcc/ppc-amigaos/%s/libgcc_eh.a", sdk_root, gcc_version);
    }
    (void)snprintf(info->crtbegin, sizeof(info->crtbegin), "%s/newlib/lib/crtbegin.o", sdk_root);
    (void)snprintf(info->crtend, sizeof(info->crtend), "%s/newlib/lib/crtend.o", sdk_root);
}

static int version_line_is_usable(const char *line) {
    return strstr(line, "No objects to link") == NULL && strpbrk(line, "0123456789") != NULL;
}

static void detect_command_version(const char *command, char *out_version, size_t out_version_cap) {
    const char *capture = "T:os4tb_discovery_command.txt";
    char first_line[OS4TB_MAX_PATH];
    (void)snprintf(out_version, out_version_cap, "%s", "unknown");
    if (run_command_capture_both(command, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        version_line_is_usable(first_line)) {
        (void)snprintf(out_version, out_version_cap, "%s", first_line);
    }
}

static void detect_tool_at_path(const char *tool_path, const char *fallback_command, char out_status[24], char out_version[OS4TB_MAX_PATH]) {
    char command[OS4TB_MAX_PATH + 20];
    const char *capture = "T:os4tb_discovery_tool_path.txt";
    char first_line[OS4TB_MAX_PATH];
    (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", "unknown");
    if (!file_is_readable(tool_path)) {
        (void)snprintf(out_status, 24, "%s", "missing");
        return;
    }
    (void)snprintf(out_status, 24, "%s", "present");
    if (join_path3(command, sizeof(command), tool_path, "", " --version") &&
        run_command_capture_both(command, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        version_line_is_usable(first_line)) {
        (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", first_line);
        return;
    }
    if (fallback_command != NULL &&
        run_command_capture_both(fallback_command, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        version_line_is_usable(first_line)) {
        (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", first_line);
    }
}

static void detect_command_path(const char *command_name, char out_path[OS4TB_MAX_PATH], char out_status[24]) {
    const char *capture = "T:os4tb_discovery_command_path.txt";
    char first_line[OS4TB_MAX_PATH];
    char cmd[OS4TB_MAX_PATH];
    (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", "unknown");
    (void)snprintf(out_status, 24, "%s", "missing");
    (void)snprintf(cmd, sizeof(cmd), "Which %s", command_name);
    if (run_command_capture_both(cmd, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        strstr(first_line, "Unknown command") == NULL &&
        strstr(first_line, "not found") == NULL) {
        (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", first_line);
        (void)snprintf(out_status, 24, "%s", "present");
        return;
    }
    (void)snprintf(cmd, sizeof(cmd), "which %s", command_name);
    if (run_command_capture_both(cmd, capture) == 0 &&
        read_first_nonempty_line(capture, first_line, sizeof(first_line)) == 0 &&
        strstr(first_line, "Unknown command") == NULL &&
        strstr(first_line, "not found") == NULL) {
        (void)snprintf(out_path, OS4TB_MAX_PATH, "%s", first_line);
        (void)snprintf(out_status, 24, "%s", "present");
    }
}

static void detect_vbcc_presence_version(
    char out_status[24],
    char out_version[OS4TB_MAX_PATH],
    char out_driver_command[32],
    char out_driver_path[OS4TB_MAX_PATH],
    char out_linker_status[24],
    char out_linker_path[OS4TB_MAX_PATH],
    char out_assembler_status[24],
    char out_assembler_path[OS4TB_MAX_PATH]) {
    const char *capture = "T:os4tb_discovery_vbcc.txt";
    char first_line[OS4TB_MAX_PATH];
    int i = 0;
    (void)snprintf(out_status, 24, "%s", "missing");
    (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", "unknown");
    (void)snprintf(out_driver_command, 32, "%s", "unknown");
    detect_command_path("vc", out_driver_path, out_status);
    if (strcmp(out_status, "present") == 0) {
        (void)snprintf(out_driver_command, 32, "%s", "vc");
    } else {
        char vbcc_path_status[24];
        detect_command_path("vbcc", out_driver_path, vbcc_path_status);
        if (strcmp(vbcc_path_status, "present") == 0) {
            (void)snprintf(out_status, 24, "%s", "present");
            (void)snprintf(out_driver_command, 32, "%s", "vbcc");
        }
    }
    detect_command_path("vlink", out_linker_path, out_linker_status);
    detect_command_path("vasmppc_std", out_assembler_path, out_assembler_status);
    for (i = 0; i < (int)(sizeof(kVbccCommands) / sizeof(kVbccCommands[0])); i += 1) {
        int rc = run_command_capture_both(kVbccCommands[i], capture);
        if (read_first_nonempty_line(capture, first_line, sizeof(first_line)) != 0) {
            continue;
        }
        if (strstr(first_line, "Unknown command") != NULL || strstr(first_line, "not found") != NULL) {
            continue;
        }
        (void)snprintf(out_status, 24, "%s", "present");
        if (starts_with(kVbccCommands[i], "vc")) {
            (void)snprintf(out_driver_command, 32, "%s", "vc");
        } else if (starts_with(kVbccCommands[i], "vbcc")) {
            (void)snprintf(out_driver_command, 32, "%s", "vbcc");
        }
        if (rc == 0 && version_line_is_usable(first_line)) {
            (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", first_line);
            return;
        }
        if (strstr(first_line, "No objects to link") != NULL) {
            (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", "unknown");
            return;
        }
        if (version_line_is_usable(first_line)) {
            (void)snprintf(out_version, OS4TB_MAX_PATH, "%s", first_line);
            return;
        }
    }
}

static int current_debug_stage(void) {
    int stage = OS4TB_DISCOVERY_DEBUG_STAGE;
    if (stage < 1) {
        return 1;
    }
    if (stage > 11) {
        return 11;
    }
    return stage;
}

static void checkpoint(const char *name) {
    size_t line_len = strlen("CHECKPOINT=") + strlen(name);
    FILE *fp = NULL;
    if (!g_progress_ready) {
        return;
    }
    if (g_checkpoint_count >= OS4TB_MAX_CHECKPOINTS) {
        return;
    }
    if (line_len + 1U > OS4TB_MAX_CHECKPOINT_LINE) {
        return;
    }
    fp = fopen(g_progress_path, "ab");
    if (fp == NULL) {
        return;
    }
    (void)fprintf(fp, "CHECKPOINT=%s\n", name);
    (void)fclose(fp);
    g_checkpoint_count += 1;
}

static int initialize_progress_path(const char *artifact_name) {
    char request_id[129];
    char progress_name[160];
    size_t artifact_len = strlen(artifact_name);
    size_t suffix_len = strlen(".artifact");
    if (!copy_text(request_id, sizeof(request_id), artifact_name)) {
        return 0;
    }
    if (artifact_len > suffix_len && strcmp(artifact_name + artifact_len - suffix_len, ".artifact") == 0) {
        request_id[artifact_len - suffix_len] = '\0';
    }
    if (!is_safe_basename(request_id)) {
        return 0;
    }
    if (!join_path3(progress_name, sizeof(progress_name), request_id, "", ".discovery-progress.txt")) {
        return 0;
    }
    if (!is_safe_basename(progress_name)) {
        return 0;
    }
    if (!join_path3(g_progress_path, sizeof(g_progress_path), "SAMDROP:results/", progress_name, "")) {
        return 0;
    }
    g_progress_ready = 1;
    g_checkpoint_count = 0;
    {
        FILE *fp = fopen(g_progress_path, "wb");
        if (fp == NULL) {
            g_progress_ready = 0;
            return 0;
        }
        (void)fclose(fp);
    }
    return 1;
}

static int write_minimal_alive_artifact(const char *artifact_name, int stage, const char *sdk_status, const char *sdk_root, const char *gcc_assign, const char *lib_assign) {
    FILE *artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_DISCOVERY_VERSION=%d\n", OS4TB_DISCOVERY_VERSION);
    (void)fprintf(artifact_fp, "OS4TB_DISCOVERY_DEBUG_STAGE=%d\n", stage);
    (void)fprintf(artifact_fp, "OS4TB_DISCOVERY_TEST_STATUS=alive\n");
    (void)fprintf(artifact_fp, "OS4TB_SDK_STATUS=%s\n", sdk_status);
    (void)fprintf(artifact_fp, "OS4TB_SDK_ROOT=%s\n", sdk_root);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ASSIGN=%s\n", gcc_assign);
    (void)fprintf(artifact_fp, "OS4TB_LIB_ASSIGN=%s\n", lib_assign);
    (void)fprintf(artifact_fp, "OS4TB_GCC_COUNT=0\n");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_STATUS=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_VBCC_VERSION=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_AS_STATUS=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_AS_PATH=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_AS_VERSION=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_LD_STATUS=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_LD_PATH=unknown\n");
    (void)fprintf(artifact_fp, "OS4TB_LD_VERSION=unknown\n");
    if (fclose(artifact_fp) != 0) {
        return 5;
    }
    return 0;
}

static int run_discovery_body(const char *artifact_name, int stage) {
    char sdk_root[OS4TB_MAX_PATH];
    char sdk_status[24];
    char gcc_assign_status[24];
    char lib_assign_status[24];
    char vbcc_status[24];
    char vbcc_version[OS4TB_MAX_PATH];
    char vbcc_driver_command[32];
    char vbcc_driver_path[OS4TB_MAX_PATH];
    char vbcc_linker_status[24];
    char vbcc_linker_path[OS4TB_MAX_PATH];
    char vbcc_assembler_status[24];
    char vbcc_assembler_path[OS4TB_MAX_PATH];
    char as_status[24];
    char as_version[OS4TB_MAX_PATH];
    char as_path_global[OS4TB_MAX_PATH];
    char ld_status[24];
    char ld_version[OS4TB_MAX_PATH];
    char ld_path_global[OS4TB_MAX_PATH];
    char gcc_active_frontend[OS4TB_MAX_PATH];
    char gcc_active_version[OS4TB_MAX_VERSION];
    int real_output_return_code = 127;
    char real_output_status[16];
    long real_output_size = 0L;
    char real_output_requester[16];
    int real_output_ran = 0;
    int gcc_count = 0;
    int i = 0;
    FILE *artifact_fp = NULL;

    checkpoint("04_BODY_ENTER");

    memset(g_gcc_infos, 0, sizeof(g_gcc_infos));
    (void)snprintf(sdk_root, sizeof(sdk_root), "%s", "unknown");
    (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "unknown");
    (void)snprintf(gcc_assign_status, sizeof(gcc_assign_status), "%s", "unknown");
    (void)snprintf(lib_assign_status, sizeof(lib_assign_status), "%s", "unknown");
    (void)snprintf(vbcc_status, sizeof(vbcc_status), "%s", "unknown");
    (void)snprintf(vbcc_version, sizeof(vbcc_version), "%s", "unknown");
    (void)snprintf(vbcc_driver_command, sizeof(vbcc_driver_command), "%s", "unknown");
    (void)snprintf(vbcc_driver_path, sizeof(vbcc_driver_path), "%s", "unknown");
    (void)snprintf(vbcc_linker_status, sizeof(vbcc_linker_status), "%s", "unknown");
    (void)snprintf(vbcc_linker_path, sizeof(vbcc_linker_path), "%s", "unknown");
    (void)snprintf(vbcc_assembler_status, sizeof(vbcc_assembler_status), "%s", "unknown");
    (void)snprintf(vbcc_assembler_path, sizeof(vbcc_assembler_path), "%s", "unknown");
    (void)snprintf(as_status, sizeof(as_status), "%s", "unknown");
    (void)snprintf(as_version, sizeof(as_version), "%s", "unknown");
    (void)snprintf(as_path_global, sizeof(as_path_global), "%s", "unknown");
    (void)snprintf(ld_status, sizeof(ld_status), "%s", "unknown");
    (void)snprintf(ld_version, sizeof(ld_version), "%s", "unknown");
    (void)snprintf(ld_path_global, sizeof(ld_path_global), "%s", "unknown");
    (void)snprintf(gcc_active_frontend, sizeof(gcc_active_frontend), "%s", "/System/C/gcc");
    (void)snprintf(gcc_active_version, sizeof(gcc_active_version), "%s", "unknown");
    (void)snprintf(real_output_status, sizeof(real_output_status), "%s", "missing");
    (void)snprintf(real_output_requester, sizeof(real_output_requester), "%s", "unknown");

    resolve_assign_targets("SDK", &g_assign_sdk);
    resolve_assign_targets("GCC", &g_assign_gcc);
    resolve_assign_targets("LIB", &g_assign_lib);
    resolve_assign_targets("C", &g_assign_c);
    resolve_assign_targets("System", &g_assign_system);
    resolve_assign_targets("T", &g_assign_t);

    checkpoint("05_SDK_BEGIN");
    if (detect_sdk_root(sdk_root)) {
        (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "present");
    } else {
        (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "missing");
    }
    (void)snprintf(gcc_assign_status, sizeof(gcc_assign_status), "%s", is_directory("GCC:") ? "present" : "missing");
    (void)snprintf(lib_assign_status, sizeof(lib_assign_status), "%s", is_directory("LIB:") ? "present" : "missing");
    checkpoint("05_SDK_PASS");

    if (stage >= 4 && strcmp(sdk_status, "present") == 0) {
        checkpoint("06_GCC_ENUM_BEGIN");
        (void)detect_gcc_versions(sdk_root, g_gcc_infos, &gcc_count);
        checkpoint("06_GCC_ENUM_PASS");
    }

    for (i = 0; i < gcc_count; i += 1) {
        if (!join_path3(
                g_gcc_infos[i].driver,
                sizeof(g_gcc_infos[i].driver),
                sdk_root,
                "/gcc/ppc-amigaos/bin/",
                "gcc")) {
            (void)snprintf(g_gcc_infos[i].driver, sizeof(g_gcc_infos[i].driver), "%s", "unknown");
        }
        if (!join_path3(
                g_gcc_infos[i].as_path,
                sizeof(g_gcc_infos[i].as_path),
                sdk_root,
                "/gcc/ppc-amigaos/bin/",
                "as")) {
            (void)snprintf(g_gcc_infos[i].as_path, sizeof(g_gcc_infos[i].as_path), "%s", "unknown");
        }
        if (!join_path3(
                g_gcc_infos[i].ld_path,
                sizeof(g_gcc_infos[i].ld_path),
                sdk_root,
                "/gcc/ppc-amigaos/bin/",
                "ld")) {
            (void)snprintf(g_gcc_infos[i].ld_path, sizeof(g_gcc_infos[i].ld_path), "%s", "unknown");
        }
        if (stage >= 5) {
            const char *include_probe_command = "gcc";
            if (!real_output_ran && strcmp(g_gcc_infos[i].version, "11.5.0") == 0) {
                run_real_output_preprocess_control(
                    include_probe_command,
                    sdk_root,
                    g_gcc_infos[i].version,
                    &real_output_return_code,
                    real_output_status,
                    &real_output_size);
                real_output_ran = 1;
            }
            checkpoint("07_INCLUDE_PROBE_EXEC_BEGIN");
            detect_include_search_paths(
                include_probe_command,
                sdk_root,
                g_gcc_infos[i].version,
                g_gcc_infos[i].include_dirs,
                g_gcc_infos[i].include_kinds,
                &g_gcc_infos[i].include_count,
                g_gcc_infos[i].include_probe_command,
                sizeof(g_gcc_infos[i].include_probe_command),
                g_gcc_infos[i].include_probe_stream,
                sizeof(g_gcc_infos[i].include_probe_stream),
                g_gcc_infos[i].include_discovery_status,
                sizeof(g_gcc_infos[i].include_discovery_status),
                &g_gcc_infos[i].include_probe_exit,
                &g_gcc_infos[i].include_probe_stdout_has_block,
                &g_gcc_infos[i].include_probe_stderr_has_block);
            checkpoint("07_INCLUDE_PROBE_EXEC_PASS");
            detect_internal_include_dirs(
                sdk_root,
                g_gcc_infos[i].version,
                g_gcc_infos[i].internal_include_dirs,
                &g_gcc_infos[i].internal_include_count);
            detect_internal_header_dirs(&g_gcc_infos[i]);
        }
        if (stage >= 7) {
            checkpoint("08_LIBRARY_DIRS_BEGIN");
            detect_library_dirs(sdk_root, g_gcc_infos[i].version, g_gcc_infos[i].library_dirs, &g_gcc_infos[i].library_dir_count);
            checkpoint("08_LIBRARY_DIRS_PASS");
        }
        if (stage >= 8) {
            checkpoint("09_LIBRARY_INV_BEGIN");
            detect_library_inventory(
                g_gcc_infos[i].library_dirs,
                g_gcc_infos[i].library_dir_count,
                g_gcc_infos[i].libraries,
                &g_gcc_infos[i].library_count,
                &g_gcc_infos[i].library_inventory_truncated);
            checkpoint("09_LIBRARY_INV_PASS");
        }
        if (stage >= 9) {
            checkpoint("10_RUNTIME_PATHS_BEGIN");
            detect_runtime_paths(sdk_root, g_gcc_infos[i].version, &g_gcc_infos[i]);
            checkpoint("10_RUNTIME_PATHS_PASS");
        }
    }

    if (stage >= 10) {
        checkpoint("11_AS_LD_BEGIN");
        if (gcc_count > 0) {
            (void)snprintf(as_path_global, sizeof(as_path_global), "%s", g_gcc_infos[0].as_path);
            (void)snprintf(ld_path_global, sizeof(ld_path_global), "%s", g_gcc_infos[0].ld_path);
        }
        detect_tool_at_path(as_path_global, "as --version", as_status, as_version);
        detect_tool_at_path(ld_path_global, "ld --version", ld_status, ld_version);
        detect_command_version("gcc -dumpfullversion -dumpversion", gcc_active_version, sizeof(gcc_active_version));
        checkpoint("11_AS_LD_PASS");
    }

    if (stage >= 11) {
        checkpoint("12_VBCC_BEGIN");
        detect_vbcc_presence_version(
            vbcc_status,
            vbcc_version,
            vbcc_driver_command,
            vbcc_driver_path,
            vbcc_linker_status,
            vbcc_linker_path,
            vbcc_assembler_status,
            vbcc_assembler_path);
        checkpoint("12_VBCC_PASS");
    }

    checkpoint("13_ARTIFACT_OPEN_BEGIN");
    if (!real_output_ran && gcc_count > 0) {
        run_real_output_preprocess_control(
            "gcc",
            sdk_root,
            g_gcc_infos[0].version,
            &real_output_return_code,
            real_output_status,
            &real_output_size);
    }
    artifact_fp = fopen(artifact_name, "wb");
    if (artifact_fp == NULL) {
        return 4;
    }
    (void)fprintf(artifact_fp, "OS4TB_DISCOVERY_VERSION=%d\n", OS4TB_DISCOVERY_VERSION);
    (void)fprintf(artifact_fp, "OS4TB_DISCOVERY_DEBUG_STAGE=%d\n", stage);
    (void)fprintf(artifact_fp, "OS4TB_SDK_STATUS=%s\n", sdk_status);
    (void)fprintf(artifact_fp, "OS4TB_SDK_ROOT=%s\n", sdk_root);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ASSIGN=%s\n", gcc_assign_status);
    (void)fprintf(artifact_fp, "OS4TB_LIB_ASSIGN=%s\n", lib_assign_status);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ACTIVE_FRONTEND=%s\n", gcc_active_frontend);
    (void)fprintf(artifact_fp, "OS4TB_GCC_ACTIVE_VERSION=%s\n", gcc_active_version);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SDK_STATUS=%s\n", g_assign_sdk.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SDK_TYPE=%s\n", g_assign_sdk.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SDK_TARGET_COUNT=%d\n", g_assign_sdk.target_count);
    for (i = 0; i < g_assign_sdk.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SDK_TARGET_%d=%s\n", i, g_assign_sdk.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SDK_LOCK_STATUS=%s\n", g_assign_sdk.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_GCC_STATUS=%s\n", g_assign_gcc.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_GCC_TYPE=%s\n", g_assign_gcc.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_GCC_TARGET_COUNT=%d\n", g_assign_gcc.target_count);
    for (i = 0; i < g_assign_gcc.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_GCC_TARGET_%d=%s\n", i, g_assign_gcc.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_GCC_LOCK_STATUS=%s\n", g_assign_gcc.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_LIB_STATUS=%s\n", g_assign_lib.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_LIB_TYPE=%s\n", g_assign_lib.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_LIB_TARGET_COUNT=%d\n", g_assign_lib.target_count);
    for (i = 0; i < g_assign_lib.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_LIB_TARGET_%d=%s\n", i, g_assign_lib.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_LIB_LOCK_STATUS=%s\n", g_assign_lib.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_C_STATUS=%s\n", g_assign_c.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_C_TYPE=%s\n", g_assign_c.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_C_TARGET_COUNT=%d\n", g_assign_c.target_count);
    for (i = 0; i < g_assign_c.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_C_TARGET_%d=%s\n", i, g_assign_c.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_C_LOCK_STATUS=%s\n", g_assign_c.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SYSTEM_STATUS=%s\n", g_assign_system.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SYSTEM_TYPE=%s\n", g_assign_system.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SYSTEM_TARGET_COUNT=%d\n", g_assign_system.target_count);
    for (i = 0; i < g_assign_system.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SYSTEM_TARGET_%d=%s\n", i, g_assign_system.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_SYSTEM_LOCK_STATUS=%s\n", g_assign_system.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_T_STATUS=%s\n", g_assign_t.status);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_T_TYPE=%s\n", g_assign_t.type);
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_T_TARGET_COUNT=%d\n", g_assign_t.target_count);
    for (i = 0; i < g_assign_t.target_count; i += 1) {
        (void)fprintf(artifact_fp, "OS4TB_ASSIGN_T_TARGET_%d=%s\n", i, g_assign_t.targets[i]);
    }
    (void)fprintf(artifact_fp, "OS4TB_ASSIGN_T_LOCK_STATUS=%s\n", g_assign_t.lock_status);
    (void)fprintf(artifact_fp, "OS4TB_REAL_OUTPUT_RETURN_CODE=%d\n", real_output_return_code);
    (void)fprintf(artifact_fp, "OS4TB_REAL_OUTPUT_STATUS=%s\n", real_output_status);
    (void)fprintf(artifact_fp, "OS4TB_REAL_OUTPUT_SIZE=%ld\n", real_output_size);
    (void)fprintf(artifact_fp, "OS4TB_REAL_OUTPUT_REQUESTER=%s\n", real_output_requester);
    (void)fprintf(artifact_fp, "OS4TB_GCC_COUNT=%d\n", gcc_count);
    for (i = 0; i < gcc_count; i += 1) {
        int j = 0;
        char libgcc_status[24];
        char libgcc_eh_status[24];
        char crtbegin_status[24];
        char crtend_status[24];
        detect_path_status(g_gcc_infos[i].libgcc, libgcc_status);
        detect_path_status(g_gcc_infos[i].libgcc_eh, libgcc_eh_status);
        detect_path_status(g_gcc_infos[i].crtbegin, crtbegin_status);
        detect_path_status(g_gcc_infos[i].crtend, crtend_status);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_STATUS=%s\n", i, file_is_readable(g_gcc_infos[i].cc1) ? "present" : "missing");
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_VERSION=%s\n", i, g_gcc_infos[i].version);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_DRIVER=%s\n", i, g_gcc_infos[i].driver);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_CC1=%s\n", i, g_gcc_infos[i].cc1);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_AS=%s\n", i, g_gcc_infos[i].as_path);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LD=%s\n", i, g_gcc_infos[i].ld_path);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_COUNT=%d\n", i, g_gcc_infos[i].include_count);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_PROBE_COMMAND=%s\n", i, g_gcc_infos[i].include_probe_command);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_PROBE_STREAM=%s\n", i, g_gcc_infos[i].include_probe_stream);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_DISCOVERY_STATUS=%s\n", i, g_gcc_infos[i].include_discovery_status);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_PROBE_EXIT=%d\n", i, g_gcc_infos[i].include_probe_exit);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_PROBE_STDOUT_HAS_BLOCK=%d\n", i, g_gcc_infos[i].include_probe_stdout_has_block ? 1 : 0);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_PROBE_STDERR_HAS_BLOCK=%d\n", i, g_gcc_infos[i].include_probe_stderr_has_block ? 1 : 0);
        for (j = 0; j < g_gcc_infos[i].include_count; j += 1) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_%d=%s\n", i, j, g_gcc_infos[i].include_dirs[j]);
            (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INCLUDE_%d_KIND=%s\n", i, j, g_gcc_infos[i].include_kinds[j]);
        }
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INTERNAL_INCLUDE_DIR_COUNT=%d\n", i, g_gcc_infos[i].internal_include_count);
        for (j = 0; j < g_gcc_infos[i].internal_include_count; j += 1) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INTERNAL_INCLUDE_DIR_%d=%s\n", i, j, g_gcc_infos[i].internal_include_dirs[j]);
        }
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INTERNAL_STDDEF_DIR=%s\n", i, g_gcc_infos[i].internal_stddef_dir);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INTERNAL_STDARG_DIR=%s\n", i, g_gcc_infos[i].internal_stdarg_dir);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_INTERNAL_STDINT_DIR=%s\n", i, g_gcc_infos[i].internal_stdint_dir);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LIBRARY_DIR_COUNT=%d\n", i, g_gcc_infos[i].library_dir_count);
        for (j = 0; j < g_gcc_infos[i].library_dir_count; j += 1) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LIBRARY_DIR_%d=%s\n", i, j, g_gcc_infos[i].library_dirs[j]);
        }
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LIBRARY_INVENTORY_COUNT=%d\n", i, g_gcc_infos[i].library_count);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LIBRARY_INVENTORY_TRUNCATED=%d\n", i, g_gcc_infos[i].library_inventory_truncated ? 1 : 0);
        for (j = 0; j < g_gcc_infos[i].library_count; j += 1) {
            (void)fprintf(artifact_fp, "OS4TB_GCC_%d_LIBRARY_INVENTORY_%d=%s\n", i, j, g_gcc_infos[i].libraries[j]);
        }
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_RUNTIME_LIBGCC=%s\n", i, g_gcc_infos[i].libgcc);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_RUNTIME_LIBGCC_STATUS=%s\n", i, libgcc_status);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_RUNTIME_LIBGCC_EH=%s\n", i, g_gcc_infos[i].libgcc_eh);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_RUNTIME_LIBGCC_EH_STATUS=%s\n", i, libgcc_eh_status);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_CRTBEGIN=%s\n", i, g_gcc_infos[i].crtbegin);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_CRTBEGIN_STATUS=%s\n", i, crtbegin_status);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_CRTEND=%s\n", i, g_gcc_infos[i].crtend);
        (void)fprintf(artifact_fp, "OS4TB_GCC_%d_CRTEND_STATUS=%s\n", i, crtend_status);
    }
    (void)fprintf(artifact_fp, "OS4TB_VBCC_STATUS=%s\n", vbcc_status);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_VERSION=%s\n", vbcc_version);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_DRIVER_COMMAND=%s\n", vbcc_driver_command);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_DRIVER_PATH=%s\n", vbcc_driver_path);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_LINKER_STATUS=%s\n", vbcc_linker_status);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_LINKER_PATH=%s\n", vbcc_linker_path);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_ASSEMBLER_STATUS=%s\n", vbcc_assembler_status);
    (void)fprintf(artifact_fp, "OS4TB_VBCC_ASSEMBLER_PATH=%s\n", vbcc_assembler_path);
    (void)fprintf(artifact_fp, "OS4TB_AS_STATUS=%s\n", as_status);
    (void)fprintf(artifact_fp, "OS4TB_AS_PATH=%s\n", as_path_global);
    (void)fprintf(artifact_fp, "OS4TB_AS_VERSION=%s\n", as_version);
    (void)fprintf(artifact_fp, "OS4TB_LD_STATUS=%s\n", ld_status);
    (void)fprintf(artifact_fp, "OS4TB_LD_PATH=%s\n", ld_path_global);
    (void)fprintf(artifact_fp, "OS4TB_LD_VERSION=%s\n", ld_version);
    if (fclose(artifact_fp) != 0) {
        return 5;
    }
    checkpoint("13_ARTIFACT_OPEN_PASS");
    return 0;
}

int main(int argc, char **argv) {
    const char *artifact_name = "phase7f_toolchain_discovery.artifact";
    int stage = current_debug_stage();
    char sdk_root[OS4TB_MAX_PATH];
    char sdk_status[24];
    char gcc_assign_status[24];
    char lib_assign_status[24];

    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }
    if (!is_safe_basename(artifact_name)) {
        return 7;
    }

    (void)initialize_progress_path(artifact_name);
    checkpoint("01_START");

    (void)snprintf(sdk_root, sizeof(sdk_root), "%s", "unknown");
    (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "unknown");
    (void)snprintf(gcc_assign_status, sizeof(gcc_assign_status), "%s", "unknown");
    (void)snprintf(lib_assign_status, sizeof(lib_assign_status), "%s", "unknown");

    if (stage == 1) {
        checkpoint("02_MINIMAL_ARTIFACT_BEGIN");
        {
            int rc = write_minimal_alive_artifact(
                artifact_name,
                stage,
                sdk_status,
                sdk_root,
                gcc_assign_status,
                lib_assign_status);
            if (rc != 0) {
                return rc;
            }
        }
        checkpoint("02_MINIMAL_ARTIFACT_PASS");
        return 0;
    }

    checkpoint("03_SDK_PRECHECK_BEGIN");
    if (detect_sdk_root(sdk_root)) {
        (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "present");
    } else {
        (void)snprintf(sdk_status, sizeof(sdk_status), "%s", "missing");
    }
    (void)snprintf(gcc_assign_status, sizeof(gcc_assign_status), "%s", is_directory("GCC:") ? "present" : "missing");
    (void)snprintf(lib_assign_status, sizeof(lib_assign_status), "%s", is_directory("LIB:") ? "present" : "missing");
    checkpoint("03_SDK_PRECHECK_PASS");

    if (stage == 2) {
        checkpoint("03_STAGE2_ARTIFACT_BEGIN");
        {
            int rc = write_minimal_alive_artifact(
                artifact_name,
                stage,
                sdk_status,
                sdk_root,
                gcc_assign_status,
                lib_assign_status);
            if (rc != 0) {
                return rc;
            }
        }
        checkpoint("03_STAGE2_ARTIFACT_PASS");
        return 0;
    }

    checkpoint("04_BODY_BEGIN");
    return run_discovery_body(artifact_name, stage);
}
