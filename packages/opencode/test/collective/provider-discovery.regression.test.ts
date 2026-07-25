/**
 * provider-discovery.regression.test.ts — TEAM-B05
 *
 * Non-regression gate for the TEAM-B02 migration of Debate's provider
 * discovery from a self-contained namespace
 * (src/collective/provider-discovery.ts) into a thin adapter over the
 * canonical multi-model substrate (src/multi-model/provider-discovery.ts).
 *
 * Method: this file runs the CURRENT production adapter
 * (`src/collective/provider-discovery.ts`, unmodified) side-by-side with
 * `PreB02ProviderDiscoveryOracle`, a verbatim, frozen copy of the adapter's
 * own pre-B02 implementation (see fixtures/pre-b02-provider-discovery-oracle.ts
 * for provenance — retrieved via `git show 55b47593b9:...`), against
 * IDENTICAL mocked Provider.list() / Auth.all() / credential-file /
 * CLI-subprocess inputs. Where outputs match, that is executed
 * (VERIFIED) proof of behavioural equivalence — not an assumption about
 * what the extraction "should" have preserved. Where outputs diverge,
 * this file documents the divergence explicitly, characterizes its real
 * impact by grepping/reading every current consumer, and pins the
 * CURRENT (adapter) behaviour with an assertion — so any future change
 * to that behaviour fails this suite and forces a conscious decision.
 *
 * Scope: this file deliberately covers ONLY the surface that the B02
 * migration touched — ProviderDiscovery.discover / includeJudge /
 * selectJudge and the auth-cascade + ghost-warning behaviour B02's own
 * card called out as "must preserve". It does not re-test debate rounds,
 * judge synthesis, or claim extraction — those were not touched by B01-B04
 * and are already covered by orchestrator.test.ts / synthesis-judge tests
 * / etc.
 *
 * ============================================================================
 * HEADLINE FINDING (see "KNOWN REGRESSION" describe block below):
 *
 *   The adapter's `discover()` converts `InsufficientProvidersError` from a
 *   recoverable Effect Fail (pre-B02 behaviour, confirmed via the oracle)
 *   into an unrecoverable Effect Die/defect (current behaviour). Root
 *   cause: src/collective/provider-discovery.ts:131-132 round-trips the
 *   substrate's Effect through `Effect.runPromise` and re-wraps the
 *   resulting Promise with `Effect.promise` (which by contract treats ANY
 *   rejection as a defect) instead of `Effect.tryPromise` or a native
 *   `yield*` composition. This contradicts the adapter's own header
 *   comment ("Behaviour change vs the pre-B02 implementation: NONE") and
 *   silently invalidates the typed error channel declared at
 *   orchestrator.ts:49 (`InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>`
 *   is listed as part of Effect's recoverable `E` channel, but at runtime
 *   it is not recoverable via `Effect.catch`/`catchTag`/`catchTags`).
 *
 *   Currently benign for observed callers: no code in src/collective/**
 *   or src/tool/debate.ts performs typed Effect-level recovery
 *   (`Effect.catch`, `catchTag`, `catchTags`) on
 *   ProviderDiscovery.InsufficientProvidersError — grepped and confirmed
 *   (see comment in the "KNOWN REGRESSION" block). All current consumers
 *   observe the failure only via plain JS `try/catch` around an `await`ed
 *   rejected Promise (orchestrator.test.ts, tool/debate.ts's
 *   executeWithLiveTracking), and a rejected Promise's `.catch()`/`try/catch`
 *   does not distinguish Fail from Die — so today's END-TO-END observable
 *   behaviour at the Promise boundary is unchanged (same error instance,
 *   same `.data.available/.required` payload).
 *
 *   This is nonetheless a real, executable divergence from documented
 *   "zero behavioural diff", reported per TEAM-B05's mandate to document
 *   (not fix) findings in src/collective/**. See the handoff for the full
 *   write-up.
 * ============================================================================
 */

