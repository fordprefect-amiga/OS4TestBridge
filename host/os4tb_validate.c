#include <ctype.h>
#include <limits.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#define OS4TB_MAX_FILE_SIZE 4096L
#define OS4TB_MAX_LINE_LEN 256U
#define OS4TB_MAX_REQUEST_ID_LEN 64U
#define OS4TB_MAX_OPERATION_LEN 32U
#define OS4TB_MAX_BASENAME_LEN 128U
#define OS4TB_MAX_DETAIL_LEN 128U

typedef struct ParsedRequest {
    char protocol_version[8];
    char request_id[OS4TB_MAX_REQUEST_ID_LEN + 1U];
    char operation[OS4TB_MAX_OPERATION_LEN + 1U];
    char payload_name[OS4TB_MAX_BASENAME_LEN + 1U];
    char expected_artifact_name[OS4TB_MAX_BASENAME_LEN + 1U];
} ParsedRequest;

typedef struct ParsedResult {
    char protocol_version[8];
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
    char detail[OS4TB_MAX_DETAIL_LEN + 1U];
    bool has_detail;
} ParsedResult;

typedef struct ParseOutcome {
    bool ok;
    const char *reason;
} ParseOutcome;

static bool is_ascii_printable(char c) {
    unsigned char uc = (unsigned char)c;
    return uc >= 32U && uc <= 126U;
}

static const char *path_basename(const char *path) {
    const char *slash = strrchr(path, '/');
    return (slash == NULL) ? path : (slash + 1);
}

static bool path_dirname(const char *path, char *out, size_t out_cap) {
    const char *slash = strrchr(path, '/');
    size_t len = 0U;
    if (slash == NULL) {
        if (out_cap < 2U) {
            return false;
        }
        out[0] = '.';
        out[1] = '\0';
        return true;
    }
    len = (size_t)(slash - path);
    if (len + 1U > out_cap) {
        return false;
    }
    memcpy(out, path, len);
    out[len] = '\0';
    return true;
}

static bool file_exists_non_empty(const char *path) {
    struct stat st;
    if (stat(path, &st) != 0) {
        return false;
    }
    return st.st_size > 0;
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
    if ((strcmp(s, ".") == 0) || (strcmp(s, "..") == 0)) {
        return false;
    }
    for (i = 0U; i < len; ++i) {
        unsigned char c = (unsigned char)s[i];
        if (!(isalnum(c) || c == '_' || c == '-' || c == '.')) {
            return false;
        }
    }
    if (strstr(s, "..") != NULL) {
        return false;
    }
    return true;
}

static bool is_expected_request_filename(const char *basename, const char *request_id) {
    char expected_ready[160];
    char expected_claimed[160];
    if (!is_safe_basename(basename)) {
        return false;
    }
    if (strcmp(basename, "request.req") == 0) {
        return true;
    }
    (void)snprintf(expected_ready, sizeof(expected_ready), "request_%s.req", request_id);
    (void)snprintf(expected_claimed, sizeof(expected_claimed), "claimed_%s.req", request_id);
    return strcmp(basename, expected_ready) == 0 || strcmp(basename, expected_claimed) == 0;
}

static bool is_expected_result_filename(const char *basename, const char *request_id) {
    char expected_result[160];
    if (!is_safe_basename(basename)) {
        return false;
    }
    if (strcmp(basename, "result.res") == 0) {
        return true;
    }
    (void)snprintf(expected_result, sizeof(expected_result), "result_%s.res", request_id);
    return strcmp(basename, expected_result) == 0;
}

static bool is_allowed_transport_status(const char *s) {
    return (strcmp(s, "ok") == 0) || (strcmp(s, "not_applicable") == 0) ||
           (strcmp(s, "internal_error") == 0);
}

static bool is_allowed_execution_status(const char *s) {
    return (strcmp(s, "not_started") == 0) || (strcmp(s, "success") == 0) ||
           (strcmp(s, "child_failed") == 0) || (strcmp(s, "launch_failed") == 0) ||
           (strcmp(s, "rejected") == 0) || (strcmp(s, "internal_error") == 0);
}

static bool is_allowed_artifact_status(const char *s) {
    return (strcmp(s, "not_required") == 0) || (strcmp(s, "present") == 0) ||
           (strcmp(s, "missing") == 0) || (strcmp(s, "invalid") == 0);
}

