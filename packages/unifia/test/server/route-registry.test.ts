/* SPDX-License-Identifier: MIT */

import { describe, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { InstanceRoutes } from "../../src/server/instance"
import { ROUTE_CLASSES } from "../../src/server/route-classes"

// Hono records app.use() middleware as ALL routes. These two keys are middleware, not endpoints: the central boundary
// and the knowledge routes' own guard. The embedded web interface's fallback is recorded under the same ALL /* key; the
// boundary answers the interface's static paths itself, so the fallback needs no entry.
const MIDDLEWARE_KEYS = new Set(["ALL /*", "ALL /knowledge/*"])

/** Every route the control-plane application registers, outer and per-directory, as "METHOD /path". */
function registeredKeys(): Set<string> {
  const keys = new Set<string>()
  for (const app of [Server.ControlPlaneRoutes(), InstanceRoutes()]) {
    for (const route of app.routes) keys.add(`${route.method} ${route.path}`)
  }
  return keys
}

const registered = registeredKeys()
const endpoints = [...registered].filter((key) => !MIDDLEWARE_KEYS.has(key))
const entries = ROUTE_CLASSES.map(([method, path]) => `${method} ${path}`)

describe("the action class registry covers the routes the server registers", () => {
  test("every registered route has an action class", () => {
    const unclassified = endpoints.filter((key) => !entries.includes(key))
    expect(unclassified).toEqual([])
  })

  test("no entry names a route the server does not register", () => {
    const stale = entries.filter((key) => !registered.has(key))
    expect(stale).toEqual([])
  })

  test("each route is named once", () => {
    const duplicated = entries.filter((key, index) => entries.indexOf(key) !== index)
    expect(duplicated).toEqual([])
  })

  test("the middleware keys are registered, so the exclusion is not stale", () => {
    for (const key of MIDDLEWARE_KEYS) expect(registered.has(key)).toBe(true)
  })
})
