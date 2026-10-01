// SPDX-License-Identifier: MIT
import { expect, test } from "bun:test"
import { buildClientParams } from "../src/v2/gen/core/params.gen.js"
import { createUnifiaClient } from "../src/v2/client.js"

const bodyFields = [{ args: [{ key: "config", map: "body" as const }] }]

test("ClientParams_BodyAccessor_IsReplacedWithoutInvokingItsSetter", () => {
  let called = false
  const body = Object.defineProperty({}, "extra", {
    configurable: true,
    set() {
      called = true
    },
  })
  const result = buildClientParams([{ config: body, $body_extra: 2 }], bodyFields)
  expect(called).toBe(false)
  expect(Object.getOwnPropertyDescriptor(result.body, "extra")?.value).toBe(2)
})

test("ClientParams_SealedWritableField_PreservesItsDescriptor", () => {
  const body = Object.seal({ safe: 1 })
  expect(buildClientParams([{ config: body, $body_safe: 2 }], bodyFields).body).toEqual({ safe: 2 })
  expect(Object.getOwnPropertyDescriptor(body, "safe")?.configurable).toBe(false)
})

test("ClientParams_ReadonlyField_StillRejectsTheWrite", () => {
  const body = Object.defineProperty({}, "safe", { value: 1, writable: false, configurable: true })
  expect(() => buildClientParams([{ config: body, $body_safe: 2 }], bodyFields)).toThrow()
})

test("ClientParams_ProtoExtra_PreservesBodyPrototypeAndOwnData", () => {
  const input = JSON.parse('{"config":{"safe":true},"$body___proto__":{"injected":true}}')
  const result = buildClientParams([input], bodyFields)
  expect(Object.getPrototypeOf(result.body)).toBe(Object.prototype)
  expect(Object.hasOwn(result.body as object, "__proto__")).toBe(true)
  expect((result.body as { injected?: boolean }).injected).toBeUndefined()
  expect(JSON.parse(JSON.stringify(result.body))).toEqual({ safe: true, ["__proto__"]: { injected: true } })
  expect(Object.hasOwn(Object.prototype, "injected")).toBe(false)
})

test("ClientParams_ProtoQuery_IsAnOwnKeyOnTheNullPrototypeSlot", () => {
  const result = buildClientParams([JSON.parse('{"$query___proto__":"literal"}')], [{ args: [] }])
  expect(Object.getPrototypeOf(result.query)).toBeNull()
  expect(result.query["__proto__"]).toBe("literal")
})

test("ClientParams_FrozenBody_RejectsInsteadOfSilentlyDroppingTheExtra", () => {
  expect(() => buildClientParams([{ config: Object.freeze({ safe: true }), $body_extra: 1 }], bodyFields)).toThrow()
})

test("ClientParams_RealSdkHttp_PreservesProtoAsJsonData", async () => {
  let captured: unknown
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      captured = { method: request.method, path: new URL(request.url).pathname, body: await request.json() }
      return Response.json({})
    },
  })
  try {
    const client = createUnifiaClient({ baseUrl: server.url.toString() })
    const input = JSON.parse('{"config":{"safe":true},"$body___proto__":{"injected":true}}')
    const response = await client.global.config.update(input)
    expect(response.error).toBeUndefined()
    expect(captured).toEqual({
      method: "PATCH",
      path: "/global/config",
      body: { safe: true, ["__proto__"]: { injected: true } },
    })
    expect(Object.getPrototypeOf(input.config)).toBe(Object.prototype)
  } finally {
    await server.stop(true)
  }
})
