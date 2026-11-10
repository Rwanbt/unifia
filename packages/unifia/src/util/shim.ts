// SPDX-License-Identifier: MIT
// Windows `.cmd`/`.bat` launchers are the only files CreateProcess cannot run:
// cmd.exe has to interpret them. The shell-capable entry points (`spawnShim`,
// `runShim`) are the only way to reach that path, and they quote every argument.

export function isShim(file: string, platform: NodeJS.Platform = process.platform) {
  return platform === "win32" && /\.(cmd|bat)$/i.test(file)
}

/** Strict quoting for the cmd.exe line: `& | > < ^` are only literal inside
 *  double quotes, and `%` still expands there, so `%`, `"` and control
 *  characters are refused rather than guessed at. */
export function quote(arg: string): string {
  if (/[\0\r\n"%]/.test(arg)) throw new Error("command argument cannot be quoted safely for cmd.exe")
  return `"${arg}"`
}
