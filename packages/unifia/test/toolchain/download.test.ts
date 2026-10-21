// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

/**
 * Tests for src/toolchain/download.ts against a real HTTP server on 127.0.0.1.
 *
 * The https rule belongs to the manifest (catalog.ts), not to the transfer, so the transfer is
 * tested over plain HTTP here. A download is only ever published as `<dest>` after its size and
 * digest match; anything else leaves `<dest>.part` behind for the caller to discard.
 */
import { afterAll, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { download } from "../../src/toolchain/download"

const body = new TextEncoder().encode("toolchain payload\n")
const sha256 = createHash("sha256").update(body).digest("hex")

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === "/missing") return new Response("gone", { status: 404 })
    if (url.pathname === "/redirect") return Response.redirect(`${url.origin}/payload`, 302)
    return new Response(body)
  },
})
const base = `http://127.0.0.1:${server.port}`

afterAll(() => server.stop(true))

test("downloads, verifies the sha256 and publishes the file", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await download(`${base}/payload`, dest, { size: body.byteLength, sha256 })
  expect(new Uint8Array(await Bun.file(dest).arrayBuffer())).toEqual(body)
  expect(existsSync(`${dest}.part`)).toBe(false)
})

test("follows redirects", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await download(`${base}/redirect`, dest, { size: body.byteLength, sha256 })
  expect(await Bun.file(dest).size).toBe(body.byteLength)
})

test("refuses a digest mismatch and never publishes the file", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await expect(download(`${base}/payload`, dest, { size: body.byteLength, sha256: "0".repeat(64) })).rejects.toThrow(
    "sha256 mismatch",
  )
  expect(existsSync(dest)).toBe(false)
})

test("refuses a size that differs from the pinned size", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await expect(download(`${base}/payload`, dest, { size: body.byteLength + 1, sha256 })).rejects.toThrow("size")
  expect(existsSync(dest)).toBe(false)
})

test("stops as soon as the body exceeds the pinned size", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await expect(download(`${base}/payload`, dest, { size: 4, sha256 })).rejects.toThrow("exceeds")
  expect(existsSync(dest)).toBe(false)
})

test("refuses a non-2xx response", async () => {
  await using tmp = await tmpdir()
  const dest = path.join(tmp.path, "artifact.tgz")
  await expect(download(`${base}/missing`, dest, { size: 4, sha256 })).rejects.toThrow("404")
})
