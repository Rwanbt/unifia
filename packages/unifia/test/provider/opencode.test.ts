// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
// Original work. No upstream derivation.

import { expect, test } from "bun:test"
import { ModelsDev } from "../../src/provider/models"
import { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

test("OpenCode_CanonicalCatalog_PreservesExternalProviderIds", async () => {
  const catalog = await ModelsDev.get()
  expect(catalog.opencode.id).toBe("opencode")
  expect(catalog["opencode-go"].id).toBe("opencode-go")
  expect(catalog.opencode.env).toEqual(["OPENCODE_API_KEY"])
  expect(catalog.unifia).toBeUndefined()
})

test("OpenCode_WithoutCredentials_AutoloadsOnlyFreeModels", async () => {
  await using tmp = await tmpdir({ config: { enabled_providers: ["opencode"] } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(Object.keys(providers)).toEqual(["opencode"])
      const provider = providers[ProviderID.opencode]
      expect(provider.options.apiKey).toBe("public")
      expect(Object.keys(provider.models).length).toBeGreaterThan(0)
      expect(Object.values(provider.models).every((model) => model.cost.input === 0)).toBe(true)
      expect(Object.values(provider.models).every((model) => model.providerID === "opencode")).toBe(true)
    },
  })
})

test("OpenCode_ConfiguredApiKey_RetainsPaidModels", async () => {
  await using tmp = await tmpdir({
    config: {
      enabled_providers: ["opencode"],
      provider: { opencode: { options: { apiKey: "test-only-key" } } },
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const provider = (await Provider.list())[ProviderID.opencode]
      expect(provider.options.apiKey).toBe("test-only-key")
      expect(Object.values(provider.models).some((model) => model.cost.input > 0)).toBe(true)
    },
  })
})

test("OpenCode_DisabledProvider_IsNotAutoloaded", async () => {
  await using tmp = await tmpdir({ config: { disabled_providers: ["opencode"] } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect((await Provider.list())[ProviderID.opencode]).toBeUndefined()
    },
  })
})

test("OpenCode_OfficialEnvironmentKey_ConnectsZenAndGo", async () => {
  await using tmp = await tmpdir({ config: { enabled_providers: ["opencode", "opencode-go"] } })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      Env.set("OPENCODE_API_KEY", "test-only-key")
      const providers = await Provider.list()
      expect(providers[ProviderID.opencode].key).toBe("test-only-key")
      expect(providers[ProviderID.make("opencode-go")].key).toBe("test-only-key")
    },
  })
})

type CapturedRequest = { url: string; authorization: string | null }

async function serve(response: Response, run: (url: string, requests: CapturedRequest[]) => Promise<void>) {
  const requests: CapturedRequest[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push({ url: request.url, authorization: request.headers.get("authorization") })
      return response.clone()
    },
  })
  try {
    await run(`${server.url.origin}/v1`, requests)
  } finally {
    server.stop(true)
  }
}

test("OpenCode_AnonymousInference_SendsPublicKeyThroughRealSdk", async () => {
  await serve(
    Response.json({
      id: "test-response",
      created: 0,
      model: "qwen3.6-plus-free",
      choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    async (url, requests) => {
      await using tmp = await tmpdir({
        config: { enabled_providers: ["opencode"], provider: { opencode: { options: { baseURL: url } } } },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = await Provider.getModel(ProviderID.opencode, ModelID.make("qwen3.6-plus-free"))
          const language = await Provider.getLanguage(model)
          const result = await language.doGenerate({
            prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
          })
          expect(result.content).toContainEqual({ type: "text", text: "OK" })
          expect(requests).toHaveLength(1)
          expect(new URL(requests[0].url).pathname).toBe("/v1/chat/completions")
          expect(requests[0].authorization).toBe("Bearer public")
        },
      })
    },
  )
})

test("OpenCode_RemoteFreeTierRefusal_RemainsAnError", async () => {
  await serve(
    Response.json(
      {
        error: { type: "FreeUsageLimitError", message: "Free models work in OpenCode" },
      },
      { status: 429 },
    ),
    async (url, requests) => {
      await using tmp = await tmpdir({
        config: { enabled_providers: ["opencode"], provider: { opencode: { options: { baseURL: url } } } },
      })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const model = await Provider.getModel(ProviderID.opencode, ModelID.make("qwen3.6-plus-free"))
          const language = await Provider.getLanguage(model)
          await expect(
            language.doGenerate({
              prompt: [{ role: "user", content: [{ type: "text", text: "Reply OK" }] }],
            }),
          ).rejects.toThrow("Free models work in OpenCode")
          expect(requests).toHaveLength(1)
        },
      })
    },
  )
})
