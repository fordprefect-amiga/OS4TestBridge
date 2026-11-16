#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/build/phase7d_bundle"
IMAGE="walkero/amigagccondocker:os4-gcc11"

mkdir -p "$BUNDLE_DIR"

docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$IMAGE" \
  sh -lc '
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_gcc_build_run_adapter.c -o build/phase7d_bundle/os4tb_gcc_build_run_adapter -lauto
  '

cp "$ROOT/protocol/requests/request_phase7d_001.req" "$BUNDLE_DIR/request_phase7d_001.req"
cp "$ROOT/guest/fixtures/gcc_build_run/clean_run_success.c" "$BUNDLE_DIR/clean_run_success.c"
cp "$ROOT/guest/fixtures/gcc_build_run/nonzero_run.c" "$BUNDLE_DIR/nonzero_run.c"
cp "$ROOT/guest/fixtures/gcc_build_run/syntax_error.c" "$BUNDLE_DIR/syntax_error.c"

echo "PHASE7D_BUNDLE_READY=$BUNDLE_DIR"

