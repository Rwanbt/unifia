// SPDX-License-Identifier: MIT

import { execFileSync } from "node:child_process"

type Execute = (file: string, args: string[]) => Buffer

export function convertWslPath(
  path: string,
  mode: "windows" | "linux" | null,
  execute: Execute = execFileSync,
): string {
  const flag = mode === "windows" ? "-w" : "-u"
  try {
    // HOME needs the WSL shell, but the caller's suffix must remain argument data.
    const args = path.startsWith("~")
      ? ["-e", "sh", "-lc", 'exec wslpath "$1" "$HOME$2"', "sh", flag, path.slice(1)]
      : ["-e", "wslpath", flag, path]
    return execute("wsl", args).toString().trim()
  } catch (error) {
    throw new Error(`Failed to run wslpath: ${String(error)}`)
  }
}
