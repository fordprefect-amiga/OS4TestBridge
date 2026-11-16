#include <ctype.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define OS4TB_MAX_FILE_SIZE 4096L
#define OS4TB_MAX_LINE_LEN 256U
#define OS4TB_MAX_REQUEST_ID_LEN 64U
#define OS4TB_MAX_OPERATION_LEN 32U
#define OS4TB_MAX_BASENAME_LEN 128U

#define OS4TB_INCOMING_DIR "SAMDROP:incoming"
#define OS4TB_RESULTS_DIR "SAMDROP:results"
#define OS4TB_LOGS_DIR "SAMDROP:logs"

typedef enum ParseStatus {
    PARSE_OK = 0,
    PARSE_OPEN_FAILED,
    PARSE_FILE_TOO_LARGE,
    PARSE_LINE_TOO_LONG,
    PARSE_EMPTY_LINE,
    PARSE_MALFORMED_LINE,
    PARSE_EMPTY_VALUE,
    PARSE_INVALID_CHAR,
    PARSE_DUPLICATE_KEY,
    PARSE_UNKNOWN_KEY,
    PARSE_FORBIDDEN_FIELD,
    PARSE_MISSING_REQUIRED_KEY,
    PARSE_UNSUPPORTED_PROTOCOL_VERSION,
    PARSE_INVALID_REQUEST_ID,
    PARSE_INVALID_OPERATION_TOKEN,
    PARSE_UNSAFE_FILENAME
} ParseStatus;

typedef struct RequestV1 {
    char protocol_version[8];
    char request_id[OS4TB_MAX_REQUEST_ID_LEN + 1U];
    char operation[OS4TB_MAX_OPERATION_LEN + 1U];
    char payload_name[OS4TB_MAX_BASENAME_LEN + 1U];
    char expected_artifact_name[OS4TB_MAX_BASENAME_LEN + 1U];
} RequestV1;

typedef struct ResultV1 {
    char request_id[OS4TB_MAX_REQUEST_ID_LEN + 1U];
    char operation[OS4TB_MAX_OPERATION_LEN + 1U];
    char transport_status[32];
    char execution_status[32];
    int exit_code;
    char artifact_status[32];
    char artifact_name[OS4TB_MAX_BASENAME_LEN + 1U];
    bool has_artifact_name;
    char log_name[OS4TB_MAX_BASENAME_LEN + 1U];
    bool has_log_name;
    char detail[128];
} ResultV1;

static bool is_ascii_printable(char c) {
    unsigned char uc = (unsigned char)c;
    return uc >= 32U && uc <= 126U;
}

static bool is_safe_request_id(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > OS4TB_MAX_REQUEST_ID_LEN) {
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

static bool is_safe_operation_token(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > OS4TB_MAX_OPERATION_LEN) {
        return false;
    }
    for (i = 0U; i < len; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (!(isupper(c) || isdigit(c) || c == '_')) {
            return false;
        }
    }
    return true;
}

static bool is_safe_basename(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    if (len == 0U || len > OS4TB_MAX_BASENAME_LEN) {
        return false;
    }
    if (strcmp(s, ".") == 0 || strcmp(s, "..") == 0) {
        return false;
    }
    if (strstr(s, "..") != NULL) {
        return false;
    }
    for (i = 0U; i < len; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (!(isalnum(c) || c == '_' || c == '-' || c == '.')) {
            return false;
        }
    }
    return true;
}

static bool check_file_size(FILE *fp) {
    long size = 0L;
    if (fseek(fp, 0L, SEEK_END) != 0) {
        return false;
    }
    size = ftell(fp);
    if (size < 0L || size > OS4TB_MAX_FILE_SIZE) {
        return false;
    }
    return fseek(fp, 0L, SEEK_SET) == 0;
}

static bool copy_value(char *dst, size_t dst_cap, const char *value) {
    size_t len = strlen(value);
    if (len == 0U || len + 1U > dst_cap) {
        return false;
    }
    memcpy(dst, value, len + 1U);
    return true;
}

static bool line_is_printable(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    for (i = 0U; i < len; ++i) {
        if (!is_ascii_printable(s[i])) {
            return false;
        }
    }
    return true;
}

