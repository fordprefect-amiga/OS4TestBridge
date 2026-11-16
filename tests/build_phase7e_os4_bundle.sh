#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/build/phase7e_bundle"
IMAGE="walkero/amigagccondocker:os4-gcc11"

rm -rf "$BUNDLE_DIR"
mkdir -p "$BUNDLE_DIR"

docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$IMAGE" \
  sh -lc '
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_gcc_project_build_run_adapter.c -o build/phase7e_bundle/os4tb_gcc_project_build_run_adapter -lauto
  '

cp "$ROOT/protocol/requests/request_phase7e_001.req" "$BUNDLE_DIR/request_phase7e_001.req"
cp "$ROOT/guest/fixtures/gcc_project_build_run/main.c" "$BUNDLE_DIR/main.c"
cp "$ROOT/guest/fixtures/gcc_project_build_run/helper.c" "$BUNDLE_DIR/helper.c"
cp "$ROOT/guest/fixtures/gcc_project_build_run/helper_error.c" "$BUNDLE_DIR/helper_error.c"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/clean_three" "$BUNDLE_DIR/clean_three"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/middle_error" "$BUNDLE_DIR/middle_error"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/header_clean" "$BUNDLE_DIR/header_clean"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/header_error" "$BUNDLE_DIR/header_error"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/tree_clean" "$BUNDLE_DIR/tree_clean"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/tree_header_error" "$BUNDLE_DIR/tree_header_error"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/defines_clean" "$BUNDLE_DIR/defines_clean"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/defines_missing" "$BUNDLE_DIR/defines_missing"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/defines_wrong_value" "$BUNDLE_DIR/defines_wrong_value"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/libraries_clean" "$BUNDLE_DIR/libraries_clean"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/library_required_missing" "$BUNDLE_DIR/library_required_missing"
cp -R "$ROOT/guest/fixtures/gcc_project_manifest/library_missing" "$BUNDLE_DIR/library_missing"

test -f "$BUNDLE_DIR/clean_three/.os4tb-project"
test -f "$BUNDLE_DIR/clean_three/main.c"
test -f "$BUNDLE_DIR/clean_three/math.c"
test -f "$BUNDLE_DIR/clean_three/expected.c"

test -f "$BUNDLE_DIR/middle_error/.os4tb-project"
test -f "$BUNDLE_DIR/middle_error/main.c"
test -f "$BUNDLE_DIR/middle_error/math.c"
test -f "$BUNDLE_DIR/middle_error/expected.c"

test -f "$BUNDLE_DIR/header_clean/.os4tb-project"
test -f "$BUNDLE_DIR/header_clean/main.c"
test -f "$BUNDLE_DIR/header_clean/math.c"
test -f "$BUNDLE_DIR/header_clean/expected.c"
test -f "$BUNDLE_DIR/header_clean/project.h"

test -f "$BUNDLE_DIR/header_error/.os4tb-project"
test -f "$BUNDLE_DIR/header_error/main.c"
test -f "$BUNDLE_DIR/header_error/math.c"
test -f "$BUNDLE_DIR/header_error/expected.c"
test -f "$BUNDLE_DIR/header_error/project.h"

test -f "$BUNDLE_DIR/tree_clean/.os4tb-project"
test -f "$BUNDLE_DIR/tree_clean/src/main.c"
test -f "$BUNDLE_DIR/tree_clean/src/math.c"
test -f "$BUNDLE_DIR/tree_clean/src/expected.c"
test -f "$BUNDLE_DIR/tree_clean/include/values.h"

test -f "$BUNDLE_DIR/tree_header_error/.os4tb-project"
test -f "$BUNDLE_DIR/tree_header_error/src/main.c"
test -f "$BUNDLE_DIR/tree_header_error/src/math.c"
test -f "$BUNDLE_DIR/tree_header_error/src/expected.c"
test -f "$BUNDLE_DIR/tree_header_error/include/values.h"

test -f "$BUNDLE_DIR/defines_clean/.os4tb-project"
test -f "$BUNDLE_DIR/defines_clean/src/main.c"
test -f "$BUNDLE_DIR/defines_clean/src/helper.c"
test -f "$BUNDLE_DIR/defines_clean/include/config.h"

test -f "$BUNDLE_DIR/defines_missing/.os4tb-project"
test -f "$BUNDLE_DIR/defines_missing/src/main.c"
test -f "$BUNDLE_DIR/defines_missing/src/helper.c"
test -f "$BUNDLE_DIR/defines_missing/include/config.h"

test -f "$BUNDLE_DIR/defines_wrong_value/.os4tb-project"
test -f "$BUNDLE_DIR/defines_wrong_value/src/main.c"
test -f "$BUNDLE_DIR/defines_wrong_value/src/helper.c"
test -f "$BUNDLE_DIR/defines_wrong_value/include/config.h"

test -f "$BUNDLE_DIR/libraries_clean/.os4tb-project"
test -f "$BUNDLE_DIR/libraries_clean/src/main.c"
test -f "$BUNDLE_DIR/libraries_clean/src/helper.c"

test -f "$BUNDLE_DIR/library_required_missing/.os4tb-project"
test -f "$BUNDLE_DIR/library_required_missing/src/main.c"
test -f "$BUNDLE_DIR/library_required_missing/src/helper.c"

test -f "$BUNDLE_DIR/library_missing/.os4tb-project"
test -f "$BUNDLE_DIR/library_missing/src/main.c"
test -f "$BUNDLE_DIR/library_missing/src/helper.c"

echo "PHASE7E_BUNDLE_READY=$BUNDLE_DIR"
