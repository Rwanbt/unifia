/* SPDX-License-Identifier: MIT */

import { createNativeTokenProvider } from "../src/native-token-bridge.js"

let issued = 0
let rotated = 0
let revoked = 0
const bridge = {
  issue: async () => { issued += 1; return { token: "first", instanceId: "instance-1", workspaceId: "workspace-1", expiresAt: Date.now() + 60_000 } },
  rotate: async () => { rotated += 1; return { state: "rotating", token: "second", previousToken: "first", gracePeriodMs: 30_000, expiresAt: Date.now() + 60_000 } },
  revoke: async () => { revoked += 1 },
}
const adapted = await createNativeTokenProvider(bridge, { workspaceId: "workspace-1", capabilities: ["workspace.read"] })
if (issued !== 1 || adapted.provider.current() !== "first") throw new Error("native provider did not issue its initial token")
if (await adapted.provider.refresh() !== "second" || rotated !== 1) throw new Error("native provider did not rotate its token")
adapted.provider.applyRotation?.({ state: "rotating", token: "third", previousToken: "second", gracePeriodMs: 30_000, expiresAt: Date.now() + 60_000 })
if (adapted.provider.current() !== "third") throw new Error("native provider did not apply an incoming rotation")
await adapted.revoke()
if (revoked !== 1) throw new Error("native provider did not revoke its workspace lease")
console.log("NativeTokenBridge: 4/4 passed")