static ParseStatus parse_request_file(const char *request_path, RequestV1 *out) {
    enum RequestKeySeen {
        RK_PROTOCOL_VERSION = 1 << 0,
        RK_REQUEST_ID = 1 << 1,
        RK_OPERATION = 1 << 2,
        RK_PAYLOAD_NAME = 1 << 3,
        RK_EXPECTED_ARTIFACT_NAME = 1 << 4
    };
    unsigned int seen = 0U;
    char line[OS4TB_MAX_LINE_LEN + 3U];
    FILE *fp = fopen(request_path, "rb");
    if (fp == NULL) {
        return PARSE_OPEN_FAILED;
    }
    memset(out, 0, sizeof(*out));
    if (!check_file_size(fp)) {
        fclose(fp);
        return PARSE_FILE_TOO_LARGE;
    }
    while (fgets(line, (int)sizeof(line), fp) != NULL) {
        char *eq = NULL;
        char *key = NULL;
        char *value = NULL;
        size_t len = strlen(line);
        if (len == 0U) {
            fclose(fp);
            return PARSE_MALFORMED_LINE;
        }
        if (line[len - 1U] != '\n' && !feof(fp)) {
            fclose(fp);
            return PARSE_LINE_TOO_LONG;
        }
        if (line[len - 1U] == '\n') {
            line[--len] = '\0';
        }
        if (len > 0U && line[len - 1U] == '\r') {
            line[--len] = '\0';
        }
        if (len == 0U) {
            fclose(fp);
            return PARSE_EMPTY_LINE;
        }
        if (len > OS4TB_MAX_LINE_LEN) {
            fclose(fp);
            return PARSE_LINE_TOO_LONG;
        }
        if (!line_is_printable(line)) {
            fclose(fp);
            return PARSE_INVALID_CHAR;
        }
        eq = strchr(line, '=');
        if (eq == NULL || eq == line) {
            fclose(fp);
            return PARSE_MALFORMED_LINE;
        }
        *eq = '\0';
        key = line;
        value = eq + 1;
        if (*value == '\0') {
            fclose(fp);
            return PARSE_EMPTY_VALUE;
        }
        if (strcmp(key, "command") == 0 || strcmp(key, "shell") == 0 ||
            strcmp(key, "script") == 0) {
            fclose(fp);
            return PARSE_FORBIDDEN_FIELD;
        }
        if (strcmp(key, "protocol_version") == 0) {
            if ((seen & RK_PROTOCOL_VERSION) != 0U) {
                fclose(fp);
                return PARSE_DUPLICATE_KEY;
            }
            if (!copy_value(out->protocol_version, sizeof(out->protocol_version), value)) {
                fclose(fp);
                return PARSE_MALFORMED_LINE;
            }
            seen |= RK_PROTOCOL_VERSION;
        } else if (strcmp(key, "request_id") == 0) {
            if ((seen & RK_REQUEST_ID) != 0U) {
                fclose(fp);
                return PARSE_DUPLICATE_KEY;
            }
            if (!copy_value(out->request_id, sizeof(out->request_id), value)) {
                fclose(fp);
                return PARSE_MALFORMED_LINE;
            }
            seen |= RK_REQUEST_ID;
        } else if (strcmp(key, "operation") == 0) {
            if ((seen & RK_OPERATION) != 0U) {
                fclose(fp);
                return PARSE_DUPLICATE_KEY;
            }
            if (!copy_value(out->operation, sizeof(out->operation), value)) {
                fclose(fp);
                return PARSE_MALFORMED_LINE;
            }
            seen |= RK_OPERATION;
        } else if (strcmp(key, "payload_name") == 0) {
            if ((seen & RK_PAYLOAD_NAME) != 0U) {
                fclose(fp);
                return PARSE_DUPLICATE_KEY;
            }
            if (!copy_value(out->payload_name, sizeof(out->payload_name), value)) {
                fclose(fp);
                return PARSE_MALFORMED_LINE;
            }
            seen |= RK_PAYLOAD_NAME;
        } else if (strcmp(key, "expected_artifact_name") == 0) {
            if ((seen & RK_EXPECTED_ARTIFACT_NAME) != 0U) {
                fclose(fp);
                return PARSE_DUPLICATE_KEY;
            }
            if (!copy_value(
                    out->expected_artifact_name,
                    sizeof(out->expected_artifact_name),
                    value)) {
                fclose(fp);
                return PARSE_MALFORMED_LINE;
            }
            seen |= RK_EXPECTED_ARTIFACT_NAME;
        } else {
            fclose(fp);
            return PARSE_UNKNOWN_KEY;
        }
    }
    fclose(fp);
    if (seen != (RK_PROTOCOL_VERSION | RK_REQUEST_ID | RK_OPERATION | RK_PAYLOAD_NAME |
                 RK_EXPECTED_ARTIFACT_NAME)) {
        return PARSE_MISSING_REQUIRED_KEY;
    }
    if (strcmp(out->protocol_version, "1") != 0) {
        return PARSE_UNSUPPORTED_PROTOCOL_VERSION;
    }
    if (!is_safe_request_id(out->request_id)) {
        return PARSE_INVALID_REQUEST_ID;
    }
    if (!is_safe_operation_token(out->operation)) {
        return PARSE_INVALID_OPERATION_TOKEN;
    }
    if (!is_safe_basename(out->payload_name) || !is_safe_basename(out->expected_artifact_name)) {
        return PARSE_UNSAFE_FILENAME;
    }
    return PARSE_OK;
}

