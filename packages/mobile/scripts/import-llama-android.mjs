import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { digest, inspect, libraries, native, release } from "./llama-android-release.mjs"

// WHY accept only an archive, never an extracted directory: the published digest
// authenticates every ELF and header before any of them enters the Android build.
export function stage(archive, root = resolve(import.meta.dirname, "..")) {
  if (digest(archive) !== release.sha256) throw new Error("Android llama.cpp archive SHA-256 mismatch")
  const revision = readFileSync(resolve(root, "llama-cpp-revision.txt"), "utf8").trim()
  if (revision !== release.revision) throw new Error("Android release and pinned llama.cpp revision disagree")
  const dir = resolve(root, "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a")
  mkdirSync(dir, { recursive: true })
  const extra = readdirSync(dir).filter((name) => native(name) && !libraries.includes(name) && name !== "libllama_jni.so")
  if (extra.length) throw new Error(`Refusing to mix stale llama.cpp libraries: ${extra.join(", ")}`)
  const temp = mkdtempSync(resolve(tmpdir(), "unifia-llama-"))
  try {
    execFileSync("tar", ["-xzf", resolve(archive), "-C", temp], { stdio: "inherit" })
    const source = resolve(temp, `llama-${release.build}`)
    const staged = resolve(temp, "jni")
    mkdirSync(staged)
    for (const name of libraries) {
      const from = name === "libllama_server.so" ? "bin/llama-server" : `lib/${name}`
      copyFileSync(resolve(source, from), resolve(staged, name))
    }
    const hashes = inspect(staged)
    for (const name of libraries) copyFileSync(resolve(staged, name), resolve(dir, name))
    const headers = resolve(root, "src-tauri/gen/android/llama-headers")
    mkdirSync(headers, { recursive: true })
    for (const name of readdirSync(resolve(source, "include")).filter((name) => name.endsWith(".h"))) {
      copyFileSync(resolve(source, "include", name), resolve(headers, name))
    }
    writeFileSync(resolve(dir, "llama-provenance.json"), JSON.stringify({
      revision, distribution: release.asset, archive_sha256: release.sha256, libraries: hashes,
    }, null, 2) + "\n")
    console.log(`Imported ${release.version} ${release.build}: OpenCL + Hexagon (${libraries.length} ELF files)`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw new Error(`Usage: node import-llama-android.mjs <${release.asset}>`)
    stage(process.argv[2])
  } catch (error) {
    console.error(`Android llama.cpp import error: ${error.message}`)
    process.exitCode = 1
  }
}
