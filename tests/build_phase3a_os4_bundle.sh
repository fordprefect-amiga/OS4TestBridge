#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_DIR="$ROOT/build/phase3a_bundle"
IMAGE="walkero/amigagccondocker:os4-gcc11"

mkdir -p "$BUNDLE_DIR"

docker run --rm \
  -v "$ROOT:/workspace" \
  -w /workspace \
  "$IMAGE" \
  sh -lc '
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_guest_runner.c -o build/phase3a_bundle/os4tb_guest_runner -lauto &&
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_guest_agent.c -o build/phase3a_bundle/os4tb_guest_agent -lauto &&
    ppc-amigaos-gcc -std=c11 -Wall -Wextra -Werror -mcrt=newlib \
      guest/os4tb_phase3a_payload.c -o build/phase3a_bundle/os4tb_phase3a_payload -lauto
  '

cp "$ROOT/protocol/requests/request_phase3a_001.req" "$BUNDLE_DIR/request_phase3a_001.req"

echo "PHASE3A_BUNDLE_READY=$BUNDLE_DIR"
