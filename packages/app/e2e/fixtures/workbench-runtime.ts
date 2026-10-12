/* SPDX-License-Identifier: MIT */

import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

export type WorkbenchRuntimeTransport = {
  readonly baseUrl: string
  readonly workspaceId: string
  readonly token: string
  stop(): Promise<void>
}

type ReadyMessage = Omit<WorkbenchRuntimeTransport, "stop">

export function startWorkbenchRuntimeTransport(): Promise<WorkbenchRuntimeTransport> {
  const directory = path.dirname(fileURLToPath(import.meta.url))
  const root = path.resolve(directory, "../../../../")
  const script = path.join(directory, "workbench-runtime-server.ts")
  const child = spawn("bun", ["run", script], { cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  let errors = ""
  let settled = false

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error(`Workbench runtime startup timed out. ${errors}`)), 30_000)
    const finish = (error?: Error, message?: ReadyMessage) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error || !message) {
        child.kill("SIGTERM")
        reject(error ?? new Error(`Workbench runtime did not report readiness. ${errors}`))
        return
      }
      resolve({ ...message, stop: () => stopChild(child) })
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      const end = output.indexOf("\n")
      if (end < 0) return
      try {
        finish(undefined, JSON.parse(output.slice(0, end)) as ReadyMessage)
      } catch (error) {
        finish(new Error(`Invalid Workbench runtime readiness message: ${String(error)}`))
      }
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString("utf8")).slice(-8_000)
    })
    child.once("error", (error) => finish(error))
    child.once("exit", (code) => {
      if (!settled) finish(new Error(`Workbench runtime exited before readiness (${code}). ${errors}`))
    })
  })
}

function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), 5_000)
    child.once("exit", () => {
      clearTimeout(timeout)
      resolve()
    })
    child.kill("SIGTERM")
  })
}
