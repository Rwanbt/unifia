import { createHash } from "node:crypto"
import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const dir = resolve(root, "src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a")
const revision = readFileSync(resolve(root, "llama-cpp-revision.txt"), "utf8").trim()
const names = ["libllama_server.so", "libllama.so", "libggml.so", "libggml-base.so", "libggml-cpu.so"]
const manifest = resolve(dir, "llama-provenance.json")
const hash = (name) => createHash("sha256").update(readFileSync(resolve(dir, name))).digest("hex")

try {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("Invalid llama.cpp revision")
  const optional = readdirSync(dir).filter((name) => /^lib(?:llama_server_(?:hexagon|modern|opencl|vulkan)|ggml-(?:opencl|vulkan|htp-.*))\.so$/.test(name))
  if (optional.length) throw new Error(`Unverified GPU/NPU libraries require a matching build: ${optional.join(", ")}`)
  const current = { revision, libraries: Object.fromEntries(names.map((name) => [name, hash(name)])) }
  if (process.argv[2] === "write") {
    writeFileSync(manifest, JSON.stringify(current, null, 2) + "\n")
  } else if (process.argv[2] === "check") {
    const recorded = JSON.parse(readFileSync(manifest, "utf8"))
    if (recorded.revision !== revision || names.some((name) => recorded.libraries?.[name] !== current.libraries[name])) {
      throw new Error("llama.cpp libraries do not match the pinned revision and build manifest")
    }
  } else throw new Error("Use write or check")
  console.log(`llama.cpp provenance ${process.argv[2]} OK: ${revision}`)
} catch (error) {
  console.error(`llama.cpp provenance error: ${error.message}`)
  process.exitCode = 1
}
