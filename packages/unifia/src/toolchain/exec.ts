// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors

// Runs a command to completion and returns its output. The caller decides what a non-zero exit means.
export async function capture(
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string>; timeout?: number } = {},
) {
  const proc = Bun.spawn(cmd, { cwd: opts.cwd, env: opts.env, timeout: opts.timeout, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { code, stdout, stderr }
}
