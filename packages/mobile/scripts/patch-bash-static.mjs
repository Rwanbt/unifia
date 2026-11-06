#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Patches the static musl bash shipped as libbash_exec.so so it never issues faccessat2.
//
// musl's faccessat() tries faccessat2 first and falls back to faccessat when the kernel answers -ENOSYS.
// Android's app seccomp filter does not answer: on kernels without faccessat2 (4.19 on the Mi 10 Pro) it kills
// the process with SIGSYS. bash checks executables with eaccess() -> faccessat(AT_EACCESS), so every PATH
// lookup outside the agent's own functions (`sh -c`, make, npm scripts) died with "Bad system call".
//
// The patch replaces the `svc #0` of that one syscall with `movn x0, #37` (x0 = -ENOSYS): musl's own
// `cmn w0, #38` check right after it then takes the faccessat fallback, which the filter allows.
//
// The musl dynamic linker shipped as libmusl_linker.so is musl's libc for every rootfs program (node, make,
// npm…) and carries the same faccessat2 call, so it gets the same patch. It comes from the current Alpine musl
// package rather than a pinned build, so it is checked by its syscall site alone (--any-build).
//
// Usage: node patch-bash-static.mjs [--any-build] <binary> [out]   (in place when out is omitted)
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

// robxu9/bash-static 5.2.015-1.2.3-2, bash-linux-aarch64.
export const PINNED_TAG = "5.2.015-1.2.3-2"
const INPUT_SHA256 = "8877ad33344af461ed801066322fd9a7808cd73e4e81087da228e32e8fad54ca"

const MOV_X8_FACCESSAT2 = 0xd28036e8 // movz x8, #439
const SVC_0 = 0xd4000001
const CMN_W0_ENOSYS = 0x3100981f // cmn w0, #38
const MOVN_X0_ENOSYS = 0x928004a0 // movn x0, #37  => x0 = -38

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

export function patchFaccessat2(bytes) {
  const sites = []
  for (let offset = 0; offset + 12 <= bytes.length; offset += 4) {
    if (
      bytes.readUInt32LE(offset) === MOV_X8_FACCESSAT2 &&
      bytes.readUInt32LE(offset + 4) === SVC_0 &&
      bytes.readUInt32LE(offset + 8) === CMN_W0_ENOSYS
    )
      sites.push(offset + 4)
  }
  if (sites.length !== 1) throw new Error(`expected exactly one faccessat2 syscall site, found ${sites.length}`)
  const patched = Buffer.from(bytes)
  patched.writeUInt32LE(MOVN_X0_ENOSYS, sites[0])
  return { patched, offset: sites[0] }
}

if (process.argv[1]?.endsWith("patch-bash-static.mjs")) {
  const args = process.argv.slice(2)
  const anyBuild = args[0] === "--any-build"
  const [input, output = input] = anyBuild ? args.slice(1) : args
  if (!input) {
    console.error("usage: patch-bash-static.mjs [--any-build] <binary> [out]")
    process.exit(2)
  }
  const bytes = readFileSync(input)
  const actual = sha256(bytes)
  if (!anyBuild && actual !== INPUT_SHA256) {
    console.error(`[patch-bash-static] unexpected input ${actual}; expected bash-static ${PINNED_TAG} (${INPUT_SHA256})`)
    process.exit(1)
  }
  const { patched, offset } = patchFaccessat2(bytes)
  writeFileSync(output, patched)
  console.log(`[patch-bash-static] faccessat2 svc at 0x${offset.toString(16)} -> -ENOSYS; ${sha256(patched)}`)
}
