import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const script = fileURLToPath(new URL("./llama-provenance.mjs", import.meta.url))
const result = spawnSync(process.execPath, [script, "check"], { stdio: "inherit" })
if (result.error || result.status !== 0) throw result.error ?? new Error("llama.cpp provenance check failed")
