/* SPDX-License-Identifier: MIT */
// Builds the pinned LiveKit SFU used by the Live Voice Host into
// src-tauri/sidecars/livekit-server-<rust-target>[.exe] (Tauri externalBin).
//
// Supply chain: the module is fetched through the Go module proxy and checked
// against sum.golang.org (the Go toolchain refuses a mismatching download);
// we additionally require the checksum pinned in voice-host/livekit-server.json.
// CGO is off and paths are trimmed, so the binary is reproducible; when a
// sha256 is pinned for the target, the build must match it bit for bit.
import { $ } from "bun"
import { createHash } from "node:crypto"
import { cp, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Manifest = {
  module: string
  version: string
  moduleSum: string
  goToolchain: string
  sha256: Record<string, string>
}

const GO_TARGETS: Record<string, { goos: string; goarch: string; exe: string }> = {
  "x86_64-pc-windows-msvc": { goos: "windows", goarch: "amd64", exe: ".exe" },
  "aarch64-pc-windows-msvc": { goos: "windows", goarch: "arm64", exe: ".exe" },
  "x86_64-unknown-linux-gnu": { goos: "linux", goarch: "amd64", exe: "" },
  "aarch64-unknown-linux-gnu": { goos: "linux", goarch: "arm64", exe: "" },
  "x86_64-apple-darwin": { goos: "darwin", goarch: "amd64", exe: "" },
  "aarch64-apple-darwin": { goos: "darwin", goarch: "arm64", exe: "" },
}

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
const manifestPath = path.resolve(here, "../../voice-host/livekit-server.json")

async function sha256(file: string) {
  return createHash("sha256").update(await readFile(file)).digest("hex")
}

export async function buildLiveKitServer(target: string, outDir = path.resolve(here, "../src-tauri/sidecars")) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest
  const go = GO_TARGETS[target]
  if (!go) throw new Error(`No LiveKit server build for Rust target ${target}`)
  const output = path.join(outDir, `livekit-server-${target}${go.exe}`)
  const pinned = manifest.sha256[target]
  if (await stat(output).catch(() => undefined)) {
    const existing = await sha256(output)
    if (!pinned || existing === pinned) {
      console.log(`Reusing ${output} (${existing})`)
      return output
    }
  }
  const env = { ...process.env, GOTOOLCHAIN: manifest.goToolchain, GOFLAGS: "-mod=mod", CGO_ENABLED: "0" }
  const ref = `${manifest.module}@${manifest.version}`
  const download = JSON.parse(await $`go mod download -json ${ref}`.env(env).text()) as { Dir: string; Sum: string }
  if (download.Sum !== manifest.moduleSum) {
    throw new Error(`LiveKit module checksum mismatch: expected ${manifest.moduleSum}, got ${download.Sum}`)
  }
  const work = await mkdtemp(path.join(os.tmpdir(), "unifia-livekit-"))
  try {
    await cp(download.Dir, work, { recursive: true })
    await $`chmod -R u+w ${work}`.nothrow()
    await mkdir(outDir, { recursive: true })
    await $`go build -trimpath -buildvcs=false -ldflags=-s\ -w -o ${output} ./cmd/server`
      .cwd(work)
      .env({ ...env, GOOS: go.goos, GOARCH: go.goarch })
  } finally {
    await rm(work, { recursive: true, force: true })
  }
  const digest = await sha256(output)
  if (pinned && digest !== pinned) {
    await rm(output, { force: true })
    throw new Error(`LiveKit server build is not reproducible for ${target}: expected ${pinned}, got ${digest}`)
  }
  console.log(`Built ${output} (${manifest.version}, sha256 ${digest}${pinned ? ", matches pin" : ", no pin for this target"})`)
  return output
}

if (import.meta.main) {
  const target = process.argv[2] ?? Bun.env.TAURI_ENV_TARGET_TRIPLE ?? Bun.env.RUST_TARGET
  if (!target) throw new Error("Pass the Rust target triple (or set RUST_TARGET)")
  await buildLiveKitServer(target, process.argv[3])
}
