/* SPDX-License-Identifier: MIT */
import { describe, it, expect } from "bun:test"
import { cosine, BruteForceIndex } from "../../src/knowledge/semantic/vector.js"
import {
  scoreEmbeddingModel,
  selectBestModel,
} from "../../src/knowledge/semantic/embedding.js"
import {
  classifySource,
  mapStackSource,
} from "../../src/knowledge/stack/mapping.js"
import {
  scanForSecrets,
  GitProvider,
} from "../../src/knowledge/git/provider.js"
import {
  McpKnowledgeServer,
  McpOversizedPayload,
  McpRateLimitExceeded,
} from "../../src/knowledge/mcp/server.js"
import {
  STORAGE_MATRIX_TEMPLATE,
  canManagedWrite,
} from "../../src/knowledge/mobile/storage.js"
import { DefaultKnowledgeService } from "../../src/knowledge/facade/service.js"
import {
  SourceRegistry,
  PersonalSource,
  type KnowledgeSource,
  type ListOptions,
  type ListedNote,
  type SourceEvent,
} from "../../src/knowledge/source/index.js"
import type { KnowledgeSpaceKind } from "@unifia/contracts/knowledge"

const VALID_UUID = "0190d2c0-7b00-7000-8000-000000000001"

function makeSource(kind: KnowledgeSpaceKind, id: string, notes: ListedNote[]): KnowledgeSource {
  return {
    space: { kind, id, label: id },
    list: async (_opts: ListOptions) => notes,
    read: async () => null,
    watch: (_onChange: (e: SourceEvent) => void) => () => undefined,
  }
}

describe("P5 vector + embedding scoring", () => {
  it("cosine of identical vectors is 1", () => {
    const v = new Float32Array([1, 0, 0])
    expect(cosine(v, v)).toBeCloseTo(1, 6)
  })
  it("cosine of orthogonal vectors is 0", () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosine(a, b)).toBe(0)
  })
  it("BruteForceIndex returns topK", () => {
    const idx = new BruteForceIndex()
    idx.add({ id: "0190d2c0-7b00-7000-8000-000000000001", locator: "a.md", vector: new Float32Array([1, 0]) })
    idx.add({ id: "0190d2c0-7b00-7000-8000-000000000002", locator: "b.md", vector: new Float32Array([0, 1]) })
    const hits = idx.query({ vector: new Float32Array([1, 0]), topK: 1 })
    expect(hits).toHaveLength(1)
    expect(hits[0]?.id).toBe("0190d2c0-7b00-7000-8000-000000000001")
  })
  it("selectBestModel picks the highest score", () => {
    const best = selectBestModel([
      { modelId: "x", quality: 0.5, latencyMs: 100, peakRamMiB: 200, sizeMiB: 100, simplicity: 0.5 },
      { modelId: "y", quality: 0.9, latencyMs: 200, peakRamMiB: 200, sizeMiB: 100, simplicity: 0.5 },
    ])
    expect(best?.modelId).toBe("y")
  })
  it("selectBestModel returns null on empty", () => {
    expect(selectBestModel([])).toBeNull()
  })
})

describe("P6 stack mapping", () => {
  it("classifies AGENTS.md", () => {
    expect(classifySource("AGENTS.md")).toBe("AGENTS.md")
  })
  it("classifies an ADR", () => {
    expect(classifySource("0001-foo.md")).toBe("ADR")
    expect(classifySource("0025-bar.md")).toBe("ADR")
  })
  it("classifies a failure pattern", () => {
    expect(classifySource("KNOWN_FAILURE_PATTERNS.md")).toBe("FAILURE_PATTERN")
  })
  it("maps a stack source to a StackMapping", () => {
    const m = mapStackSource(
      { kind: "AGENTS.md", path: "AGENTS.md", content: "x".repeat(100) },
      VALID_UUID,
    )
    expect(m.type).toBe("procedure")
    expect(m.lifecycle).toBe("active")
    expect(m.tags).toContain("source:agents-md")
  })
  it("truncates very long bodies", () => {
    const big = "x".repeat(200_000)
    const m = mapStackSource(
      { kind: "AGENTS.md", path: "AGENTS.md", content: big },
      VALID_UUID,
    )
    expect(m.body.length).toBeLessThan(big.length)
    expect(m.body).toContain("truncated")
  })
})

