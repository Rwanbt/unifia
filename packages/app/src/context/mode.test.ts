import { expect, test } from "bun:test"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"
import { base64Encode } from "@unifia/util/encode"
import { modeHref, modeNavigationPath, parseModeLocation, resolveModeDirectory, routeDirectoryFromPathname, sessionSearchFromLocation } from "./mode-directory"
import { isAutomateAccessible } from "./automate-flag"

test("mode registry exposes the four navigation destinations", () => {
  expect(SHELL_MODES).toEqual(["code", "work", "design", "automate"])
})

test("mode directory decodes the route slug before native Workbench calls", () => {
  const directory = "D:/App/OpenCode/opencode-work-design"
  expect(resolveModeDirectory(base64Encode(directory))).toBe(directory)
  expect(resolveModeDirectory(undefined)).toBe("")
})

test("mode provider resolves the workspace slug without route params", () => {
  const encodedDirectory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(routeDirectoryFromPathname(`/${encodedDirectory}/work`)).toBe(encodedDirectory)
  expect(routeDirectoryFromPathname(`/${encodedDirectory}/session`)).toBe(encodedDirectory)
  expect(routeDirectoryFromPathname("/")).toBe("")
})

test("mode navigation preserves only the validated session override", () => {
  expect(sessionSearchFromLocation("?session=session-1&tab=work")).toBe("?session=session-1")
  expect(sessionSearchFromLocation("?tab=work")).toBe("")
})

test("mode navigation refuses to build a route without a workspace", () => {
  expect(modeNavigationPath("", "work", "")).toBeUndefined()
  const directory = "D:/App/OpenCode/opencode-work-design"
  expect(modeNavigationPath(directory, "design", "?session=abc")).toBe(`/${base64Encode(directory)}/design?session=abc`)
})

test("mode location maps Code path sessions through query modes and back", () => {
  const directory = "D:/App/OpenCode/opencode-work-design"
  const code = parseModeLocation(`/${base64Encode(directory)}/session/abc`)
  expect(code).toMatchObject({ kind: "workspace-root", mode: "code", sessionId: "abc" })
  const designHref = new URL(modeHref(code, "design")!, "http://localhost")
  const design = parseModeLocation(designHref.pathname, designHref.search)
  expect(design).toMatchObject({ kind: "mode", mode: "design", sessionId: "abc" })
  expect(modeHref(design, "code")).toBe(`/${base64Encode(directory)}/session/abc`)
})

test("mode location rejects unknown routes and contradictory sessions", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/unknown`)).toMatchObject({ kind: "invalid", reason: "mode" })
  expect(parseModeLocation(`/${directory}/session/path-id`, "?session=query-id")).toMatchObject({ kind: "invalid", reason: "session" })
})

test("automate is accessible only under the dev flag in a dev build", () => {
  expect(isAutomateAccessible(false, false)).toBe(false)
  expect(isAutomateAccessible(false, true)).toBe(false)
  expect(isAutomateAccessible(true, false)).toBe(false)
  expect(isAutomateAccessible(true, true)).toBe(true)
})

test("automate route resolves as unknown when the production build reaches it", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/automate`)).toMatchObject({ kind: "invalid", reason: "mode" })
  expect(parseModeLocation(`/${directory}/automate`, "", false)).toMatchObject({ kind: "invalid", reason: "mode" })
})

test("automate route resolves normally when explicitly unlocked", () => {
  const directory = base64Encode("D:/App/OpenCode/opencode-work-design")
  expect(parseModeLocation(`/${directory}/automate`, "", true)).toMatchObject({ kind: "mode", mode: "automate" })
})
