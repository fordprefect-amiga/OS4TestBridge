import test from "node:test";
import assert from "node:assert/strict";
import {
  BOOTSTRAP_SOURCE_SEARCH_MAX_RESULTS,
  buildInitializedProjectManifestText,
  buildMissingTargetConfigStatusPresentation,
  buildTargetConfigStatusPresentation,
  classifyBootstrapSourceRelativePath,
  hasMixedBootstrapSources,
  normalizeBootstrapSourceSelection,
  toProjectRelativePath
} from "../src/projectBootstrap";

test("target config status presentation is clear for configured, unset, and missing", () => {
  const configured = buildTargetConfigStatusPresentation("/home/user/os4tb.local.sam460ex.conf");
  assert.equal(configured.label, "OS4TB: os4tb.local.sam460ex.conf");
  assert.match(configured.tooltip, /\/home\/user\/os4tb\.local\.sam460ex\.conf/);

  const unset = buildTargetConfigStatusPresentation("");
  assert.equal(unset.label, "OS4TB: No target config");

  const missing = buildMissingTargetConfigStatusPresentation("/tmp/missing.conf");
  assert.equal(missing.label, "OS4TB: Config unavailable");
  assert.match(missing.tooltip, /missing\.conf/);
});

test("bootstrap source classifier excludes unsafe and non-source paths", () => {
  assert.equal(classifyBootstrapSourceRelativePath("src/main.c"), "c");
  assert.equal(classifyBootstrapSourceRelativePath("asm/helper.s"), "asm");
  assert.equal(classifyBootstrapSourceRelativePath(".git/main.c"), "exclude");
  assert.equal(classifyBootstrapSourceRelativePath("node_modules/dep.c"), "exclude");
  assert.equal(classifyBootstrapSourceRelativePath("../escape.c"), "invalid");
  assert.equal(classifyBootstrapSourceRelativePath("src/helper.S"), "invalid");
});

test("bootstrap selection normalization is bounded, deterministic, and mixed-aware", () => {
  const normalized = normalizeBootstrapSourceSelection([
    "src/z_helper.s",
    "src/main.c",
    "src/main.c",
    "../bad.c",
    "node_modules/skip.c"
  ]);
  assert.deepEqual(
    normalized.map((entry) => entry.relativePath),
    ["src/main.c", "src/z_helper.s"]
  );
  assert.equal(hasMixedBootstrapSources(normalized), true);
});

test("bootstrap manifest uses relative source-only persistence with automatic absence semantics", () => {
  const manifest = buildInitializedProjectManifestText(normalizeBootstrapSourceSelection([
    "src/main.c",
    "src/helper.c"
  ]));
  assert.match(manifest, /^source=src\/helper\.c$/m);
  assert.match(manifest, /^source=src\/main\.c$/m);
  assert.doesNotMatch(manifest, /^toolchain=/m);
  assert.doesNotMatch(manifest, /^assembler=/m);
  assert.doesNotMatch(manifest, /\/home\//);
});

test("bootstrap manifest enforces bounded source count", () => {
  assert.throws(
    () => buildInitializedProjectManifestText(normalizeBootstrapSourceSelection(["main.c"])),
    /bootstrap_source_count_too_small/
  );
});

test("workspace file path conversion stays relative and rejects outside files", () => {
  assert.equal(toProjectRelativePath("/repo", "/repo/src/main.c"), "src/main.c");
  assert.equal(toProjectRelativePath("/repo", "/other/main.c"), undefined);
  assert.ok(BOOTSTRAP_SOURCE_SEARCH_MAX_RESULTS >= 64);
});
