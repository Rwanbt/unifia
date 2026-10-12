// SPDX-License-Identifier: MIT
import { Effect } from "effect"
import type { Config } from "../../src/config/config"
import type { Permission } from "../../src/permission"
import { Shell } from "../../src/shell/shell"

export function shellCommand(target: string, shell = Shell.preferred()) {
  const name = Shell.name(shell)
  if (name === "powershell" || name === "pwsh") {
    return `Set-Content -LiteralPath '${target.replaceAll("'", "''")}' -Value rc0-harmless`
  }
  if (name === "cmd") return `echo rc0-harmless > "${target}"`
  return `printf rc0-harmless > '${target.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`
}

export const shellArgs = (target: string) => `!\`${shellCommand(target)}\``

export function commandConfig(provider: (url: string) => Config.Info) {
  return (url: string) => ({
    ...provider(url),
    command: { witness: { template: "Describe this input: $ARGUMENTS" } },
  })
}

// ADR-043: observe the approval before replying so the fixture cannot race it.
export const pendingRequests = (permission: Permission.Interface) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 200; attempt++) {
      const pending = yield* permission.list()
      if (pending.length > 0) return pending
      yield* Effect.sleep(25)
    }
    return []
  })
