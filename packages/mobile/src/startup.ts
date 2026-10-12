/* SPDX-License-Identifier: MIT */

export function mobileStartupMode(os: string | undefined) {
  return os === "android" ? "extracting" : "remote-prompt"
}

export async function prepareLocalRuntime(dependencies: {
  check: () => Promise<{ ready: boolean; extended_env: boolean }>
  extract: () => Promise<void>
  install: () => Promise<void>
  onInstall: () => void
}) {
  const info = await dependencies.check()
  if (!info.ready) await dependencies.extract()
  if (info.extended_env) return
  dependencies.onInstall()
  await dependencies.install()
}
