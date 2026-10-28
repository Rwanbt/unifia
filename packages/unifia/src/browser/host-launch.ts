/* SPDX-License-Identifier: MIT */
// Picks how the Node Browser host starts: provisioned Node and Playwright Chromium on the desktop, the
// rootfs Node and Chromium on Android.
import type { NodeHostLaunch } from "@unifia/browser-runtime/node-host-transport"
import { AndroidBrowserHost } from "./android-host-runtime"
import { BrowserHostRuntime } from "./host-runtime"

/** A `NodeHostLaunch` without the policy and quarantine, which belong to the server. */
export type BrowserHostLaunch = Omit<NodeHostLaunch, "init"> & { init: Pick<NodeHostLaunch["init"], "chromium" | "dnsServers"> }

/** Provisions what is missing on first use; a no-op afterwards. */
export async function resolveBrowserHostLaunch(root: string, env: NodeJS.ProcessEnv = process.env): Promise<BrowserHostLaunch> {
  const deps = BrowserHostRuntime.systemDependencies(root)
  const device = AndroidBrowserHost.detect(env)
  if (!device) {
    const launch = await BrowserHostRuntime.resolve(deps)
    return { entry: launch.entry, nodePath: launch.nodePath, stripTypes: launch.stripTypes, env: launch.env, init: {} }
  }
  const launch = await AndroidBrowserHost.resolve(device, deps)
  return {
    entry: launch.entry,
    nodePath: launch.nodePath,
    nodeArgs: launch.nodeArgs,
    stripTypes: launch.stripTypes,
    env: launch.env,
    init: { chromium: launch.chromium, dnsServers: launch.dnsServers },
  }
}
