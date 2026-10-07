// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Unifia contributors
//
// Original work. No upstream derivation.

/**
 * CR01 / issue #77 — a session must not stay stuck after Stop on a
 * never-ending generation.
 *
 * The user-visible contract has two halves and the bug broke both at once:
 *
 *   1. Stop reaches `idle` in bounded time. The Stop button is what the user
 *      holds when a generation never ends on its own, so "bounded" is the
 *      whole requirement: an unbounded cancel is indistinguishable from a
 *      frozen app.
 *   2. The next prompt in the SAME session runs. Cancel only resets the
 *      runner; the session, its runner and its provider stream must all be
 *      reusable afterwards.
 *
 * `llm.hang` is a generation that sends its role chunk and then holds the
 * stream open forever (`test/lib/llm-server.ts`, `Stream.never`), which is
 * the fake never-ending generation the card asks for. The test waits for the
 * exact prompt to reach the provider before pressing Stop, so it interrupts
 * an in-flight request instead of merely cancelling a queued one — cancelling
 * before the request is issued is a different scenario and a different code
 * path.
 *
 * Layer setup mirrors `test/session/prompt-effect.test.ts` (see also
 * `snapshot-tool-race.test.ts`); it is duplicated rather than shared so this
 * regression stays attached to its own reproducer.
 */
import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { FileTime } from "../../src/file/time"
import { AppFileSystem } from "../../src/filesystem"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { Todo } from "../../src/session/todo"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { Log } from "../../src/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    toolsForAgent: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
    removeAuth: () => Effect.void,
    remove: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    warmup: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    completion: () => Effect.succeed([]),
    rename: () => Effect.succeed({ changes: {} }),
    codeAction: () => Effect.succeed([]),
    executeCommand: () => Effect.succeed(null),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => Effect.promise(fn),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    filetime,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provideMerge(deps),
    ),
  )
}

const it = testEffect(makeHttp())

const providerCfg = (url: string) => ({
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: url,
      },
    },
  },
})

/**
 * Wait until a request carrying `needle` actually reached the provider.
 * Counting hits is not enough: a title request also counts, and cancelling
 * before the real request is issued exercises a different path.
 */
function waitForProviderRequest(llm: TestLLMServer["Service"], needle: string) {
  return Effect.gen(function* () {
    const deadline = Date.now() + 20_000
    while (true) {
      const hits = yield* llm.hits
      if (hits.some((hit) => JSON.stringify(hit.body).includes(needle))) return
      if (Date.now() > deadline) throw new Error(`no provider request carried ${JSON.stringify(needle)}`)
      yield* Effect.sleep(20)
    }
  })
}

function describe(exit: Exit.Exit<unknown, unknown>) {
  return Exit.isSuccess(exit) ? "success" : Cause.pretty(exit.cause)
}

const openSession = Effect.fnUntraced(function* () {
  const sessions = yield* Session.Service
  return yield* sessions.create({
    title: "Stuck",
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  })
})

const say = Effect.fnUntraced(function* (sessionID: SessionID, text: string) {
  const prompt = yield* SessionPrompt.Service
  yield* prompt.prompt({ sessionID, agent: "build", noReply: true, parts: [{ type: "text", text }] })
})

it.live(
  "stop on a never-ending generation reaches idle and the next prompt runs",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessionStatus = yield* SessionStatus.Service
        const session = yield* openSession()

        // A generation that never ends by itself.
        yield* llm.hang
        yield* say(session.id, "never-ending generation")

        const first = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
        yield* waitForProviderRequest(llm, "never-ending generation")
        expect((yield* sessionStatus.get(session.id)).type).toBe("busy")

        // 1. Stop reaches idle in bounded time.
        const cancelled = yield* prompt.cancel(session.id).pipe(Effect.timeout("15 seconds"), Effect.exit)
        expect(describe(cancelled)).toBe("success")

        const firstExit = yield* Fiber.await(first).pipe(Effect.timeout("15 seconds"), Effect.exit)
        expect(describe(firstExit)).toBe("success")
        expect((yield* sessionStatus.get(session.id)).type).toBe("idle")

        // 2. The next prompt in the same session runs.
        yield* llm.text("recovered after stop")
        yield* say(session.id, "second prompt")

        const second = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.timeout("30 seconds"), Effect.exit)
        expect(describe(second)).toBe("success")
        if (!Exit.isSuccess(second)) return
        expect(second.value.info.role).toBe("assistant")
        if (second.value.info.role === "assistant") {
          expect(second.value.parts.some((part) => part.type === "text" && part.text === "recovered after stop")).toBe(
            true,
          )
        }
        expect((yield* sessionStatus.get(session.id)).type).toBe("idle")
      }),
      { git: true, config: providerCfg },
    ),
  90_000,
)

/**
 * #77 as a person performs it: Stop, then submit again straight away.
 *
 * The composer flips back to "Send" on client state alone, so the window
 * between "Stop was pressed" and "the server-side run has finished winding
 * down" is open to the user. A prompt that lands inside it must still be
 * executed rather than absorbed by the run that is finishing.
 *
 * This was a real, measured failure, not a flaky one.
 * `SessionPrompt.loop` called `Runner.ensureRunning`, whose `Running` branch
 * returns the in-flight run's result and never starts the caller's work
 * (`src/effect/runner.ts:111-139`). So the second prompt was silently dropped:
 * `loop` returned SUCCESS carrying the previous run's message, no error was
 * raised, and the queued reply was never consumed. Measured red before the fix:
 * `llm.pending` expected 0, received 1.
 *
 * Fixed in `loop` (`src/session/prompt.ts`), which now re-asks for a run while
 * the newest message is an unanswered user prompt, bounded by
 * `LOOP_DRAIN_LIMIT`. The runner itself is untouched on purpose: its
 * `ShellThenRun` semantics are shared with `startShell`, so giving the
 * `Running` branch a different meaning there would reach well beyond this bug.
 * See `docs/autonomy/rc0/journal-B.md` (B1) and issue #77.
 */
it.live(
  "a prompt submitted right after stop is executed, not swallowed by the finishing run",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const session = yield* openSession()

        yield* llm.hang
        yield* say(session.id, "never-ending generation")

        const first = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.forkChild)
        yield* waitForProviderRequest(llm, "never-ending generation")

        // Stop, and do NOT wait for it to finish: submit the next prompt the
        // way the UI allows, while the interrupted run is still winding down.
        yield* prompt.cancel(session.id).pipe(Effect.forkChild)

        yield* llm.text("recovered after stop")
        yield* say(session.id, "second prompt")

        const second = yield* prompt.loop({ sessionID: session.id }).pipe(Effect.timeout("30 seconds"), Effect.exit)
        yield* Fiber.await(first).pipe(Effect.timeout("15 seconds"), Effect.exit)

        expect(describe(second)).toBe("success")
        if (!Exit.isSuccess(second)) return
        // The queue is the witness: a reply is waiting and nothing consumed it.
        expect(yield* llm.pending).toBe(0)
        expect(second.value.parts.some((part) => part.type === "text" && part.text === "recovered after stop")).toBe(
          true,
        )
      }),
      { git: true, config: providerCfg },
    ),
  90_000,
)