static const char *parse_status_token(ParseStatus status) {
    switch (status) {
        case PARSE_OK:
            return "ok";
        case PARSE_OPEN_FAILED:
            return "open_failed";
        case PARSE_FILE_TOO_LARGE:
            return "file_too_large";
        case PARSE_LINE_TOO_LONG:
            return "line_too_long";
        case PARSE_EMPTY_LINE:
            return "empty_line";
        case PARSE_MALFORMED_LINE:
            return "malformed_line";
        case PARSE_EMPTY_VALUE:
            return "empty_value";
        case PARSE_INVALID_CHAR:
            return "invalid_char";
        case PARSE_DUPLICATE_KEY:
            return "duplicate_key";
        case PARSE_UNKNOWN_KEY:
            return "unknown_key";
        case PARSE_FORBIDDEN_FIELD:
            return "forbidden_field";
        case PARSE_MISSING_REQUIRED_KEY:
            return "missing_required_key";
        case PARSE_UNSUPPORTED_PROTOCOL_VERSION:
            return "unsupported_protocol_version";
        case PARSE_INVALID_REQUEST_ID:
            return "invalid_request_id";
        case PARSE_INVALID_OPERATION_TOKEN:
            return "invalid_operation_token";
        case PARSE_UNSAFE_FILENAME:
            return "unsafe_filename";
        default:
            return "internal_error";
    }
}

static void init_result(ResultV1 *result, const char *request_id, const char *operation) {
    memset(result, 0, sizeof(*result));
    (void)snprintf(result->request_id, sizeof(result->request_id), "%s", request_id);
    (void)snprintf(result->operation, sizeof(result->operation), "%s", operation);
    (void)snprintf(result->transport_status, sizeof(result->transport_status), "ok");
    (void)snprintf(result->execution_status, sizeof(result->execution_status), "rejected");
    result->exit_code = 0;
    (void)snprintf(result->artifact_status, sizeof(result->artifact_status), "missing");
    (void)snprintf(result->detail, sizeof(result->detail), "not_started");
}

static bool write_text_file_atomic(const char *final_path, const char *content) {
    char tmp_path[320];
    FILE *fp = NULL;
    if (snprintf(tmp_path, sizeof(tmp_path), "%s.tmp", final_path) <= 0) {
        return false;
    }
    fp = fopen(tmp_path, "wb");
    if (fp == NULL) {
        return false;
    }
    if (fputs(content, fp) == EOF) {
        fclose(fp);
        (void)remove(tmp_path);
        return false;
    }
    if (fflush(fp) != 0) {
        fclose(fp);
        (void)remove(tmp_path);
        return false;
    }
    if (fclose(fp) != 0) {
        (void)remove(tmp_path);
        return false;
    }
    if (rename(tmp_path, final_path) != 0) {
        (void)remove(tmp_path);
        return false;
    }
    return true;
}

static bool file_exists_non_empty(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return false;
    }
    return st.st_size > 0;
}

