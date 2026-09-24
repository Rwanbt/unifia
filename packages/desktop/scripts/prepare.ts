#!/usr/bin/env bun
import { $ } from "bun"

import { Script } from "@unifia/script"
import { buildLiveKitServer } from "./livekit-server"
import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveSidecarBinaryPath, RUST_TARGET } from "./utils"

const pkg = await Bun.file("./package.json").json()
pkg.version = Script.version
await Bun.write("./package.json", JSON.stringify(pkg, null, 2) + "\n")
console.log(`Updated package.json version to ${Script.version}`)

const sidecarConfig = getCurrentSidecar()
const artifact = process.env.UNIFIA_CLI_ARTIFACT ?? "unifia-cli"

const dir = "src-tauri/target/opencode-binaries"

await $`mkdir -p ${dir}`
await $`gh run download ${process.env.GITHUB_RUN_ID} -n ${artifact}`.cwd(dir)

await copyBinaryToSidecarFolder(await resolveSidecarBinaryPath(dir, sidecarConfig.ocBinary))

// Live voice SFU, built from the pinned Go module and checked against its
// reproducible sha256 (packages/voice-host/livekit-server.json).
await buildLiveKitServer(RUST_TARGET!)
