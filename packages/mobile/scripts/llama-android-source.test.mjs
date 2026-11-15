import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { release } from "./llama-android-release.mjs"
import { inspect, libraries, options, profile, validate, validateCache } from "./llama-android-source.mjs"

const hash = "a".repeat(64)
const actual = Object.fromEntries(libraries.map((name) => [name, hash]))
const manifest = () => ({ profile, revision: release.revision, options: { ...options }, clean_source: true,
  ndk_revision: "27.0.12077973", opencl_library_sha256: hash, opencl_headers_sha256: hash,
  cache_sha256: hash, libraries: { ...actual } })

test("source profile explicitly targets OpenCL 2.0 without unavailable accelerators", () => {
  assert.equal(options.GGML_OPENCL_TARGET_VERSION, "200")
  assert.equal(options.GGML_OPENCL, "ON")
  assert.equal(options.GGML_HEXAGON, "OFF")
  assert.equal(options.GGML_VULKAN, "OFF")
  assert.ok(libraries.includes("libggml-opencl.so"))
  assert.ok(libraries.includes("libc++_shared.so"))
  assert.equal(libraries.length, 10)
  assert.doesNotThrow(() => validate(manifest(), release.revision, actual))
})

test("provenance rejects wrong source, dirty source, options, inputs and changed ELF", () => {
  for (const mutate of [
    (m) => { m.revision = "b".repeat(40) },
    (m) => { m.clean_source = false },
    (m) => { m.options.GGML_OPENCL_TARGET_VERSION = "300" },
    (m) => { m.options.extra = "untracked flag" },
    (m) => { m.opencl_library_sha256 = "missing" },
    (m) => { m.libraries["libggml-opencl.so"] = "b".repeat(64) },
    (m) => { delete m.libraries["libllama-server-impl.so"] },
  ]) {
    const m = manifest()
    mutate(m)
    assert.throws(() => validate(m, release.revision, actual))
  }
})

test("CMake cache validates effective flags and source rather than command intent", () => {
  const source = resolve("fixture-source")
  const text = [...Object.entries(options).map(([key, value]) => `${key}:STRING=${value}`),
    `CMAKE_HOME_DIRECTORY:INTERNAL=${source}`].join("\n")
  assert.equal(validateCache(text, source).GGML_OPENCL_TARGET_VERSION, "200")
  assert.throws(() => validateCache(text.replace("TARGET_VERSION:STRING=200", "TARGET_VERSION:STRING=300"), source))
  assert.throws(() => validateCache(text, resolve("other-source")))
})

test("source profile refuses mixed official Hexagon libraries", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "unifia-source-test-"))
  try {
    writeFileSync(resolve(dir, "libggml-hexagon.so"), "stale")
    assert.throws(() => inspect(dir), /Mixed source-build libraries/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
