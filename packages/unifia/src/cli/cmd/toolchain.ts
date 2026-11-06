/* SPDX-License-Identifier: MIT */
// `unifia toolchain` — install, update, remove and roll back the Alpine
// developer toolchains of the on-device rootfs (and of a private rootfs on
// other hosts). The same manager backs the agent tool and the UI.
import type { Argv } from "yargs"
import { Global } from "../../global"
import { defaultOptions, hostArch, type ToolchainArch } from "../../toolchain/download"
import { ToolchainManager } from "../../toolchain/manager"
import { cmd } from "./cmd"

interface ToolchainArgs {
  action: string
  packages: string[]
  root?: string
  state?: string
  arch: string
  repository?: string[]
  quota?: number
}

export function toolchainManagerFor(args: Omit<ToolchainArgs, "action" | "packages">): ToolchainManager {
  const defaults = defaultOptions(Global.Path.data, args.arch as ToolchainArch)
  return new ToolchainManager({
    ...defaults,
    root: args.root ?? defaults.root,
    state: args.state ?? defaults.state,
    repositories: args.repository?.length ? args.repository : defaults.repositories,
    quotaBytes: args.quota ?? defaults.quotaBytes,
  })
}

async function run(manager: ToolchainManager, action: string, packages: string[]): Promise<unknown> {
  if (action === "list") return manager.list()
  if (action === "env") return manager.environment()
  if (action === "update") return manager.update()
  if (action === "rollback") return manager.rollback()
  if (packages.length === 0) throw new Error(`toolchain ${action} needs at least one package`)
  return action === "install" ? manager.install(packages) : manager.remove(packages)
}

export const ToolchainCommand = cmd({
  command: "toolchain <action> [packages..]",
  describe: "manage on-device developer toolchains (Alpine packages)",
  builder: (yargs: Argv) =>
    yargs
      .positional("action", { choices: ["install", "remove", "update", "rollback", "list", "env"], type: "string" })
      .positional("packages", { type: "string", array: true, default: [] })
      .option("root", { type: "string", describe: "rootfs to manage" })
      .option("state", { type: "string", describe: "manager state directory" })
      .option("arch", { type: "string", choices: ["aarch64", "x86_64"], default: hostArch() })
      .option("repository", { type: "string", array: true, describe: "Alpine repository base URL (repeatable)" })
      .option("quota", { type: "number", describe: "maximum installed bytes" }),
  handler: async (args) => {
    const input = args as unknown as ToolchainArgs
    const result = await run(toolchainManagerFor(input), input.action, input.packages)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  },
})
