import { expect, test } from "bun:test"
import { SHELL_MODES } from "@unifia/workbench-shell/modes"
import { base64Encode } from "@unifia/util/encode"
import { modeNavigationPath, resolveModeDirectory, routeDirectoryFromPathname, sessionSearchFromLocation } from "./mode-directory"

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