import { Cause, Effect } from "effect"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import * as ProviderMod from "../../src/provider/provider"
import * as AuthMod from "../../src/auth"
import * as RealFsPromises from "node:fs/promises"
import * as RealChildProcess from "node:child_process"

// --------------------------------------------------------------------------------------
// Mocking harness — mirrors the proven, already-passing pattern used by
// test/multi-model/provider-discovery.integration.test.ts (B02/B03
// coverage of the substrate itself). We reuse the identical strategy here
// so the adapter and the oracle see byte-identical mocked dependencies.
// --------------------------------------------------------------------------------------

type ProviderInfo = {
  id: string
  env?: string[]
  models?: Record<string, { status?: string; cost?: { input: number; output: number } }>
}

const buildProvider = (
  id: string,
  envVars: string[],
  models: Record<string, { cost?: { input: number; output: number }; status?: string }>,
): ProviderInfo => ({ id, env: envVars, models })

const mockProviderList = (list: Record<string, ProviderInfo>) => {
  mock.module("../../src/provider/provider", () => ({ Provider: { list: async () => list } }))
}

const mockAuthAll = (entries: Record<string, unknown>) => {
  mock.module("../../src/auth", () => ({ Auth: { all: async () => entries } }))
}

const mockCredentialFile = (content: string | null) => {
  mock.module("node:fs/promises", () => ({
    readFile: async () => {
      if (content === null) throw new Error("ENOENT: no such file")
      return content
    },
  }))
}

const mockCliAuth = (succeeds: boolean) => {
  mock.module("node:child_process", () => ({
    execFileSync: () => {
      if (!succeeds) throw new Error("ENOENT: no such binary")
      return Buffer.from("")
    },
  }))
}

const resetMocks = () => {
  mock.module("../../src/provider/provider", () => ProviderMod)
  mock.module("../../src/auth", () => AuthMod)
  mock.module("node:fs/promises", () => RealFsPromises)
  mock.module("node:child_process", () => RealChildProcess)
}

// Bun caches ES modules; every test gets a cache-busted fresh import of
// BOTH the adapter and the oracle so each test's mock.module() calls (set
// up before this beforeEach body runs, inside each `test()`) take effect.
// Because the adapter, its production dependency (multi-model/provider-discovery.ts)
// and the oracle all reference Provider/Auth/fs/child_process by the SAME
// resolved absolute path, mock.module's registry-level replacement reaches
// all of them once re-imported.
let ProviderDiscovery: typeof import("../../src/collective/provider-discovery").ProviderDiscovery
let Oracle: typeof import("./fixtures/pre-b02-provider-discovery-oracle").PreB02ProviderDiscoveryOracle

async function loadFresh() {
  const bust = crypto.randomUUID()
  const adapterMod = await import(`../../src/collective/provider-discovery?bust=${bust}`)
  ProviderDiscovery = adapterMod.ProviderDiscovery
  const oracleMod = await import(`./fixtures/pre-b02-provider-discovery-oracle?bust=${bust}`)
  Oracle = oracleMod.PreB02ProviderDiscoveryOracle
}

afterEach(() => resetMocks())

// ============================================================================
// SECTION 1 — cascade discovery: oracle vs adapter, byte-for-byte
// ============================================================================