int main(int argc, char **argv) {
    RequestV1 request;
    ResultV1 result;
    ParseStatus parse_status;
    char request_path[320];
    char payload_path[320];
    char result_path[320];
    char log_path[320];
    char result_buf[1024];
    char log_buf[512];
    char command_buf[320];
    int rc = 1;

    if (argc != 2) {
        fprintf(stderr, "usage: %s <request_filename>\n", argv[0]);
        return 2;
    }

    if (snprintf(request_path, sizeof(request_path), "%s/%s", OS4TB_INCOMING_DIR, argv[1]) <= 0) {
        fprintf(stderr, "request path build failed\n");
        return 2;
    }

    parse_status = parse_request_file(request_path, &request);
    if (parse_status != PARSE_OK) {
        const char *fallback_id = "phase2_invalid";
        init_result(&result, fallback_id, "RUN_BINARY");
        if (snprintf(result_path, sizeof(result_path), "%s/result_%s.res", OS4TB_RESULTS_DIR, fallback_id) >
            0) {
            (void)snprintf(result.detail, sizeof(result.detail), "%s", parse_status_token(parse_status));
            (void)snprintf(
                result_buf,
                sizeof(result_buf),
                "protocol_version=1\n"
                "request_id=%s\n"
                "operation=%s\n"
                "transport_status=%s\n"
                "execution_status=%s\n"
                "exit_code=%d\n"
                "artifact_status=%s\n"
                "detail=%s\n",
                result.request_id,
                result.operation,
                result.transport_status,
                result.execution_status,
                result.exit_code,
                result.artifact_status,
                result.detail);
            (void)write_text_file_atomic(result_path, result_buf);
        }
        fprintf(stderr, "request rejected: %s\n", parse_status_token(parse_status));
        return 1;
    }

    if (strcmp(request.operation, "RUN_BINARY") != 0) {
        fprintf(stderr, "unsupported operation\n");
        return 1;
    }

    init_result(&result, request.request_id, request.operation);
    (void)snprintf(result.artifact_name, sizeof(result.artifact_name), "%s", request.expected_artifact_name);
    result.has_artifact_name = true;
    (void)snprintf(result.log_name, sizeof(result.log_name), "log_%s.txt", request.request_id);
    result.has_log_name = true;
    (void)snprintf(result.detail, sizeof(result.detail), "running");

    if (snprintf(payload_path, sizeof(payload_path), "%s/%s", OS4TB_INCOMING_DIR, request.payload_name) <= 0 ||
        snprintf(result_path, sizeof(result_path), "%s/result_%s.res", OS4TB_RESULTS_DIR, request.request_id) <=
            0 ||
        snprintf(log_path, sizeof(log_path), "%s/log_%s.txt", OS4TB_LOGS_DIR, request.request_id) <= 0) {
        fprintf(stderr, "path build failed\n");
        return 1;
    }

    if (chdir(OS4TB_RESULTS_DIR) != 0) {
        (void)snprintf(result.transport_status, sizeof(result.transport_status), "internal_error");
        (void)snprintf(result.execution_status, sizeof(result.execution_status), "launch_failed");
        (void)snprintf(result.artifact_status, sizeof(result.artifact_status), "missing");
        (void)snprintf(result.detail, sizeof(result.detail), "results_dir_unavailable");
    } else {
        if (snprintf(command_buf, sizeof(command_buf), "%s %s", payload_path, request.expected_artifact_name) <= 0) {
            (void)snprintf(result.execution_status, sizeof(result.execution_status), "launch_failed");
            (void)snprintf(result.detail, sizeof(result.detail), "command_build_failed");
        } else {
            rc = system(command_buf);
            result.exit_code = rc;
            if (rc != 0) {
                (void)snprintf(result.execution_status, sizeof(result.execution_status), "child_failed");
                (void)snprintf(result.artifact_status, sizeof(result.artifact_status), "not_required");
                (void)snprintf(result.detail, sizeof(result.detail), "child_nonzero");
            } else if (!file_exists_non_empty(request.expected_artifact_name)) {
                (void)snprintf(result.execution_status, sizeof(result.execution_status), "success");
                (void)snprintf(result.artifact_status, sizeof(result.artifact_status), "missing");
                (void)snprintf(result.detail, sizeof(result.detail), "artifact_missing_or_empty");
            } else {
                (void)snprintf(result.execution_status, sizeof(result.execution_status), "success");
                (void)snprintf(result.artifact_status, sizeof(result.artifact_status), "present");
                (void)snprintf(result.detail, sizeof(result.detail), "ok");
            }
        }
    }

    (void)snprintf(
        result_buf,
        sizeof(result_buf),
        "protocol_version=1\n"
        "request_id=%s\n"
        "operation=%s\n"
        "transport_status=%s\n"
        "execution_status=%s\n"
        "exit_code=%d\n"
        "artifact_status=%s\n"
        "artifact_name=%s\n"
        "log_name=%s\n"
        "detail=%s\n",
        result.request_id,
        result.operation,
        result.transport_status,
        result.execution_status,
        result.exit_code,
        result.artifact_status,
        result.artifact_name,
        result.log_name,
        result.detail);
    if (!write_text_file_atomic(result_path, result_buf)) {
        fprintf(stderr, "failed writing result file\n");
        return 1;
    }

    (void)snprintf(
        log_buf,
        sizeof(log_buf),
        "request_id=%s\noperation=%s\nexecution_status=%s\nartifact_status=%s\nexit_code=%d\ndetail=%s\n",
        result.request_id,
        result.operation,
        result.execution_status,
        result.artifact_status,
        result.exit_code,
        result.detail);
    (void)write_text_file_atomic(log_path, log_buf);

    printf("OS4TB_GUEST_RUNNER_STATUS=%s\n", strcmp(result.artifact_status, "present") == 0 ? "PASS" : "FAIL");
    return (strcmp(result.execution_status, "success") == 0 && strcmp(result.artifact_status, "present") == 0) ? 0
                                                                                                                 : 1;
}
