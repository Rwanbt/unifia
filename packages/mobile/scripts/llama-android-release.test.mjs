import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import test from "node:test"
import { hashes, inspect, libraries, native, release } from "./llama-android-release.mjs"
import { stage } from "./import-llama-android.mjs"

function temporary(run) {
  const dir = mkdtempSync(resolve(tmpdir(), "unifia-llama-test-"))
  try { run(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

test("official release pins every launcher, dependency and current DSP skel", () => {
  assert.deepEqual(Object.keys(hashes).sort(), [...libraries].sort())
  assert.equal(libraries.length, 16)
  assert.ok(libraries.includes("libggml-opencl.so"))
  assert.ok(libraries.includes("libggml-hexagon.so"))
  assert.ok(libraries.includes("libllama-server-impl.so"))
  assert.ok(libraries.includes("libggml-htp-v85.so"))
  assert.ok(Object.values(hashes).every((hash) => /^[a-f0-9]{64}$/.test(hash)))
  assert.match(release.revision, /^[a-f0-9]{40}$/)
})

test("unverified old GPU executables cannot be mixed into the unified release", () => temporary((dir) => {
  writeFileSync(resolve(dir, "libllama_server_vulkan.so"), "stale")
  assert.throws(() => inspect(dir), /Stale or unverified/)
  assert.equal(native("libllama-server-impl.so"), true)
  assert.equal(native("libggml-htp-v68.so"), true)
  assert.equal(native("libonnxruntime.so"), false)
}))

test("truncated or fake ELF fails even if its manifest claims a pinned digest", () => temporary((dir) => {
  writeFileSync(resolve(dir, "libllama_server.so"), "not ELF")
  assert.throws(() => inspect(dir), /Invalid ELF/)
  const elf = Buffer.alloc(64)
  elf.writeUInt32LE(0x464c457f)
  elf[4] = 2
  elf.writeUInt16LE(183, 18)
  writeFileSync(resolve(dir, "libllama_server.so"), elf)
  assert.throws(() => inspect(dir), /SHA-256 mismatch/)
}))

test("importer rejects an untrusted archive before creating native output", () => temporary((dir) => {
  const archive = resolve(dir, "bad.tar.gz")
  writeFileSync(archive, "untrusted")
  assert.throws(() => stage(archive, resolve(dir, "output")), /archive SHA-256 mismatch/)
}))

test("launcher policy explicitly selects accelerators and preserves release bytes", () => {
  const root = resolve(import.meta.dirname, "../src-tauri/gen/android/app")
  const engine = readFileSync(resolve(root, "src/main/java/ai/unifia/mobile/LlamaEngine.kt"), "utf8")
  const policy = readFileSync(resolve(root, "src/main/java/ai/unifia/mobile/LlamaReleaseRuntime.kt"), "utf8")
  assert.match(engine, /if \(unified\) chosen else when/)
  assert.match(engine, /selectedBackend == Backend.OPENCL && !adrenoOcl3Plus/)
  assert.match(engine, /args.addAll\(listOf\("--device", device\)\)/)
  assert.match(engine, /if \(unified && BackendCircuitBreaker.isDisabled\(backend\)\)/)
  assert.match(engine, /Accelerator \$effective failed; release runtime will not retry with CPU/)
  assert.match(engine, /startServer\(modelPath, contextSize, if \(isLlamaReleaseRuntime\(nativeLibDir\)\) selectedBackend else Backend.CPU\)/)
  assert.match(policy, /"OPENCL" -> "GPUOpenCL"/)
  assert.match(policy, /"HEXAGON" -> "HTP0"/)
  assert.match(policy, /else -> throw IllegalArgumentException/)
  const gradle = readFileSync(resolve(root, "build.gradle.kts"), "utf8")
  assert.match(gradle, /"libllama\*\.so", "libggml\*\.so", "libmtmd\.so"/)
})
