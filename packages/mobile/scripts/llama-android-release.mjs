import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"
import { resolve } from "node:path"

export const release = {
  version: "v1.0.0",
  build: "b12359",
  revision: "b1b770d90d94cad9e9ea5b993bdbc383a522fb28",
  asset: "llama-b12359-bin-android-arm64-snapdragon.tar.gz",
  sha256: "8183b26d575a74fbc3ea75214669b622eb01b309013b0349814f7bad4dfe01e1",
}

export const libraries = [
  "libllama_server.so", "libllama-server-impl.so", "libllama-common.so", "libllama.so", "libmtmd.so",
  "libggml.so", "libggml-base.so", "libggml-cpu.so", "libggml-rpc.so", "libggml-opencl.so", "libggml-hexagon.so",
  ...[73, 75, 79, 81, 85].map((arch) => `libggml-htp-v${arch}.so`),
]

export const hashes = JSON.parse(readFileSync(new URL("./llama-android-hashes.json", import.meta.url), "utf8"))

export const digest = (path) => createHash("sha256").update(readFileSync(path)).digest("hex")
export const native = (name) => /^lib(?:llama(?:[_.-].*)?|ggml(?:[.-].*)?|mtmd)\.so$/.test(name)

export function inspect(dir) {
  const extra = readdirSync(dir).filter((name) => native(name) && !libraries.includes(name) && name !== "libllama_jni.so")
  if (extra.length) throw new Error(`Stale or unverified llama.cpp libraries: ${extra.join(", ")}`)
  return Object.fromEntries(libraries.map((name) => {
    const path = resolve(dir, name)
    const bytes = readFileSync(path)
    if (bytes.length < 64 || bytes.readUInt32LE(0) !== 0x464c457f) throw new Error(`Invalid ELF: ${name}`)
    // HTP skels are Hexagon ELF32, not host AArch64 ELF64.
    if (!name.startsWith("libggml-htp-") && (bytes[4] !== 2 || bytes.readUInt16LE(18) !== 183)) {
      throw new Error(`Not Android arm64 ELF: ${name}`)
    }
    const actual = digest(path)
    if (actual !== hashes[name]) throw new Error(`Official Android library SHA-256 mismatch: ${name}`)
    return [name, actual]
  }))
}
