/* SPDX-License-Identifier: MIT */
import { expect, test } from "bun:test"
import z from "zod"
import {
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  createStatusCodeErrorResponseHandler,
  downloadBlob,
  validateDownloadUrl,
} from "@ai-sdk/provider-utils"

const oversizedLength = String(2 * 1024 * 1024 * 1024 + 1)
const handlers = [
  { name: "success", status: 200, body: '{"ok":true}', handler: createJsonResponseHandler(z.object({ ok: z.boolean() })) },
  {
    name: "json error",
    status: 400,
    body: '{"message":"failure"}',
    handler: createJsonErrorResponseHandler({ errorSchema: z.object({ message: z.string() }), errorToMessage: (error) => error.message }),
  },
  { name: "status error", status: 500, body: "failure", handler: createStatusCodeErrorResponseHandler() },
]

for (const scenario of handlers) {
  test(`ProviderResponse_${scenario.name}_RejectsDeclaredOversizeAndCancelsBody`, async () => {
    let cancelled = false
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(scenario.body))
        closeTimer = setTimeout(() => controller.close(), 20)
      },
      cancel() {
        cancelled = true
        clearTimeout(closeTimer)
      },
    })
    const response = new Response(body, { status: scenario.status, headers: { "content-length": oversizedLength } })
    try {
      await expect(scenario.handler({ url: "https://provider.example/response", requestBodyValues: {}, response })).rejects.toThrow("exceeded maximum size")
      expect(cancelled).toBe(true)
    } finally {
      clearTimeout(closeTimer)
      if (!body.locked) await body.cancel()
    }
  }, 3000)

  test(`ProviderResponse_${scenario.name}_AcceptsOrdinaryBody`, async () => {
    const result = await scenario.handler({
      url: "https://provider.example/response",
      requestBodyValues: {},
      response: new Response(scenario.body, { status: scenario.status }),
    })
    expect(result.value).toBeDefined()
  })
}

test("ProviderDownload_DataUrl_RemainsInlineAndBounded", async () => {
  const blob = await downloadBlob("data:text/plain;base64,aGVsbG8=", { maxBytes: 5 })
  expect(await blob.text()).toBe("hello")
  await expect(downloadBlob("data:text/plain;base64,aGVsbG8=", { maxBytes: 4 })).rejects.toThrow("exceeded maximum size")
  expect(() => validateDownloadUrl("http://127.0.0.1/private")).toThrow()
  expect(() => validateDownloadUrl("http://localhost./private")).toThrow()
  expect(() => validateDownloadUrl("file:///private")).toThrow()
})
