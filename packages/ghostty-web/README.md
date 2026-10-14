<!-- SPDX-License-Identifier: MIT -->

# @unifia/ghostty-web

Vendored build output of the `ghostty-web` fork at
`anomalyco/ghostty-web@83c0a07` (MIT, see `LICENSE`).

## Why it is vendored

`bun install` fetched this dependency as a GitHub API tarball. Claude Code cloud
sessions are refused that tarball (HTTP 403), so no cloud session could install
the workspace. Keeping the published files in the repository makes the install
work offline, in CI, in Nix and in cloud sessions. Decision: #664, option A.

## Contents

The files the upstream package publishes, byte-identical to the `83c0a07`
tarball: `dist/` (ESM, UMD, types, wasm) and `ghostty-vt.wasm`. Two files
differ: `package.json` is renamed to `@unifia/ghostty-web`, made private and
stripped of the upstream build scripts and dev dependencies, and
`dist/index.d.ts` starts with an added SPDX line that the repository's
pre-commit check requires on new `.ts` files.

## Updating

1. Install the new upstream revision in a scratch directory
   (`bun add github:anomalyco/ghostty-web#<sha>`).
2. Copy its `dist/`, `ghostty-vt.wasm` and `LICENSE` over the files here, and
   put the SPDX line back at the top of `dist/index.d.ts`.
3. Update the revision in this README and in `package.json`'s description,
   then run `bun install` at the repository root.