describe("P8 git provider", () => {
  it("detects an OpenAI key", () => {
    const hits = scanForSecrets([
      { locator: "a.md", commit: "abc", content: "sk-abcdefghijklmnopqrstuv" },
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0]?.kind).toBe("openai_anthropic_key")
  })
  it("returns no hit for plain text", () => {
    const hits = scanForSecrets([
      { locator: "a.md", commit: "abc", content: "Just some prose." },
    ])
    expect(hits).toHaveLength(0)
  })
  it("GitProvider autoPush defaults to false", () => {
    const g = new GitProvider()
    expect(g.getAutoPush()).toBe(false)
  })
  it("prepushScan returns ok=true when no secret", async () => {
    const g = new GitProvider()
    const r = await g.prepushScan(
      { from: "a", to: "b", touchedLocators: ["x.md"] },
      [{ locator: "x.md", commit: "abc", content: "no secrets here" }],
    )
    expect(r.ok).toBe(true)
  })
  it("prepushScan returns ok=false when secret present", async () => {
    const g = new GitProvider()
    const r = await g.prepushScan(
      { from: "a", to: "b", touchedLocators: ["x.md"] },
      [{ locator: "x.md", commit: "abc", content: "AKIAIOSFODNN7EXAMPLE" }],
    )
    expect(r.ok).toBe(false)
  })
})

describe("P9 MCP server", () => {
  const plan = { providerId: "x", defaultRestriction: "allow" as const }
  function newService() {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [])))
    return new DefaultKnowledgeService(reg, { providerPlan: plan })
  }
  function newServer() {
    return new McpKnowledgeServer(newService(), {
      rateLimitPerMinute: 100,
      maxRequestBytes: 64 * 1024,
      maxResponseBytes: 64 * 1024,
      workspace: "ws-1",
    })
  }

  it("exposes six capabilities", () => {
    expect(newServer().capabilities()).toHaveLength(6)
  })

  it("throws on oversized payload", async () => {
    const s = newServer()
    const big = "x".repeat(100_000)
    await expect(
      s.search({ workspace: "ws-1", query: "x", maxCandidates: 1, maxPayloadBytes: 1, maxSnippetBytes: 1, deadlineMs: 1000, spaces: [], types: [], tags: [big] }),
    ).rejects.toBeInstanceOf(McpOversizedPayload)
  })

  it("throws on rate limit", async () => {
    const s = new McpKnowledgeServer(newService(), {
      rateLimitPerMinute: 2,
      maxRequestBytes: 1024,
      maxResponseBytes: 1024,
      workspace: "ws-1",
    })
    await s.search({ workspace: "ws-1", query: "x", maxCandidates: 1, maxPayloadBytes: 1, maxSnippetBytes: 1, deadlineMs: 1000, spaces: [], types: [], tags: [] })
    await s.search({ workspace: "ws-1", query: "x", maxCandidates: 1, maxPayloadBytes: 1, maxSnippetBytes: 1, deadlineMs: 1000, spaces: [], types: [], tags: [] })
    await expect(
      s.search({ workspace: "ws-1", query: "x", maxCandidates: 1, maxPayloadBytes: 1, maxSnippetBytes: 1, deadlineMs: 1000, spaces: [], types: [], tags: [] }),
    ).rejects.toBeInstanceOf(McpRateLimitExceeded)
  })
})

describe("P10 storage matrix", () => {
  it("template lists 4 storage kinds", () => {
    expect(STORAGE_MATRIX_TEMPLATE).toHaveLength(4)
  })
  it("canManagedWrite requires all 5 capabilities", () => {
    expect(canManagedWrite({
      kind: "app_private",
      available: true,
      capabilities: ["read", "write", "fsync", "lock", "atomic", "recover"],
      notes: "ok",
    })).toBe(true)
    expect(canManagedWrite({
      kind: "app_private",
      available: true,
      capabilities: ["read", "write", "fsync", "lock", "atomic"],
      notes: "missing recover",
    })).toBe(false)
  })
  it("canManagedWrite requires available=true", () => {
    expect(canManagedWrite({
      kind: "app_private",
      available: false,
      capabilities: ["read", "write", "fsync", "lock", "atomic", "recover"],
      notes: "not available",
    })).toBe(false)
  })
})

describe("P7 facade", () => {
  it("DefaultKnowledgeService.status returns the six capabilities", async () => {
    const reg = new SourceRegistry()
    reg.register(new PersonalSource({ spaceId: "p" }, makeSource("personal", "p", [])))
    const svc = new DefaultKnowledgeService(reg, {
      providerPlan: { providerId: "x", defaultRestriction: "allow" },
    })
    const status = await svc.status()
    expect(status.capabilities).toHaveLength(6)
  })
})
