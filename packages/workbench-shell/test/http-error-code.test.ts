/* SPDX-License-Identifier: MIT */
/* Copyright (c) 2026 Unifia contributors */

import { expect, test } from "bun:test"
import { WorkbenchClient, WorkbenchHttpError } from "../src/index.js"

// The interface explains a failure only when it knows which one it was: the
// server's `{ error: "<CODE>" }` must reach the caller on the thrown error.
function clientAnswering(response: () => Response): WorkbenchClient {
  return new WorkbenchClient({
    baseUrl: "http://127.0.0.1:7444",
    instanceId: "instance-1",
    token: { current: () => "token", refresh: async () => "token" },
    fetchImpl: async () => response(),
  })
}

async function failureOf(client: WorkbenchClient): Promise<WorkbenchHttpError> {
  try {
    await client.request("/v1/browser/sessions", { method: "POST", body: {}, idempotencyKey: "k" })
  } catch (error) {
    if (error instanceof WorkbenchHttpError) return error
    throw error
  }
  throw new Error("the request did not fail")
}

test("WorkbenchHttpError_CarriesTheServerErrorCode", async () => {
  const error = await failureOf(clientAnswering(() => Response.json({ error: "BROWSER_HOST_UNAVAILABLE" }, { status: 503 })))
  expect(error.status).toBe(503)
  expect(error.code).toBe("BROWSER_HOST_UNAVAILABLE")
})

test("WorkbenchHttpError_HasNoCodeWhenTheBodyIsNotACodedJson", async () => {
  expect((await failureOf(clientAnswering(() => new Response("oops", { status: 500 })))).code).toBeUndefined()
  expect((await failureOf(clientAnswering(() => Response.json({ error: 42 }, { status: 400 })))).code).toBeUndefined()
})
