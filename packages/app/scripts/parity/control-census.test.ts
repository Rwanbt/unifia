// SPDX-License-Identifier: MIT
import { describe, expect, test } from "bun:test"
import { scanControlCandidates } from "./control-census"

describe("control census structural coverage", () => {
  test("native and custom controls retain their original expressions", () => {
    const hits = scanControlCandidates("fixture.tsx", '<><button disabled={busy()} onClick={run}>Run</button><Soon label="Later" /></>')
    expect(hits.map((hit) => hit.tag)).toEqual(["button", "Soon"])
    expect(hits[0]?.attributes).toEqual({ disabled: "{busy()}", onClick: "{run}" })
    expect(hits[1]?.disposition).toBe("UNREVIEWED")
  })

  test("spread props and roles cannot disappear from the manifest", () => {
    const hits = scanControlCandidates("fixture.tsx", '<><div {...props} /><div role="button" onKeyDown={activate} /></>')
    expect(hits[0]?.spreads).toEqual(["props"])
    expect(hits[1]?.attributes.role).toBe('"button"')
  })

  test("conditional trees preserve both branches and line numbers", () => {
    const hits = scanControlCandidates("fixture.tsx", 'const view = ready ? <button /> :\n<a href="/help" />')
    expect(hits.map((hit) => [hit.tag, hit.line])).toEqual([["button", 1], ["a", 2]])
  })

  test("comments and string literals are not source controls", () => {
    expect(scanControlCandidates("fixture.tsx", '// <button />\nconst example = "<button />"; const view = <div />')).toEqual([])
  })

  test("lowercase namespace wrappers and special attribute names are retained", () => {
    const hits = scanControlCandidates("fixture.tsx", '<props.control __proto__="value" />')
    expect(hits[0]?.tag).toBe("props.control")
    expect(Object.keys(hits[0]!.attributes)).toEqual(["__proto__"])
  })

  test("invalid syntax fails instead of reporting incomplete coverage", () => {
    expect(() => scanControlCandidates("fixture.tsx", "const view = <button")).toThrow("fixture.tsx")
  })
})
