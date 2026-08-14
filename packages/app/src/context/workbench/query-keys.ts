/* SPDX-License-Identifier: MIT */

import type { WorkbenchConnection } from "@unifia/workbench-shell"

export function workbenchQueryKey(
  connection: WorkbenchConnection | undefined,
  resource: string,
  params: Record<string, string | number | boolean> = {},
) {
  return [
    "workbench",
    connection?.serverOrigin ?? "unavailable",
    connection?.instanceId ?? "unavailable",
    connection?.workspaceId ?? "unavailable",
    resource,
    params,
  ] as const
}