static bool str_to_int(const char *s, int *out) {
    char *endptr = NULL;
    long value = 0L;
    if (s == NULL || *s == '\0') {
        return false;
    }
    value = strtol(s, &endptr, 10);
    if (*endptr != '\0') {
        return false;
    }
    if (value < INT_MIN || value > INT_MAX) {
        return false;
    }
    *out = (int)value;
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

static bool line_has_only_printable(const char *s) {
    size_t i = 0U;
    size_t len = strlen(s);
    for (i = 0U; i < len; ++i) {
        if (!is_ascii_printable(s[i])) {
            return false;
        }
    }
    return true;
}

static ParseOutcome parse_request_file(const char *path, ParsedRequest *out) {
    enum RequestKeySeen {
        RK_PROTOCOL_VERSION = 1 << 0,
        RK_REQUEST_ID = 1 << 1,
        RK_OPERATION = 1 << 2,
        RK_PAYLOAD_NAME = 1 << 3,
        RK_EXPECTED_ARTIFACT_NAME = 1 << 4
    };
    unsigned int seen = 0U;
    char line[OS4TB_MAX_LINE_LEN + 3U];
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return (ParseOutcome){false, "open_failed"};
    }
    if (!check_file_size(fp)) {
        fclose(fp);
        return (ParseOutcome){false, "file_too_large"};
    }
    while (fgets(line, (int)sizeof(line), fp) != NULL) {
        char *eq = NULL;
        char *key = NULL;
        char *value = NULL;
        size_t len = strlen(line);
        if (len == 0U) {
            fclose(fp);
            return (ParseOutcome){false, "malformed_line"};
        }
        if (line[len - 1U] != '\n' && !feof(fp)) {
            fclose(fp);
            return (ParseOutcome){false, "line_too_long"};
        }
        if (line[len - 1U] == '\n') {
            line[--len] = '\0';
        }
        if (len > 0U && line[len - 1U] == '\r') {
            line[--len] = '\0';
        }
        if (len == 0U) {
            fclose(fp);
            return (ParseOutcome){false, "empty_line"};
        }
        if (len > OS4TB_MAX_LINE_LEN) {
            fclose(fp);
            return (ParseOutcome){false, "line_too_long"};
        }
        if (!line_has_only_printable(line)) {
            fclose(fp);
            return (ParseOutcome){false, "invalid_char"};
        }
        eq = strchr(line, '=');
        if (eq == NULL || eq == line) {
            fclose(fp);
            return (ParseOutcome){false, "malformed_line"};
        }
        *eq = '\0';
        key = line;
        value = eq + 1;
        if (*value == '\0') {
            fclose(fp);
            return (ParseOutcome){false, "empty_value"};
        }
        if (strcmp(key, "command") == 0 || strcmp(key, "shell") == 0 ||
            strcmp(key, "script") == 0) {
            fclose(fp);
            return (ParseOutcome){false, "forbidden_field"};
        }
        if (strcmp(key, "protocol_version") == 0) {
            if ((seen & RK_PROTOCOL_VERSION) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->protocol_version, sizeof(out->protocol_version), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RK_PROTOCOL_VERSION;
        } else if (strcmp(key, "request_id") == 0) {
            if ((seen & RK_REQUEST_ID) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->request_id, sizeof(out->request_id), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RK_REQUEST_ID;
        } else if (strcmp(key, "operation") == 0) {
            if ((seen & RK_OPERATION) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->operation, sizeof(out->operation), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RK_OPERATION;
        } else if (strcmp(key, "payload_name") == 0) {
            if ((seen & RK_PAYLOAD_NAME) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->payload_name, sizeof(out->payload_name), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RK_PAYLOAD_NAME;
        } else if (strcmp(key, "expected_artifact_name") == 0) {
            if ((seen & RK_EXPECTED_ARTIFACT_NAME) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(
                    out->expected_artifact_name,
                    sizeof(out->expected_artifact_name),
                    value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RK_EXPECTED_ARTIFACT_NAME;
        } else {
            fclose(fp);
            return (ParseOutcome){false, "unknown_key"};
        }
    }
    fclose(fp);
    if (seen != (RK_PROTOCOL_VERSION | RK_REQUEST_ID | RK_OPERATION | RK_PAYLOAD_NAME |
                 RK_EXPECTED_ARTIFACT_NAME)) {
        return (ParseOutcome){false, "missing_required_key"};
    }
    if (strcmp(out->protocol_version, "1") != 0) {
        return (ParseOutcome){false, "unsupported_protocol_version"};
    }
    if (!is_safe_request_id(out->request_id)) {
        return (ParseOutcome){false, "invalid_request_id"};
    }
    if (!is_safe_operation_token(out->operation)) {
        return (ParseOutcome){false, "invalid_operation_token"};
    }
    if (!is_safe_basename(out->payload_name) || !is_safe_basename(out->expected_artifact_name)) {
        return (ParseOutcome){false, "unsafe_filename"};
    }
    return (ParseOutcome){true, "none"};
}

static ParseOutcome parse_result_file(const char *path, ParsedResult *out) {
    enum ResultKeySeen {
        RS_PROTOCOL_VERSION = 1 << 0,
        RS_REQUEST_ID = 1 << 1,
        RS_OPERATION = 1 << 2,
        RS_TRANSPORT_STATUS = 1 << 3,
        RS_EXECUTION_STATUS = 1 << 4,
        RS_EXIT_CODE = 1 << 5,
        RS_ARTIFACT_STATUS = 1 << 6,
        RS_ARTIFACT_NAME = 1 << 7,
        RS_LOG_NAME = 1 << 8,
        RS_DETAIL = 1 << 9
    };
    unsigned int seen = 0U;
    char line[OS4TB_MAX_LINE_LEN + 3U];
    FILE *fp = fopen(path, "rb");
    if (fp == NULL) {
        return (ParseOutcome){false, "open_failed"};
    }
    memset(out, 0, sizeof(*out));
    if (!check_file_size(fp)) {
        fclose(fp);
        return (ParseOutcome){false, "file_too_large"};
    }
    while (fgets(line, (int)sizeof(line), fp) != NULL) {
        char *eq = NULL;
        char *key = NULL;
        char *value = NULL;
        size_t len = strlen(line);
        if (len == 0U) {
            fclose(fp);
            return (ParseOutcome){false, "malformed_line"};
        }
        if (line[len - 1U] != '\n' && !feof(fp)) {
            fclose(fp);
            return (ParseOutcome){false, "line_too_long"};
        }
        if (line[len - 1U] == '\n') {
            line[--len] = '\0';
        }
        if (len > 0U && line[len - 1U] == '\r') {
            line[--len] = '\0';
        }
        if (len == 0U) {
            fclose(fp);
            return (ParseOutcome){false, "empty_line"};
        }
        if (len > OS4TB_MAX_LINE_LEN) {
            fclose(fp);
            return (ParseOutcome){false, "line_too_long"};
        }
        if (!line_has_only_printable(line)) {
            fclose(fp);
            return (ParseOutcome){false, "invalid_char"};
        }
        eq = strchr(line, '=');
        if (eq == NULL || eq == line) {
            fclose(fp);
            return (ParseOutcome){false, "malformed_line"};
        }
        *eq = '\0';
        key = line;
        value = eq + 1;
        if (*value == '\0') {
            fclose(fp);
            return (ParseOutcome){false, "empty_value"};
        }
        if (strcmp(key, "command") == 0 || strcmp(key, "shell") == 0 ||
            strcmp(key, "script") == 0) {
            fclose(fp);
            return (ParseOutcome){false, "forbidden_field"};
        }
        if (strcmp(key, "protocol_version") == 0) {
            if ((seen & RS_PROTOCOL_VERSION) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->protocol_version, sizeof(out->protocol_version), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_PROTOCOL_VERSION;
        } else if (strcmp(key, "request_id") == 0) {
            if ((seen & RS_REQUEST_ID) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->request_id, sizeof(out->request_id), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_REQUEST_ID;
        } else if (strcmp(key, "operation") == 0) {
            if ((seen & RS_OPERATION) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->operation, sizeof(out->operation), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_OPERATION;
        } else if (strcmp(key, "transport_status") == 0) {
            if ((seen & RS_TRANSPORT_STATUS) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->transport_status, sizeof(out->transport_status), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_TRANSPORT_STATUS;
        } else if (strcmp(key, "execution_status") == 0) {
            if ((seen & RS_EXECUTION_STATUS) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->execution_status, sizeof(out->execution_status), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_EXECUTION_STATUS;
        } else if (strcmp(key, "exit_code") == 0) {
            if ((seen & RS_EXIT_CODE) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!str_to_int(value, &out->exit_code)) {
                fclose(fp);
                return (ParseOutcome){false, "invalid_exit_code"};
            }
            seen |= RS_EXIT_CODE;
        } else if (strcmp(key, "artifact_status") == 0) {
            if ((seen & RS_ARTIFACT_STATUS) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->artifact_status, sizeof(out->artifact_status), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            seen |= RS_ARTIFACT_STATUS;
        } else if (strcmp(key, "artifact_name") == 0) {
            if ((seen & RS_ARTIFACT_NAME) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->artifact_name, sizeof(out->artifact_name), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            out->has_artifact_name = true;
            seen |= RS_ARTIFACT_NAME;
        } else if (strcmp(key, "log_name") == 0) {
            if ((seen & RS_LOG_NAME) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->log_name, sizeof(out->log_name), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            out->has_log_name = true;
            seen |= RS_LOG_NAME;
        } else if (strcmp(key, "detail") == 0) {
            if ((seen & RS_DETAIL) != 0U) {
                fclose(fp);
                return (ParseOutcome){false, "duplicate_key"};
            }
            if (!copy_value(out->detail, sizeof(out->detail), value)) {
                fclose(fp);
                return (ParseOutcome){false, "value_too_long"};
            }
            out->has_detail = true;
            seen |= RS_DETAIL;
        } else {
            fclose(fp);
            return (ParseOutcome){false, "unknown_key"};
        }
    }
    fclose(fp);
    if ((seen & (RS_PROTOCOL_VERSION | RS_REQUEST_ID | RS_OPERATION | RS_TRANSPORT_STATUS |
                 RS_EXECUTION_STATUS | RS_EXIT_CODE | RS_ARTIFACT_STATUS)) !=
        (RS_PROTOCOL_VERSION | RS_REQUEST_ID | RS_OPERATION | RS_TRANSPORT_STATUS |
         RS_EXECUTION_STATUS | RS_EXIT_CODE | RS_ARTIFACT_STATUS)) {
        return (ParseOutcome){false, "missing_required_key"};
    }
    if (strcmp(out->protocol_version, "1") != 0) {
        return (ParseOutcome){false, "unsupported_protocol_version"};
    }
    if (!is_safe_request_id(out->request_id)) {
        return (ParseOutcome){false, "invalid_request_id"};
    }
    if (!is_safe_operation_token(out->operation)) {
        return (ParseOutcome){false, "invalid_operation_token"};
    }
    if (!is_allowed_transport_status(out->transport_status)) {
        return (ParseOutcome){false, "invalid_transport_status"};
    }
    if (!is_allowed_execution_status(out->execution_status)) {
        return (ParseOutcome){false, "invalid_execution_status"};
    }
    if (!is_allowed_artifact_status(out->artifact_status)) {
        return (ParseOutcome){false, "invalid_artifact_status"};
    }
    if (out->has_artifact_name && !is_safe_basename(out->artifact_name)) {
        return (ParseOutcome){false, "unsafe_filename"};
    }
    if (out->has_log_name && !is_safe_basename(out->log_name)) {
        return (ParseOutcome){false, "unsafe_filename"};
    }
    if (out->has_detail && strlen(out->detail) > OS4TB_MAX_DETAIL_LEN) {
        return (ParseOutcome){false, "value_too_long"};
    }
    return (ParseOutcome){true, "none"};
}

static void print_token(const char *key, const char *value) {
    printf("%s=%s\n", key, value);
}

int main(int argc, char **argv) {
    ParsedRequest request;
    ParsedResult result;
    ParseOutcome request_parse;
    ParseOutcome result_parse;
    const char *reason = "none";
    bool request_ok = false;
    bool result_ok = false;
    bool correlation_ok = false;
    bool execution_ok = false;
    bool artifact_ok = false;
    bool final_ok = false;
    const char *request_path = NULL;
    const char *result_path = NULL;
    char expected_log_name[160];
    char result_dir[512];
    char expected_artifact_path[768];

    memset(&request, 0, sizeof(request));
    memset(&result, 0, sizeof(result));

    if (argc == 3 && strcmp(argv[1], "--check-request") == 0) {
        request_parse = parse_request_file(argv[2], &request);
        request_ok = request_parse.ok;
        print_token("OS4TB_REQUEST_PARSE", request_ok ? "PASS" : "FAIL");
        print_token("OS4TB_REQUEST_ONLY", request_ok ? "PASS" : "FAIL");
        if (!request_ok) {
            print_token("OS4TB_FAILURE_REASON", request_parse.reason);
        }
        return request_ok ? 0 : 1;
    }

    if (argc != 3) {
        fprintf(stderr, "usage: %s <request_file> <result_file>\n", argv[0]);
        fprintf(stderr, "   or: %s --check-request <request_file>\n", argv[0]);
        return 2;
    }

    request_path = argv[1];
    result_path = argv[2];

    request_parse = parse_request_file(request_path, &request);
    request_ok = request_parse.ok;
    if (!request_ok) {
        reason = request_parse.reason;
    }

    result_parse = parse_result_file(result_path, &result);
    result_ok = result_parse.ok;
    if (request_ok && !result_ok) {
        reason = result_parse.reason;
    }

    if (request_ok && result_ok) {
        (void)snprintf(
            expected_log_name, sizeof(expected_log_name), "log_%s.txt", request.request_id);

        if (!is_expected_request_filename(path_basename(request_path), request.request_id)) {
            reason = "request_filename_mismatch";
        } else if (!is_expected_result_filename(path_basename(result_path), request.request_id)) {
            reason = "result_filename_mismatch";
        } else if (strcmp(request.request_id, result.request_id) != 0) {
            reason = "request_id_mismatch";
        } else if (strcmp(request.operation, result.operation) != 0) {
            reason = "operation_mismatch";
        } else if (result.has_log_name && strcmp(result.log_name, expected_log_name) != 0) {
            reason = "log_name_mismatch";
        } else {
            correlation_ok = true;
        }
    }

    if (request_ok && result_ok && correlation_ok) {
        if (strcmp(request.operation, "RUN_BINARY") != 0) {
            reason = "unsupported_operation";
        } else if (strcmp(result.transport_status, "ok") != 0) {
            reason = "transport_not_ok";
        } else if (strcmp(result.execution_status, "success") != 0) {
            reason = "execution_not_success";
        } else if (result.exit_code != 0) {
            reason = "execution_exit_nonzero";
        } else {
            execution_ok = true;
        }
    }

    if (request_ok && result_ok && correlation_ok && execution_ok) {
        if (strcmp(result.artifact_status, "present") != 0) {
            reason = "artifact_not_present";
        } else if (!result.has_artifact_name) {
            reason = "artifact_name_missing";
        } else if (strcmp(result.artifact_name, request.expected_artifact_name) != 0) {
            reason = "artifact_name_mismatch";
        } else if (
            !path_dirname(result_path, result_dir, sizeof(result_dir)) ||
            snprintf(
                expected_artifact_path,
                sizeof(expected_artifact_path),
                "%s/%s",
                result_dir,
                result.artifact_name) <= 0 ||
            !file_exists_non_empty(expected_artifact_path)) {
            reason = "artifact_file_missing_or_empty";
        } else {
            artifact_ok = true;
        }
    }

    final_ok = request_ok && result_ok && correlation_ok && execution_ok && artifact_ok;

    print_token("OS4TB_REQUEST_PARSE", request_ok ? "PASS" : "FAIL");
    print_token("OS4TB_RESULT_PARSE", result_ok ? "PASS" : "FAIL");
    print_token("OS4TB_CORRELATION", correlation_ok ? "PASS" : "FAIL");
    print_token("OS4TB_EXECUTION", execution_ok ? "PASS" : "FAIL");
    print_token("OS4TB_ARTIFACT", artifact_ok ? "PASS" : "FAIL");
    print_token("OS4TB_FINAL", final_ok ? "PASS" : "FAIL");
    if (!final_ok) {
        print_token("OS4TB_FAILURE_REASON", reason);
    }

    return final_ok ? 0 : 1;
}
