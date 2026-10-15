/* SPDX-License-Identifier: MIT */

import type { UserRole } from "../user"
import { ROUTE_CLASSES, type ActionClass } from "./route-classes"

const rules = ROUTE_CLASSES.map(([method, path, action]) => ({ method, parts: path.split("/"), action }))

function matches(pattern: string[], path: string[]): boolean {
  if (pattern.at(-1) === "*") {
    if (path.length < pattern.length - 1) return false
  } else if (pattern.length !== path.length) return false

  return pattern.every((part, index) => part === "*" || part.startsWith(":") || part === path[index])
}

export function classify(method: string, pathname: string): ActionClass | undefined {
  const verb = method === "HEAD" ? "GET" : method
  const path = pathname.split("/")
  return rules.find((rule) => (rule.method === verb || rule.method === "ALL") && matches(rule.parts, path))?.action
}

export function permitted(action: ActionClass, role: UserRole): boolean {
  if (action === "public" || action === "read-metadata" || action === "read-content" || action === "diagnostic") return true
  if (action === "write-content") return role !== "viewer"
  return role === "admin"
}