describe("discover() cascade — adapter matches pre-B02 oracle exactly", () => {
  test("env-var auth: 2 providers, identical shape (providerID/modelID/authMethod/cost)", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "test-anthropic"
    process.env.FAKE_OPENAI_KEY = "test-openai"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      expect(adapterResult.ghostWarnings).toEqual(oracleResult.ghostWarnings)
      expect(adapterResult.providers.every((p) => p.authMethod === "api_key")).toBe(true)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("stored-auth fallback (env absent, Auth.all() present): identical shape", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({
      anthropic: { type: "api", key: "stored-anthropic-key" },
      openai: { type: "api", key: "stored-openai-key" },
    })
    await loadFresh()

    const oracleResult = await Effect.runPromise(Oracle.discover())
    const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
    expect(adapterResult.providers).toEqual(oracleResult.providers)
    expect(adapterResult.providers.every((p) => p.authMethod === "api_key")).toBe(true)
  })

  test("credential-file auth (anthropic, ~/.claude/.credentials.json extractor): identical shape", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_ENV_UNSET"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCredentialFile(JSON.stringify({ claudeAiOauth: { accessToken: "cred-token-xyz" } }))
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const anthropic = adapterResult.providers.find((p) => p.providerID === ("anthropic" as never))
      expect(anthropic?.authMethod).toBe("credential_file")
      // credential_file entries never carry a cost field (pre- and post-extraction).
      expect(anthropic).not.toHaveProperty("cost")
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("credential-file extractor returns null (malformed JSON) -> falls through, no crash", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_ENV_UNSET"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCredentialFile("not valid json {{{")
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleExit = await Effect.runPromiseExit(Oracle.discover())
      const adapterExit = await Effect.runPromiseExit(ProviderDiscovery.discover())
      // Only openai discoverable (anthropic's credential file is unusable) -> both fail
      // with InsufficientProvidersError(available=1).
      expect(oracleExit._tag).toBe("Failure")
      expect(adapterExit._tag).toBe("Failure")
      if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
        const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
        const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
          typeof ProviderDiscovery.InsufficientProvidersError
        >
        expect(adapterErr.data).toEqual(oracleErr.data)
      }
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("cli-subprocess auth (google, no credential-file config for google): identical shape", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_UNSET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    mockCliAuth(true)
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const google = adapterResult.providers.find((p) => p.providerID === ("google" as never))
      expect(google?.authMethod).toBe("cli_subprocess")
      expect(google).not.toHaveProperty("cost")
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
    }
  })

  test("cli-subprocess auth fails (binary not found) -> provider skipped, no crash, identical shape", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_UNSET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_ENV_SET"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
      mistral: buildProvider("mistral", ["FAKE_MISTRAL_ENV_SET"], {
        "mistral-large-latest": { cost: { input: 1, output: 3 } },
      }),
    })
    mockAuthAll({})
    mockCliAuth(false)
    await loadFresh()

    process.env.FAKE_OPENAI_ENV_SET = "1"
    process.env.FAKE_MISTRAL_ENV_SET = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      // google (cli_subprocess only) must be absent — the mocked CLI always fails.
      expect(adapterResult.providers.find((p) => p.providerID === ("google" as never))).toBeUndefined()
      expect(adapterResult.providers).toHaveLength(2)
    } finally {
      delete process.env.FAKE_OPENAI_ENV_SET
      delete process.env.FAKE_MISTRAL_ENV_SET
    }
  })

  test("ghost-model audit (deprecated status): identical warnings", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "claude-sonnet-4-20250514": { cost: { input: 3, output: 15 }, status: "deprecated" },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "1"
    process.env.FAKE_OPENAI_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.ghostWarnings).toEqual(oracleResult.ghostWarnings)
      expect(adapterResult.ghostWarnings).toHaveLength(1)
      expect(adapterResult.ghostWarnings[0]?.reason).toMatch(/deprecated/)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("unknown modelID in PREFERRED_MODELS -> resolver falls back to first available model, identical", async () => {
    mockProviderList({
      anthropic: buildProvider("anthropic", ["FAKE_ANTHROPIC_KEY"], {
        "some-other-anthropic-model": { cost: { input: 1, output: 1 } },
      }),
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_ANTHROPIC_KEY = "1"
    process.env.FAKE_OPENAI_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      const anthropic = adapterResult.providers.find((p) => p.providerID === ("anthropic" as never))
      expect(anthropic?.modelID).toBe("some-other-anthropic-model" as never)
    } finally {
      delete process.env.FAKE_ANTHROPIC_KEY
      delete process.env.FAKE_OPENAI_KEY
    }
  })

  test("provider unknown to registry (present in env, absent from Provider.list) -> silently skipped, identical", async () => {
    mockProviderList({
      openai: buildProvider("openai", ["FAKE_OPENAI_KEY"], {
        "gpt-4.1": { cost: { input: 2, output: 8 } },
      }),
      mistral: buildProvider("mistral", ["FAKE_MISTRAL_KEY"], {
        "mistral-large-latest": { cost: { input: 1, output: 3 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_GOOGLE_KEY = "1" // not consulted; google absent from Provider.list
    process.env.FAKE_OPENAI_KEY = "1"
    process.env.FAKE_MISTRAL_KEY = "1"
    try {
      const oracleResult = await Effect.runPromise(Oracle.discover())
      const adapterResult = await Effect.runPromise(ProviderDiscovery.discover())
      expect(adapterResult.providers).toEqual(oracleResult.providers)
      expect(adapterResult.providers.find((p) => p.providerID === ("google" as never))).toBeUndefined()
    } finally {
      delete process.env.FAKE_GOOGLE_KEY
      delete process.env.FAKE_OPENAI_KEY
      delete process.env.FAKE_MISTRAL_KEY
    }
  })
})

// ============================================================================
// SECTION 2 — includeJudge / selectJudge: oracle vs adapter
// ============================================================================

describe("includeJudge() — pure function, oracle vs adapter", () => {
  test("prepends a judge not already present — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleResult = Oracle.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    const adapterResult = ProviderDiscovery.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    expect(adapterResult.map((p) => ({ providerID: p.providerID, modelID: p.modelID, role: p.role }))).toEqual(
      oracleResult.map((p) => ({ providerID: p.providerID, modelID: p.modelID, role: p.role })),
    )
  })

  test("does not duplicate an existing participant — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-judge" as never, modelID: "model-judge" as never, authMethod: "api_key" as const },
    ]
    const oracleResult = Oracle.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    const adapterResult = ProviderDiscovery.includeJudge(base, "provider-judge" as never, "model-judge" as never)
    expect(adapterResult).toHaveLength(1)
    expect(oracleResult).toHaveLength(1)
  })

  test("no judge args -> passthrough unchanged — identical result", async () => {
    await loadFresh()
    const base = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    expect(ProviderDiscovery.includeJudge(base)).toEqual(Oracle.includeJudge(base))
  })
})

