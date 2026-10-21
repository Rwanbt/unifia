// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { running, startOf } from "./proc"

const ATTEMPTS = 300
const DELAY_MS = 100

type Owner = { pid: number; start?: number; token: string }

async function alive(owner: Owner) {
  if (owner.start === undefined) return running(owner.pid)
  return (await startOf(owner.pid)) === owner.start
}

async function owned(dir: string): Promise<Owner | undefined> {
  const raw = await readFile(path.join(dir, "owner.json"), "utf8").catch(() => undefined)
  return raw === undefined ? undefined : (JSON.parse(raw) as Owner)
}

// The lock is published whole: the owner file is written in a temporary directory that is then
// renamed into place, so a reader never sees a lock without its owner.
async function acquire(dir: string) {
  for (let i = 0; i < ATTEMPTS; i++) {
    const token = randomUUID()
    const staged = `${dir}.${token}`
    const owner: Owner = { pid: process.pid, start: await startOf(process.pid), token }
    await mkdir(staged)
    await writeFile(path.join(staged, "owner.json"), JSON.stringify(owner))
    const won = await rename(staged, dir).then(
      () => true,
      () => false,
    )
    if (won) return token
    await rm(staged, { recursive: true, force: true })
    const holder = await owned(dir)
    if (holder !== undefined && !(await alive(holder))) await rm(dir, { recursive: true, force: true })
    else await Bun.sleep(DELAY_MS)
  }
  throw new Error(`toolchain is busy: ${dir}`)
}

// Runs `fn` while holding the lock for one toolchain id. Locks of dead processes are reclaimed.
export async function withLock<T>(root: string, id: string, fn: () => Promise<T>): Promise<T> {
  const dir = path.join(root, ".locks", id)
  await mkdir(path.dirname(dir), { recursive: true })
  const token = await acquire(dir)
  try {
    return await fn()
  } finally {
    if ((await owned(dir))?.token === token) await rm(dir, { recursive: true, force: true })
  }
}
