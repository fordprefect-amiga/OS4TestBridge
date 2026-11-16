#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <release-root>" >&2
  exit 64
fi

release_root="$1"
if [[ ! -d "$release_root" ]]; then
  echo "Release root not found: $release_root" >&2
  exit 65
fi

version_file="$release_root/os4/OS4TestBridge/VERSION"
if [[ ! -f "$version_file" ]]; then
  echo "Missing guest version file: $version_file" >&2
  exit 66
fi
version="$(tr -d '\r\n' < "$version_file")"
if [[ -z "$version" ]]; then
  echo "Guest version is empty in: $version_file" >&2
  exit 67
fi

expected_name="OS4TestBridge_OS4_${version}.lha"
archives_dir="$release_root/archives"
archive_path="$archives_dir/$expected_name"

if [[ ! -d "$archives_dir" ]]; then
  echo "Missing archives directory: $archives_dir" >&2
  exit 68
fi

if [[ ! -f "$archive_path" ]]; then
  echo "Missing expected OS4 native archive: $archive_path" >&2
  echo "Expected filename: $expected_name" >&2
  exit 69
fi

if find "$archives_dir" -maxdepth 1 -type f -name 'OS4TestBridge_OS4_*.lha' ! -name "$expected_name" | grep -q .; then
  echo "Unexpected OS4 archive filename found in $archives_dir; only $expected_name is allowed." >&2
  exit 70
fi

sha_file="$release_root/SHA256SUMS"
manifest_file="$release_root/RELEASE_MANIFEST.txt"
archive_rel="archives/$expected_name"

tmp_sha="$(mktemp)"
tmp_manifest="$(mktemp)"
cleanup() {
  rm -f "$tmp_sha" "$tmp_manifest"
}
trap cleanup EXIT

if [[ -f "$sha_file" ]]; then
  grep -Ev "  (archives/$expected_name|$archive_path)$" "$sha_file" > "$tmp_sha" || true
else
  : > "$tmp_sha"
fi
(
  cd "$release_root"
  sha256sum "$archive_rel" >> "$tmp_sha"
)
mv "$tmp_sha" "$sha_file"

if [[ -f "$manifest_file" ]]; then
  cp "$manifest_file" "$tmp_manifest"
else
  : > "$tmp_manifest"
fi
if ! grep -Fq -- "$archive_rel" "$tmp_manifest"; then
  cat >> "$tmp_manifest" <<EOF
- $archive_rel
  Role: native AmigaOS guest archive (.lha)
EOF
fi
mv "$tmp_manifest" "$manifest_file"

echo "OS4_LHA_FINALIZED=YES"
echo "OS4_LHA_ARCHIVE=$archive_path"
echo "OS4_LHA_SHA256_FILE=$sha_file"
echo "OS4_LHA_MANIFEST_FILE=$manifest_file"
