/* SPDX-License-Identifier: MIT */

import { afterEach, beforeEach } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Config } from "../../src/config/config"
import { Global } from "../../src/global/path"

/**
 * Give every test its own global config directory.
 *
 * MCP add/remove persist to the global config file (#102), while the test
 * harness shares one XDG_CONFIG_HOME for the whole run. Without this, a
 * server added by one test leaks into every later test's instance, and the
 * suite's server/tool/prompt counts read far too high.
 *
 * Same shape as the per-test `Global.Path.config` swap in
 * test/config/config.test.ts and test/session/instruction.test.ts:
 * point the path at a fresh directory, invalidate so the cached global
 * config reloads, and restore on the way out.
 */
export function isolateGlobalConfig(): void {
  let prev: string | undefined
  let dir: string | undefined

  beforeEach(async () => {
    prev = Global.Path.config
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "unifia-mcp-global-"))
    ;(Global.Path as { config: string }).config = dir
    await Config.invalidate()
  })

  afterEach(async () => {
    if (prev !== undefined) (Global.Path as { config: string }).config = prev
    await Config.invalidate()
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  })
}
