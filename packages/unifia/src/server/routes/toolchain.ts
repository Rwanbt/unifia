/* SPDX-License-Identifier: MIT */
// HTTP access to the toolchain manager (ADR-097) for the settings UI. The CLI
// and the agent tool drive the same manager; changes are classed `execute`
// in route-classes.ts because they download and install software.
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Global } from "../../global"
import { defaultOptions } from "../../toolchain/download"
import { ToolchainManager } from "../../toolchain/manager"
import { errors } from "../error"

const PackageName = z.string().regex(/^[a-z0-9][a-z0-9.+_-]*$/)

const Installed = z
  .object({ name: z.string(), version: z.string(), explicit: z.boolean(), license: z.string() })
  .meta({ ref: "ToolchainPackage" })

const Summary = z
  .object({ installed: z.array(z.string()), removed: z.array(z.string()) })
  .meta({ ref: "ToolchainChangeSummary" })

const Packages = z.object({ packages: z.array(PackageName).min(1) })

// The manager reconciles the package database when it is constructed (ADR-097). Building it here, when the routes are
// mounted at server start, brings the database in line with the rootfs before any request, not on the first one.
function startedToolchainManager(): () => ToolchainManager {
  const started = new ToolchainManager(defaultOptions(Global.Path.data))
  return () => started
}

export function ToolchainRoutes(manager: () => ToolchainManager = startedToolchainManager()) {
  const change = (operationId: string, summary: string) =>
    describeRoute({
      summary,
      operationId,
      responses: {
        200: { description: "What the transaction installed and removed", content: { "application/json": { schema: resolver(Summary) } } },
        ...errors(400),
      },
    })

  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "List toolchain packages",
        description: "Every package the manager owns, including the adopted base of the bundled rootfs.",
        operationId: "toolchain.list",
        responses: { 200: { description: "Installed packages", content: { "application/json": { schema: resolver(z.array(Installed)) } } } },
      }),
      (c) => c.json(manager().list()),
    )
    .post("/install", change("toolchain.install", "Install toolchain packages"), validator("json", Packages), async (c) =>
      c.json(await manager().install(c.req.valid("json").packages)),
    )
    .post("/remove", change("toolchain.remove", "Remove explicitly installed packages"), validator("json", Packages), async (c) =>
      c.json(await manager().remove(c.req.valid("json").packages)),
    )
    .post("/update", change("toolchain.update", "Update installed toolchains"), async (c) => c.json(await manager().update()))
    .post("/rollback", change("toolchain.rollback", "Roll back the last change, offline"), async (c) => c.json(await manager().rollback()))
}
