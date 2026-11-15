import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import { digest, native, release } from "./llama-android-release.mjs"

export const profile = "android-arm64-opencl200-v1"
export const libraries = [
  "libllama_server.so", "libllama-server-impl.so", "libllama-common.so", "libllama.so", "libmtmd.so",
  "libggml.so", "libggml-base.so", "libggml-cpu.so", "libggml-opencl.so", "libc++_shared.so",
]
export const options = {
  ANDROID_ABI: "arm64-v8a", ANDROID_PLATFORM: "android-28", ANDROID_STL: "c++_shared",
  CMAKE_BUILD_TYPE: "Release", BUILD_SHARED_LIBS: "ON",
  CMAKE_C_FLAGS: "-march=armv8.2-a+dotprod+fp16 -DSUBPROCESS_HAVE_CWD=0",
  CMAKE_CXX_FLAGS: "-march=armv8.2-a+dotprod+fp16 -DSUBPROCESS_HAVE_CWD=0",
  GGML_OPENCL: "ON", GGML_OPENCL_TARGET_VERSION: "200", GGML_OPENCL_EMBED_KERNELS: "ON",
  GGML_OPENCL_USE_ADRENO_KERNELS: "ON", GGML_OPENCL_USE_ADRENO_BIN_KERNELS: "OFF",
  GGML_BACKEND_DL: "OFF", GGML_NATIVE: "OFF", GGML_HEXAGON: "OFF", GGML_VULKAN: "OFF", GGML_RPC: "OFF", GGML_OPENMP: "OFF", GGML_LLAMAFILE: "OFF",
  LLAMA_OPENSSL: "OFF", LLAMA_BUILD_UI: "OFF", LLAMA_USE_PREBUILT_UI: "OFF",
  LLAMA_BUILD_TESTS: "OFF", LLAMA_BUILD_EXAMPLES: "OFF", LLAMA_BUILD_APP: "OFF",
  LLAMA_BUILD_COMMON: "ON", LLAMA_BUILD_TOOLS: "ON", LLAMA_BUILD_SERVER: "ON",
}

export function inspect(dir) {
  const extra = readdirSync(dir).filter((name) => native(name) && name !== "libllama_jni.so" && !libraries.includes(name))
  if (extra.length) throw new Error(`Mixed source-build libraries: ${extra.join(", ")}`)
  return Object.fromEntries(libraries.map((name) => {
    const path = resolve(dir, name)
    const bytes = readFileSync(path)
    if (bytes.length < 64 || bytes.readUInt32LE(0) !== 0x464c457f || bytes[4] !== 2 || bytes.readUInt16LE(18) !== 183) {
      throw new Error(`Invalid source-build Android arm64 ELF: ${name}`)
    }
    return [name, digest(path)]
  }))
}

export function validate(recorded, revision, actual) {
  if (recorded.profile !== profile || revision !== release.revision || recorded.revision !== revision) {
    throw new Error("Source-build profile/revision does not match the pinned v1 source")
  }
  if (Object.keys(recorded.options ?? {}).length !== Object.keys(options).length ||
      Object.entries(options).some(([key, value]) => recorded.options[key] !== value)) {
    throw new Error("Source-build options do not match the OpenCL 2.0 profile")
  }
  if (recorded.clean_source !== true || recorded.ndk_revision !== "27.0.12077973" ||
      ![recorded.opencl_library_sha256, recorded.opencl_headers_sha256, recorded.cache_sha256].every((hash) => /^[a-f0-9]{64}$/.test(hash))) {
    throw new Error("Incomplete source-build input provenance")
  }
  if (Object.keys(recorded.libraries ?? {}).length !== libraries.length ||
      libraries.some((name) => recorded.libraries[name] !== actual[name])) {
    throw new Error("Source-build ELF files differ from their recorded build")
  }
}

export function validateCache(text, source) {
  const cache = Object.fromEntries(text.split(/\r?\n/).filter((line) => /^[^/#][^=]*=/.test(line))
    .map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf("=") + 1)]))
  for (const [key, value] of Object.entries(options)) {
    if (cache[key] !== value) throw new Error(`Unexpected CMake option ${key}: ${cache[key]} (expected ${value})`)
  }
  if (resolve(cache.CMAKE_HOME_DIRECTORY) !== resolve(source)) throw new Error("CMake cache belongs to another source tree")
  return cache
}