describe("selectJudge() — oracle vs adapter, mocked Provider/Auth", () => {
  test("explicit judge wins — identical result", async () => {
    await loadFresh()
    const participants = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleJudge = await Effect.runPromise(
      Oracle.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    const adapterJudge = await Effect.runPromise(
      ProviderDiscovery.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    expect({ providerID: adapterJudge.providerID, modelID: adapterJudge.modelID, role: adapterJudge.role }).toEqual({
      providerID: oracleJudge.providerID,
      modelID: oracleJudge.modelID,
      role: oracleJudge.role,
    })
  })

  test("heuristic loop: first unused PREFERRED_MODELS entry with auth — identical result", async () => {
    mockProviderList({
      google: buildProvider("google", ["FAKE_GOOGLE_ENV_SET"], {
        "gemini-2.5-pro": { cost: { input: 1, output: 2 } },
      }),
    })
    mockAuthAll({})
    await loadFresh()

    process.env.FAKE_GOOGLE_ENV_SET = "1"
    try {
      const participants = [
        {
          providerID: "anthropic" as never,
          modelID: "claude-sonnet-4-20250514" as never,
          authMethod: "api_key" as const,
        },
      ]
      const oracleJudge = await Effect.runPromise(Oracle.selectJudge(participants))
      const adapterJudge = await Effect.runPromise(ProviderDiscovery.selectJudge(participants))
      expect({
        providerID: adapterJudge.providerID,
        modelID: adapterJudge.modelID,
        role: adapterJudge.role,
      }).toEqual({ providerID: oracleJudge.providerID, modelID: oracleJudge.modelID, role: oracleJudge.role })
      expect(adapterJudge.providerID).toBe("google" as never)
    } finally {
      delete process.env.FAKE_GOOGLE_ENV_SET
    }
  })

  test("fallback: strongest (highest output cost) participant when no PREFERRED_MODELS slot free — identical result", async () => {
    mockProviderList({}) // nothing available -> heuristic loop finds nothing
    mockAuthAll({})
    await loadFresh()

    const participants = [
      { providerID: "cheap" as never, modelID: "cheap-model" as never, authMethod: "api_key" as const, cost: { input: 1, output: 1 } },
      { providerID: "expensive" as never, modelID: "expensive-model" as never, authMethod: "api_key" as const, cost: { input: 1, output: 99 } },
    ]
    const oracleJudge = await Effect.runPromise(Oracle.selectJudge(participants))
    const adapterJudge = await Effect.runPromise(ProviderDiscovery.selectJudge(participants))
    expect(adapterJudge.providerID).toBe(oracleJudge.providerID)
    expect(adapterJudge.providerID).toBe("expensive" as never)
  })
})

// ============================================================================
// SECTION 3 — characterized, non-blocking cosmetic divergences
//
// These ARE real shape differences between the oracle and the adapter,
// discovered by direct comparison. Both are pinned here with an
// explanation of why they do not affect any current Debate consumer
// (verified by reading every call site — see comments).
// ============================================================================

describe("characterized divergence: explicit-participant 'role' key presence", () => {
  test("oracle always has a 'role' OWN PROPERTY (possibly undefined); adapter omits it when absent", async () => {
    await loadFresh()
    const oracleResult = await Effect.runPromise(
      Oracle.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )
    const adapterResult = await Effect.runPromise(
      ProviderDiscovery.discover([
        { providerID: "provider-a", modelID: "model-a" },
        { providerID: "provider-b", modelID: "model-b" },
      ]),
    )

    // The divergence, pinned:
    expect("role" in oracleResult.providers[0]!).toBe(true)
    expect("role" in adapterResult.providers[0]!).toBe(false)

    // Why it's safe: JSON-serialized shape is identical (JSON.stringify
    // drops undefined-valued keys either way) ...
    expect(JSON.stringify(adapterResult.providers[0])).toBe(JSON.stringify(oracleResult.providers[0]))
    // ... and `toEqual` (used throughout this suite and by
    // budget-tracker.ts's `p.cost ?? getDefaultCost(...)` /
    // orchestrator.ts's `"cost" in a && a.cost` reads on the COST field,
    // not role) treats an absent key and an own key with value `undefined`
    // as equivalent.
    expect(adapterResult.providers[0]).toEqual(oracleResult.providers[0])

    // Verified by reading every consumer (src/collective/orchestrator.ts):
    // the `role` field on a raw ProviderDiscovery.discover() participant is
    // NEVER read directly — orchestrator.ts builds its own
    // Collective.Participant.role from RoleAssigner.assign()'s output
    // (`role: roles[i]`), not from `d.role`. The only place a discovered
    // participant's `.role` is read is the judge entry appended by
    // includeJudge()/selectJudge(), which BOTH oracle and adapter set
    // explicitly to the literal "judge" (always present, non-undefined) —
    // unaffected by this divergence.
  })
})

describe("characterized divergence: judge object key insertion order", () => {
  test("selectJudge's returned object has different key order (role before/after authMethod) but equal value", async () => {
    await loadFresh()
    const participants = [
      { providerID: "provider-a" as never, modelID: "model-a" as never, authMethod: "api_key" as const },
    ]
    const oracleJudge = await Effect.runPromise(
      Oracle.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    const adapterJudge = await Effect.runPromise(
      ProviderDiscovery.selectJudge(participants, "explicit-provider" as never, "explicit-model" as never),
    )
    // Key order differs (oracle: providerID, modelID, role, authMethod;
    // adapter: providerID, modelID, authMethod, role) -> JSON.stringify
    // strings are NOT byte-identical, but structural equality holds and no
    // consumer depends on JSON key order (Debate never JSON.stringify's a
    // judge object for a checksum/hash — only for human-readable logs via
    // Log.create(), which uses util.inspect-style formatting, not raw
    // JSON.stringify comparison).
    expect(JSON.stringify(adapterJudge) === JSON.stringify(oracleJudge)).toBe(false)
    expect(adapterJudge).toEqual(oracleJudge)
  })
})

// ============================================================================
// SECTION 4 — insufficient-providers error: payload equality + KNOWN REGRESSION
// ============================================================================

describe("InsufficientProvidersError — payload equality (available/required)", () => {
  test("explicit path, 1 unique participant: identical error data on both sides", async () => {
    await loadFresh()
    const oracleExit = await Effect.runPromiseExit(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    const adapterExit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(oracleExit._tag).toBe("Failure")
    expect(adapterExit._tag).toBe("Failure")
    if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
      const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
      const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
        typeof ProviderDiscovery.InsufficientProvidersError
      >
      expect(adapterErr).toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
      expect(adapterErr.data).toEqual({ available: 1, required: 2 })
      expect(adapterErr.data).toEqual(oracleErr.data)
    }
  })

  test("cascade path, 0 providers available: identical error data on both sides", async () => {
    mockProviderList({})
    mockAuthAll({})
    await loadFresh()

    const oracleExit = await Effect.runPromiseExit(Oracle.discover())
    const adapterExit = await Effect.runPromiseExit(ProviderDiscovery.discover())
    expect(oracleExit._tag).toBe("Failure")
    expect(adapterExit._tag).toBe("Failure")
    if (oracleExit._tag === "Failure" && adapterExit._tag === "Failure") {
      const oracleErr = Cause.squash(oracleExit.cause) as InstanceType<typeof Oracle.InsufficientProvidersError>
      const adapterErr = Cause.squash(adapterExit.cause) as InstanceType<
        typeof ProviderDiscovery.InsufficientProvidersError
      >
      expect(adapterErr.data).toEqual({ available: 0, required: 2 })
      expect(adapterErr.data).toEqual(oracleErr.data)
    }
  })

  test("Promise-boundary behaviour (.rejects.toBeInstanceOf) is unchanged — matches every current caller's error handling", async () => {
    // orchestrator.test.ts and tool/debate.ts's executeWithLiveTracking
    // both observe ProviderDiscovery.discover() failures ONLY via a
    // rejected Promise (plain try/catch / .catch()) — never via
    // Effect.catchTag/catchAll. This is the one guarantee that actually
    // matters for today's runtime behaviour, and it holds:
    await loadFresh()
    await expect(
      Effect.runPromise(ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }])),
    ).rejects.toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)
  })
})

