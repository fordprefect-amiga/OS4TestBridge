#include <ctype.h>
#include <dirent.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define OS4TB_INCOMING_DIR "SAMDROP:incoming"
#define OS4TB_PROCESSED_DIR "SAMDROP:processed"
#define OS4TB_RUNNER_PATH "SAMDROP:incoming/os4tb_guest_runner"
#define OS4TB_POLL_INTERVAL_SECONDS 1U

static volatile sig_atomic_t g_stop = 0;
static bool g_workbench_mode = false;

static void on_signal(int signo) {
    (void)signo;
    g_stop = 1;
}

static bool is_workbench_launch(int argc) {
    return argc == 0;
}

static void agent_info(const char *message) {
    if (!g_workbench_mode) {
        (void)printf("%s\n", message);
    }
}

static void agent_errorf(const char *prefix, const char *value) {
    if (!g_workbench_mode) {
        (void)fprintf(stderr, "%s: %s\n", prefix, value);
    }
}

static bool is_safe_request_id(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > 64U) {
        return false;
    }
    for (i = 0U; i < len; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (!(isalnum(c) || c == '_' || c == '-')) {
            return false;
        }
    }
    return true;
}

static bool parse_request_filename(const char *name, char *request_id, size_t request_id_cap) {
    const char *prefix = "request_";
    const char *suffix = ".req";
    size_t name_len = strlen(name);
    size_t prefix_len = strlen(prefix);
    size_t suffix_len = strlen(suffix);
    size_t id_len = 0U;
    if (name_len <= prefix_len + suffix_len) {
        return false;
    }
    if (strncmp(name, prefix, prefix_len) != 0) {
        return false;
    }
    if (strcmp(name + name_len - suffix_len, suffix) != 0) {
        return false;
    }
    if (strstr(name, ".tmp") != NULL) {
        return false;
    }
    id_len = name_len - prefix_len - suffix_len;
    if (id_len + 1U > request_id_cap) {
        return false;
    }
    memcpy(request_id, name + prefix_len, id_len);
    request_id[id_len] = '\0';
    return is_safe_request_id(request_id);
}

static int process_one_request(const char *request_name, const char *request_id) {
    char claimed_path[384];
    char ready_path[384];
    char processed_ok_path[384];
    char processed_fail_path[384];
    char runner_cmd[512];
    int rc = 1;
    if (snprintf(ready_path, sizeof(ready_path), "%s/%s", OS4TB_INCOMING_DIR, request_name) <= 0 ||
        snprintf(claimed_path, sizeof(claimed_path), "%s/claimed_%s.req", OS4TB_INCOMING_DIR, request_id) <= 0 ||
        snprintf(
            processed_ok_path,
            sizeof(processed_ok_path),
            "%s/request_%s.req.done",
            OS4TB_PROCESSED_DIR,
            request_id) <= 0 ||
        snprintf(
            processed_fail_path,
            sizeof(processed_fail_path),
            "%s/request_%s.req.rejected",
            OS4TB_PROCESSED_DIR,
            request_id) <= 0) {
        return 1;
    }

    if (access(processed_ok_path, F_OK) == 0 || access(processed_fail_path, F_OK) == 0) {
        (void)rename(ready_path, processed_fail_path);
        return 1;
    }

    if (rename(ready_path, claimed_path) != 0) {
        return 1;
    }

    if (snprintf(runner_cmd, sizeof(runner_cmd), "%s claimed_%s.req", OS4TB_RUNNER_PATH, request_id) <= 0) {
        (void)rename(claimed_path, processed_fail_path);
        return 1;
    }

    rc = system(runner_cmd);
    if (rc == 0) {
        (void)rename(claimed_path, processed_ok_path);
    } else {
        (void)rename(claimed_path, processed_fail_path);
    }
    return rc;
}

int main(int argc, char **argv) {
    (void)argv;
    g_workbench_mode = is_workbench_launch(argc);
    agent_info("OS4TB_AGENT=STARTING");

    (void)signal(SIGINT, on_signal);
    (void)signal(SIGTERM, on_signal);

    if (access(OS4TB_INCOMING_DIR, R_OK | W_OK) != 0) {
        agent_errorf("incoming inaccessible", OS4TB_INCOMING_DIR);
        return 1;
    }
    if (access(OS4TB_PROCESSED_DIR, R_OK | W_OK) != 0) {
        agent_errorf("processed inaccessible", OS4TB_PROCESSED_DIR);
        return 1;
    }

    agent_info("OS4TB_AGENT=RUNNING");
    while (!g_stop) {
        DIR *dir = opendir(OS4TB_INCOMING_DIR);
        struct dirent *ent = NULL;
        if (dir == NULL) {
            sleep(OS4TB_POLL_INTERVAL_SECONDS);
            continue;
        }
        while (!g_stop && (ent = readdir(dir)) != NULL) {
            char request_id[80];
            if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) {
                continue;
            }
            if (!parse_request_filename(ent->d_name, request_id, sizeof(request_id))) {
                continue;
            }
            (void)process_one_request(ent->d_name, request_id);
        }
        closedir(dir);
        sleep(OS4TB_POLL_INTERVAL_SECONDS);
    }

    agent_info("OS4TB_AGENT=STOPPED");
    return 0;
}
