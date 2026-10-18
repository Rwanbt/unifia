/* SPDX-License-Identifier: MIT */
import { SNAPSHOT_BOUNDS, WindowSnapshotUnavailable, WindowsSnapshotProvider } from "../src/snapshot-provider.ts"

let checks = 0
const check = (condition: boolean, message: string): void => {
  checks += 1
  if (!condition) throw new Error(message)
}
const refused = async (run: () => Promise<unknown>, message: string): Promise<WindowSnapshotUnavailable> => {
  checks += 1
  try {
    await run()
  } catch (error) {
    if (error instanceof WindowSnapshotUnavailable) return error
    throw new Error(`${message} (got ${String(error)})`)
  }
  throw new Error(`${message} (was returned as a snapshot)`)
}

const payload = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    windowId: "4321",
    title: "Notes — untitled",
    focused: true,
    visibleText: "Shopping list\nbread",
    focusedFieldIsSecret: false,
    ...over,
  })

// --- Nominal: the payload is mapped onto the shared snapshot shape ------------
const calls: Array<{ appId: string; windowId?: string }> = []
const provider = new WindowsSnapshotProvider(async (target) => {
  calls.push({ appId: target.appId, windowId: target.windowId })
  return payload()
})
const snapshot = await provider.snapshot({ appId: "notepad.exe", windowId: "4321" })
check(snapshot.appId === "notepad.exe", "the snapshot lost the requested app id")
check(snapshot.windowId === "4321" && snapshot.title === "Notes — untitled", "the snapshot lost the window identity")
check(snapshot.focused === true, "the snapshot lost the focus flag")
check(snapshot.visibleText === "Shopping list\nbread", "the snapshot lost the visible text")
check(snapshot.focusedFieldIsSecret === false, "the snapshot lost the secret-field flag")
check(
  calls.length === 1 && calls[0].appId === "notepad.exe" && calls[0].windowId === "4321",
  "the runner did not receive the exact target",
)

// --- Failures are refusals: no snapshot is invented, and the app is named -----
const failing = new WindowsSnapshotProvider(async () => {
  throw new Error("no window for app: notepad.exe")
})
const unavailable = await refused(() => failing.snapshot({ appId: "notepad.exe" }), "a failed provider command yielded a snapshot")
check(unavailable.appId === "notepad.exe", "the refusal did not name the app")
check(unavailable.message.includes("no window for app"), "the refusal did not carry the provider cause")

// --- Malformed or incomplete payloads are refused, never coerced --------------
const malformed = new WindowsSnapshotProvider(async () => "not json")
await refused(() => malformed.snapshot({ appId: "notepad.exe" }), "a malformed payload yielded a snapshot")
for (const over of [{ windowId: 5 }, { focused: "yes" }, { visibleText: null }, { focusedFieldIsSecret: undefined }]) {
  const incomplete = new WindowsSnapshotProvider(async () => payload(over))
  await refused(
    () => incomplete.snapshot({ appId: "notepad.exe" }),
    `an incomplete payload ${JSON.stringify(over)} yielded a snapshot`,
  )
}

// --- Bounds: visible text length is enforced provider-side --------------------
const longText = "x".repeat(SNAPSHOT_BOUNDS.maxVisibleTextChars + 500)
const clamping = new WindowsSnapshotProvider(async () => payload({ visibleText: longText }))
const clamped = await clamping.snapshot({ appId: "notepad.exe" })
check(clamped.visibleText.length === SNAPSHOT_BOUNDS.maxVisibleTextChars, "the visible text was not clamped to the bound")
check(SNAPSHOT_BOUNDS.maxDepth > 0 && SNAPSHOT_BOUNDS.maxDepth <= 8, "the walk depth bound is not a small positive bound")
check(SNAPSHOT_BOUNDS.maxElements > 0, "the walk element budget is not positive")

// --- Focus and secret flags pass through unchanged -----------------------------
const secret = new WindowsSnapshotProvider(async () => payload({ focused: false, focusedFieldIsSecret: true }))
const secretSnapshot = await secret.snapshot({ appId: "notepad.exe" })
check(
  secretSnapshot.focused === false && secretSnapshot.focusedFieldIsSecret === true,
  "the focus / secret flags were not carried through",
)

console.log(`WindowsSnapshotProvider: ${checks}/${checks} passed`)