describe("KNOWN REGRESSION — adapter converts InsufficientProvidersError from a recoverable Fail into an unrecoverable Die", () => {
  // See the file-header comment for full context. This block PINS today's
  // actual (regressed) behaviour with executable assertions so any future
  // change to it is caught by this suite. It does not fail the suite —
  // the finding is reported in the TEAM-B05 handoff, not "fixed" here
  // (src/collective/** is out of scope for this card).

  test("oracle (pre-B02): InsufficientProvidersError is a recoverable Effect Fail", async () => {
    await loadFresh()
    const exit = await Effect.runPromiseExit(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    expect(Cause.hasFails(exit.cause)).toBe(true)
    expect(Cause.hasDies(exit.cause)).toBe(false)

    // Because it's a genuine Fail, Effect's typed recovery combinators
    // (Effect.catch / catchTag / catchTags) CAN intercept it without the
    // caller crashing:
    const recovered = await Effect.runPromise(
      Oracle.discover([{ providerID: "provider-a", modelID: "model-a" }]).pipe(
        Effect.catch(() => Effect.succeed("recovered" as const)),
      ),
    )
    expect(recovered).toBe("recovered")
  })

  test("adapter (current, post-B02): InsufficientProvidersError is an UNRECOVERABLE Effect Die (defect)", async () => {
    await loadFresh()
    const exit = await Effect.runPromiseExit(
      ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]),
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return
    // The regression: hasFails is now false, hasDies is now true — the
    // exact inverse of the oracle's cause shape for the identical input.
    expect(Cause.hasFails(exit.cause)).toBe(false)
    expect(Cause.hasDies(exit.cause)).toBe(true)

    // Cause.squash() still unwraps to the right error TYPE (which is why
    // `.rejects.toBeInstanceOf(...)` above still passes) — the class
    // identity survives, only its recoverability does not.
    expect(Cause.squash(exit.cause)).toBeInstanceOf(ProviderDiscovery.InsufficientProvidersError)

    // Effect.catch can no longer recover it — the effect DIES instead of
    // being handled, unlike the oracle above. This is the concrete,
    // executable proof of the divergence: identical input, identical
    // `.pipe(Effect.catch(...))` composition, different outcome.
    let threw = false
    try {
      await Effect.runPromise(
        ProviderDiscovery.discover([{ providerID: "provider-a", modelID: "model-a" }]).pipe(
          Effect.catch(() => Effect.succeed("recovered" as const)),
        ),
      )
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })

  // Root cause, located precisely (do not fix — src/collective/** is
  // frozen for this card):
  //   src/collective/provider-discovery.ts:131-132
  //     const result = yield* Effect.promise(() =>
  //       Effect.runPromise(discoverAvailableProviders(explicitNorm, maxProviders)),
  //     )
  //   `Effect.promise` treats ANY rejection of its executor's Promise as
  //   a defect by contract (it is documented for Promises that are
  //   "guaranteed" not to fail). Since discoverAvailableProviders can
  //   genuinely Fail (InsufficientProvidersError), and that Fail becomes a
  //   Promise rejection via the inner Effect.runPromise, the outer
  //   Effect.promise reclassifies it as a Die. The substrate itself
  //   (src/multi-model/provider-discovery.ts) is NOT at fault — it raises
  //   a proper Effect.fail(...), verified by
  //   test/multi-model/provider-discovery.integration.test.ts's Cause
  //   inspection (`cause.reasons?.[0]?.toJSON?.()`, a Fail-shaped Cause).
  //
  //   Contradicts the adapter's own header claim: "Behaviour change vs the
  //   pre-B02 implementation: NONE" (src/collective/provider-discovery.ts:27).
  //   Also silently invalidates the typed error channel declared at
  //   src/collective/orchestrator.ts:49
  //   (`InstanceType<typeof ProviderDiscovery.InsufficientProvidersError>`
  //   listed as part of `run`'s recoverable Effect<...> error type `E`,
  //   which is no longer true at runtime for this specific error).
  //
  //   Currently benign in practice: grepped every src/collective/** and
  //   src/tool/debate.ts call site — none of them use
  //   Effect.catch/catchTag/catchTags/catchCause around
  //   ProviderDiscovery.discover() or Orchestrator.run(); all current
  //   consumers only observe the failure via a rejected Promise at an
  //   `await`/`.catch()` boundary (orchestrator.test.ts,
  //   tool/debate.ts's executeWithLiveTracking's try/catch), which does
  //   not distinguish Fail from Die. See "Promise-boundary behaviour" test
  //   above for the executed proof that this specific observable path is
  //   unaffected.
})
