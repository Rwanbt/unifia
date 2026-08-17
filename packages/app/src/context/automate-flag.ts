/* SPDX-License-Identifier: MIT */

// See ADR-1033: Automate stays out of production builds. `dev` is
// `import.meta.env.DEV`, which esbuild/Vite replace with the literal `false`
// in a production bundle — the `&&` short-circuits and this branch is
// dead-code-eliminated, not just runtime-gated.
const STORAGE_KEY = "unifia.dev.automate"

export function isAutomateAccessible(dev: boolean, devFlag: boolean): boolean {
  return dev && devFlag
}

export function readAutomateDevFlag(): boolean {
  if (typeof localStorage === "undefined") return false
  try {
    return localStorage.getItem(STORAGE_KEY) === "true"
  } catch {
    return false
  }
}
