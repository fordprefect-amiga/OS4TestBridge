#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/build/phase7c_bundle"
IMAGE="walkero/amigagccondocker:os4-gcc11"

mkdir -p "$BUNDLE_DIR"

docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$IMAGE" \
  sh -lc '
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_gcc_compile_adapter.c -o build/phase7c_bundle/os4tb_gcc_compile_adapter -lauto
  '

cp "$ROOT/protocol/requests/request_phase7c_001.req" "$BUNDLE_DIR/request_phase7c_001.req"
cp "$ROOT/guest/fixtures/gcc_compile/clean_hello.c" "$BUNDLE_DIR/clean_hello.c"
cp "$ROOT/guest/fixtures/gcc_compile/warning_unused_variable.c" "$BUNDLE_DIR/warning_unused_variable.c"
cp "$ROOT/guest/fixtures/gcc_compile/error_missing_semicolon.c" "$BUNDLE_DIR/error_missing_semicolon.c"

echo "PHASE7C_BUNDLE_READY=$BUNDLE_DIR"

