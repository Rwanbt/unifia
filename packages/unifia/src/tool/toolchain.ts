/* SPDX-License-Identifier: MIT */
// Agent access to the on-device toolchain manager (ADR-097). Registered only
// where the Android runtime exposes its rootfs; every change asks permission.
import z from "zod"
import { Global } from "../global"
import { defaultOptions } from "../toolchain/download"
import { ToolchainManager } from "../toolchain/manager"
import { Tool } from "./tool"
import DESCRIPTION from "./toolchain.txt"

const parameters = z.object({
  action: z.enum(["list", "install", "remove", "update", "rollback"]),
  packages: z.array(z.string().regex(/^[a-z0-9][a-z0-9.+_-]*$/)).default([]).describe("Alpine package names"),
})

export const toolchainToolAvailable = (env: NodeJS.ProcessEnv = process.env) => Boolean(env.OPENCODE_MOBILE_ROOTFS_DIR)

export const ToolchainTool = Tool.define("toolchain", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    const manager = new ToolchainManager(defaultOptions(Global.Path.data))
    if (params.action === "list") {
      const installed = manager.list()
      return { title: "Toolchains", output: JSON.stringify(installed, null, 2), metadata: { count: installed.length } }
    }
    if ((params.action === "install" || params.action === "remove") && params.packages.length === 0) {
      throw new Error(`toolchain ${params.action} needs at least one package`)
    }
    await ctx.ask({
      permission: "toolchain",
      patterns: params.packages.length ? params.packages : [params.action],
      always: [],
      metadata: { action: params.action, packages: params.packages },
    })
    const summary =
      params.action === "install"
        ? await manager.install(params.packages)
        : params.action === "remove"
          ? await manager.remove(params.packages)
          : params.action === "update"
            ? await manager.update()
            : await manager.rollback()
    return {
      title: `toolchain ${params.action}`,
      output: JSON.stringify(summary, null, 2),
      metadata: { count: summary.installed.length + summary.removed.length },
    }
  },
})
