#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
    const char *artifact_name = "phase3a_001.artifact";
    FILE *fp = NULL;

    if (argc >= 2 && argv[1] != NULL && strlen(argv[1]) > 0U) {
        artifact_name = argv[1];
    }

    fp = fopen(artifact_name, "wb");
    if (fp == NULL) {
        return 2;
    }
    if (fputs("OS4TB_PHASE3A_OK\n", fp) == EOF) {
        fclose(fp);
        return 3;
    }
    if (fclose(fp) != 0) {
        return 4;
    }
    return 0;
}
