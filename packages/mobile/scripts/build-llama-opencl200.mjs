import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { parseArgs } from "node:util"
import { fileURLToPath } from "node:url"
import { digest, libraries as official, native, release } from "./llama-android-release.mjs"
import { inspect, libraries, options, profile, validate, validateCache } from "./llama-android-source.mjs"

const root = resolve(import.meta.dirname, "..")
const run = (command, args, capture = false) => execFileSync(command, args, {
  stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", encoding: "utf8",
})

function sourceAt(source) {
  if (run("git", ["-C", source, "rev-parse", "HEAD"], true).trim() !== release.revision) {
    throw new Error("Source checkout is not the pinned llama.cpp v1 revision")
  }
  if (run("git", ["-C", source, "status", "--porcelain", "--untracked-files=all"], true).trim()) {
    throw new Error("llama.cpp tracked source files must be clean")
  }
  if (readFileSync(resolve(root, "llama-cpp-revision.txt"), "utf8").trim() !== release.revision) {
    throw new Error("Mobile source pin disagrees with this build profile")
  }
}

export function build(args) {
  for (const name of ["source", "build", "ndk", "opencl", "headers", "python"]) {
    if (!args[name]) throw new Error(`Missing --${name}`)
  }
  const source = resolve(args.source)
  const dir = resolve(args.build)
  const ndk = resolve(args.ndk)
  const headers = resolve(args.headers)
  const driver = resolve(args.opencl)
  const cmake = args.cmake ?? "cmake"
  const jobs = args.jobs ?? "2"
  if (!/^[1-9][0-9]*$/.test(jobs)) throw new Error("--jobs must be positive")
  sourceAt(source)
  const revision = readFileSync(resolve(ndk, "source.properties"), "utf8").match(/Pkg.Revision\s*=\s*(\S+)/)?.[1]
  if (revision !== "27.0.12077973") throw new Error(`Expected NDK 27.0.12077973, got ${revision}`)
  if (!existsSync(resolve(headers, "CL/cl.h"))) throw new Error("--headers must contain CL/cl.h")
  const cachefile = resolve(dir, "CMakeCache.txt")
  if (!args["stage-only"]) {
    if (existsSync(cachefile)) throw new Error("Use a new build directory to prevent cached-option or stale-output mixing")
    run(cmake, ["-S", source, "-B", dir, "-G", "Ninja",
      ...Object.entries(options).map(([key, value]) => `-D${key}=${value}`),
      `-DCMAKE_TOOLCHAIN_FILE=${resolve(ndk, "build/cmake/android.toolchain.cmake")}`,
      `-DOpenCL_LIBRARY=${driver}`, `-DOpenCL_INCLUDE_DIR=${headers}`, `-DPython3_EXECUTABLE=${resolve(args.python)}`,
      ...(args.ninja ? [`-DCMAKE_MAKE_PROGRAM=${resolve(args.ninja)}`] : []),
    ])
    if (args["configure-only"]) return
    run(cmake, ["--build", dir, "--target", "llama-server", "--parallel", jobs])
  }
  const cachetext = readFileSync(cachefile, "utf8")
  const cache = validateCache(cachetext, source)
  for (const [key, expected] of Object.entries({ OpenCL_LIBRARY: driver, OpenCL_INCLUDE_DIR: headers,
    CMAKE_TOOLCHAIN_FILE: resolve(ndk, "build/cmake/android.toolchain.cmake") })) {
    if (!cache[key] || resolve(cache[key]) !== expected) throw new Error(`CMake input changed: ${key}`)
  }
  sourceAt(source)
  const host = process.platform === "win32" ? "windows-x86_64" : "linux-x86_64"
  const llvm = resolve(ndk, `toolchains/llvm/prebuilt/${host}`)
  const temp = mkdtempSync(resolve(tmpdir(), "unifia-opencl200-"))
  try {
    for (const name of libraries) {
      const path = name === "libc++_shared.so" ? resolve(llvm, "sysroot/usr/lib/aarch64-linux-android/libc++_shared.so") :
        resolve(dir, "bin", name === "libllama_server.so" ? "llama-server" : name)
      copyFileSync(path, resolve(temp, name))
    }
    const symbols = run(resolve(llvm, `bin/llvm-nm${process.platform === "win32" ? ".exe" : ""}`),
      ["--dynamic", "--undefined-only", resolve(temp, "libggml-opencl.so")], true)
    if (/\b(?:clCreateBufferWithProperties|clCreateImageWithProperties|clGetKernelSubGroupInfo)\b/.test(symbols)) {
      throw new Error("Built OpenCL runtime still requires unsupported 2.1/3.0 entry points")
    }
    const allowed = new Set([...libraries, "libc.so", "libm.so", "libdl.so", "liblog.so", "libandroid.so", "libz.so", "libOpenCL.so"])
    for (const name of libraries) {
      const dynamic = run(resolve(llvm, `bin/llvm-readelf${process.platform === "win32" ? ".exe" : ""}`),
        ["--dynamic", resolve(temp, name)], true)
      for (const match of dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)) {
        if (!allowed.has(match[1])) throw new Error(`Unstaged dependency ${match[1]} required by ${name}`)
      }
    }
    const fingerprint = createHash("sha256")
    for (const name of readdirSync(resolve(headers, "CL")).filter((name) => name.endsWith(".h")).sort()) {
      fingerprint.update(name + ":" + digest(resolve(headers, "CL", name)) + "\n")
    }
    const manifest = { profile, revision: release.revision, clean_source: true, ndk_revision: revision,
      options, opencl_library_sha256: digest(driver), opencl_headers_sha256: fingerprint.digest("hex"),
      cache_sha256: digest(cachefile), libraries: inspect(temp) }
    validate(manifest, release.revision, manifest.libraries)
    const dest = resolve(root, "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a")
    mkdirSync(dest, { recursive: true })
    const extra = readdirSync(dest).filter((name) => native(name) && name !== "libllama_jni.so" && !libraries.includes(name))
    if (extra.some((name) => !official.includes(name))) throw new Error(`Unknown native files require manual review: ${extra.join(", ")}`)
    // Only known official accelerators superseded by this complete source build are removed.
    for (const name of extra) unlinkSync(resolve(dest, name))
    for (const name of libraries) copyFileSync(resolve(temp, name), resolve(dest, name))
    const out = resolve(root, "src-tauri/gen/android/llama-headers")
    mkdirSync(out, { recursive: true })
    for (const include of [resolve(source, "include"), resolve(source, "ggml/include")]) {
      for (const name of readdirSync(include).filter((name) => name.endsWith(".h"))) copyFileSync(resolve(include, name), resolve(out, name))
    }
    writeFileSync(resolve(dest, "llama-provenance.json"), JSON.stringify(manifest, null, 2) + "\n")
    console.log(`Staged ${profile}: ${libraries.length} coherent ELF files; OpenCL API 200, no shim`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries([
      ...["source", "build", "ndk", "opencl", "headers", "python", "cmake", "ninja", "jobs"].map((name) => [name, { type: "string" }]),
      ...["configure-only", "stage-only"].map((name) => [name, { type: "boolean" }]),
    ]) })
    if (values["configure-only"] && values["stage-only"]) throw new Error("Choose configure-only or stage-only, not both")
    build(values)
  } catch (error) {
    console.error(`OpenCL 2.0 build error: ${error.message}`)
    process.exitCode = 1
  }
}
