import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveSidecarBinaryPath } from "./utils"

const RUST_TARGET = Bun.env.TAURI_ENV_TARGET_TRIPLE

const sidecarConfig = getCurrentSidecar(RUST_TARGET)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../unifia && bun run build --single --baseline`
  : $`cd ../unifia && bun run build --single`)

// Resolved after the build, and through the shared resolver rather than by
// composing the path here: the hand-composed variant assumed the "-baseline"
// directory always exists (a single-target build produces the plain one) and
// pointed at the pre-rebrand `bin/opencode`, so it never matched what the
// build had just written.
await copyBinaryToSidecarFolder(await resolveSidecarBinaryPath("../unifia/dist", sidecarConfig.ocBinary), RUST_TARGET)
