#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/build/phase2_bundle"
IMAGE="walkero/amigagccondocker:os4-gcc11"

mkdir -p "$BUNDLE_DIR"

docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$IMAGE" \
  sh -lc '
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_guest_runner.c -o build/phase2_bundle/os4tb_guest_runner -lauto &&
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_phase2_payload.c -o build/phase2_bundle/os4tb_phase2_payload -lauto
  '

cp "$ROOT/protocol/requests/request_phase2_001.req" "$BUNDLE_DIR/request_phase2_001.req"

echo "PHASE2_BUNDLE_READY=$BUNDLE_DIR"
