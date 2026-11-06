/* SPDX-License-Identifier: MIT */
// Arguments that run one user command in the user's shell, after its rc file.

// POSIX single quotes keep every byte literal, so the command reaches `eval`
// exactly as typed. JSON.stringify produced a double-quoted string in which
// the outer shell expanded `$X` and backticks before `eval` ever saw them.
export function singleQuoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`
}

export function shellArgs(shellName: string, command: string): string[] {
  const quoted = singleQuoted(command)
  switch (shellName) {
    case "zsh":
      return [
        "-l",
        "-c",
        `
                __oc_cwd=$PWD
                [[ -f ~/.zshenv ]] && source ~/.zshenv >/dev/null 2>&1 || true
                [[ -f "\${ZDOTDIR:-$HOME}/.zshrc" ]] && source "\${ZDOTDIR:-$HOME}/.zshrc" >/dev/null 2>&1 || true
                cd "$__oc_cwd"
                eval ${quoted}
              `,
      ]
    case "bash":
      return [
        "-l",
        "-c",
        `
                __oc_cwd=$PWD
                shopt -s expand_aliases
                [[ -f ~/.bashrc ]] && source ~/.bashrc >/dev/null 2>&1 || true
                cd "$__oc_cwd"
                eval ${quoted}
              `,
      ]
    case "cmd":
      return ["/c", command]
    case "powershell":
    case "pwsh":
      return ["-NoProfile", "-Command", command]
    default:
      return ["-c", command]
  }
}
