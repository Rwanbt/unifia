/* SPDX-License-Identifier: MIT */

// Session routes can be opened before the server has created a real session
// (for example the visual-parity route `audit-check`). The observability API
// rejects those IDs with a 400, so callers must keep that expected empty state
// outside of the network resource.
export function observableSessionId(value: string | undefined) {
  return value?.startsWith("ses") ? value : undefined
}
