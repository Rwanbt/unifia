/* SPDX-License-Identifier: MIT */
import type { Plugin } from "vite"

export function storybookBuildProfile(): Plugin {
  let modules = 0
  let grammarModules = 0
  let transformedBytes = 0
  let chunks = 0
  const started = performance.now()
  const report = (phase: string) => {
    const memory = process.memoryUsage()
    console.info("UNIFIA_STORYBOOK_BUILD", JSON.stringify({
      phase,
      elapsedMs: Math.round(performance.now() - started),
      heapMiB: Math.round(memory.heapUsed / 1024 / 1024),
      rssMiB: Math.round(memory.rss / 1024 / 1024),
      modules,
      grammarModules,
      transformedBytes,
      chunks,
    }))
  }
  return {
    name: "unifia-storybook-build-profile",
    apply: "build",
    buildStart() { report("build-start") },
    transform(code, id) {
      modules++
      transformedBytes += Buffer.byteLength(code)
      if (id.includes("@shikijs/langs/")) grammarModules++
      if (modules % 100 === 0) report("transform")
      return null
    },
    buildEnd(error) { report(error ? "build-error" : "build-end") },
    renderStart() { report("render-start") },
    renderChunk() {
      chunks++
      if (chunks === 1 || chunks % 50 === 0) report("render-chunk")
      return null
    },
    generateBundle() { report("generate-bundle") },
    closeBundle() { report("close-bundle") },
  }
}
