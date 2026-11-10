import type { ChildProcess } from "node:child_process"
import { spawn as direct } from "node:child_process"
import launch from "cross-spawn"
import { buffer } from "node:stream/consumers"
import { errorMessage } from "./error"
import { isShim, quote } from "./shim"

export namespace Process {
  export type Stdio = "inherit" | "pipe" | "ignore"
  export type Shell = boolean | string

  export interface Options {
    cwd?: string
    env?: NodeJS.ProcessEnv | null
    stdin?: Stdio
    stdout?: Stdio
    stderr?: Stdio
    abort?: AbortSignal
    kill?: NodeJS.Signals | number
    timeout?: number
  }

  export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
    nothrow?: boolean
  }


  export interface ShellRunOptions extends RunOptions {
    shell: Shell
  }

  export interface Result {
    code: number
    stdout: Buffer
    stderr: Buffer
  }

  export interface TextResult extends Result {
    text: string
  }

  export class RunFailedError extends Error {
    readonly cmd: string[]
    readonly code: number
    readonly stdout: Buffer
    readonly stderr: Buffer

    constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
      const text = stderr.toString().trim()
      super(
        text
          ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
          : `Command failed with code ${code}: ${cmd.join(" ")}`,
      )
      this.name = "ProcessRunFailedError"
      this.cmd = [...cmd]
      this.code = code
      this.stdout = stdout
      this.stderr = stderr
    }
  }

  export type Child = ChildProcess & { exited: Promise<number> }

  // WHY: a shell is only legitimate at two call sites that hold the privilege
  // themselves — `!{}` interpolation in a user command template after the bash
  // permission (`session/prompt.ts`) and the user's own $EDITOR on Windows
  // (`cli/cmd/tui/util/editor.ts`). Every other caller goes through `spawn`,
  // which cannot enable a shell, so no request-derived value reaches `launch`
  // with one (CodeQL js/command-line-injection on the shared sink).
  function shellOf(opts: { shell?: Shell }): Shell {
    if (opts.shell !== true && typeof opts.shell !== "string") {
      throw new Error("an explicit shell is required: pass shell: true or a shell path")
    }
    return opts.shell
  }

  function forbidShell(opts: object) {
    if (Object.prototype.hasOwnProperty.call(opts, "shell")) {
      throw new Error("Process.spawn/run do not run a shell; use Process.textShell, or Process.spawnShim/runShim for a Windows shim")
    }
  }

  function cross(opts: Options) {
    return {
      cwd: opts.cwd,
      env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"] as Stdio[],
      windowsHide: process.platform === "win32",
    }
  }

  // Node's own spawn: this entry point is not shell-capable. Windows `.cmd`/`.bat`
  // shims cannot be executed here (CreateProcess cannot run them); they are
  // refused so the caller must choose `spawnShim`/`runShim` explicitly.
  function start(cmd: string[], opts: Options): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    opts.abort?.throwIfAborted()
    if (isShim(cmd[0])) {
      throw new Error(
        `Process.spawn does not run Windows .cmd/.bat shims (${cmd[0]}); use Process.spawnShim or Process.runShim`,
      )
    }
    return track(
      direct(cmd[0], cmd.slice(1), {
        cwd: opts.cwd,
        env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
        stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"] as Stdio[],
        windowsHide: process.platform === "win32",
        // Spelled out, not layered over a spread: the analysis must see that
        // this invocation is not shell-interpreted.
        shell: false,
      }),
      opts,
    )
  }

  // WHY: this is the only shell sink left. It serves two cases: `textShell` for
  // the `!{}` template in `session/prompt.ts` (after `permission.ask("bash")`),
  // and `spawnShim`/`runShim` for Windows `.cmd`/`.bat` launchers, whose
  // arguments are always quoted by `util/shim.ts`. The generic entry points
  // never enable a shell, and the editor only reaches this path for a shim.
  function runAuthorizedShell(cmd: string[], opts: Options, shell: Shell): Child {
    if (cmd.length === 0) throw new Error("Command is required")
    opts.abort?.throwIfAborted()
    // WHY: sanctioned shell sink, see the WHY above and docs/security/CODEQL-DISPOSITIONS.md.
    // lgtm[js/command-line-injection,js/indirect-command-line-injection,js/shell-command-injection-from-environment]
    const proc = launch(cmd[0], cmd.slice(1), { ...cross(opts), shell })
    return track(proc, opts)
  }

  function track(proc: ChildProcess, opts: Options): Child {
    let closed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const abort = () => {
      if (closed) return
      if (proc.exitCode !== null || proc.signalCode !== null) return
      closed = true

      proc.kill(opts.kill ?? "SIGTERM")

      const ms = opts.timeout ?? 5_000
      if (ms <= 0) return
      timer = setTimeout(() => proc.kill("SIGKILL"), ms)
    }

    const exited = new Promise<number>((resolve, reject) => {
      const done = () => {
        opts.abort?.removeEventListener("abort", abort)
        if (timer) clearTimeout(timer)
      }

      proc.once("exit", (code, signal) => {
        done()
        resolve(code ?? (signal ? 1 : 0))
      })

      proc.once("error", (error) => {
        done()
        reject(error)
      })
    })
    void exited.catch(() => undefined)

    if (opts.abort) {
      opts.abort.addEventListener("abort", abort, { once: true })
      if (opts.abort.aborted) abort()
    }

    const child = proc as Child
    child.exited = exited
    return child
  }

  export function spawn(cmd: string[], opts: Options = {}): Child {
    forbidShell(opts)
    return start(cmd, opts)
  }

  // Explicit Windows shim entry point: cmd.exe is the only thing that can run a
  // `.cmd`/`.bat`, so it goes through the sanctioned sink with every argument
  // strictly quoted. The generic entry points refuse shims; only `spawnShim`
  // and `runShim` reach the shell sink, and they always quote.
  export function spawnShim(cmd: string[], opts: Options = {}): Child {
    forbidShell(opts)
    if (cmd.length === 0) throw new Error("Command is required")
    return runAuthorizedShell([cmd.map(quote).join(" ")], opts, true)
  }

  export async function runShim(cmd: string[], opts: RunOptions = {}): Promise<Result> {
    return collect(cmd, spawnShim(cmd, { ...opts, stdout: "pipe", stderr: "pipe" }), opts)
  }

  async function collect(cmd: string[], proc: Child, opts: RunOptions): Promise<Result> {
    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

    const out = await Promise.all([proc.exited, buffer(proc.stdout), buffer(proc.stderr)])
      .then(([code, stdout, stderr]) => ({
        code,
        stdout,
        stderr,
      }))
      .catch((err: unknown) => {
        if (!opts.nothrow) throw err
        return {
          code: 1,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(errorMessage(err)),
        }
      })
    if (out.code === 0 || opts.nothrow) return out
    throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
  }

  export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
    forbidShell(opts)
    return collect(cmd, start(cmd, { ...opts, stdout: "pipe", stderr: "pipe" }), opts)
  }

  // Duplicated in `packages/sdk/js/src/process.ts` because the SDK cannot import
  // `opencode` without creating a cycle. Keep both copies in sync.
  export async function stop(proc: ChildProcess) {
    if (proc.exitCode !== null || proc.signalCode !== null) return

    if (process.platform !== "win32" || !proc.pid) {
      proc.kill()
      return
    }

    // FORK (LSP-TEST-SUITE-REGRESSION): taskkill itself can hang under OS-level
    // process/handle starvation (observed: a 6-minute hang on project.initGit's
    // afterEach, propagating from here through LSPClient.shutdown() →
    // pool.shutdownAll() → Instance.disposeAll()). Bound it — if taskkill
    // doesn't exit within 5s, fall through to proc.kill() below regardless.
    const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
      nothrow: true,
      abort: AbortSignal.timeout(5_000),
    })

    if (out.code === 0) return
    proc.kill()
  }

  export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
    const out = await run(cmd, opts)
    return {
      ...out,
      text: out.stdout.toString(),
    }
  }

  export async function textShell(cmd: string[], opts: ShellRunOptions): Promise<TextResult> {
    const out = await collect(cmd, runAuthorizedShell(cmd, { ...opts, stdout: "pipe", stderr: "pipe" }, shellOf(opts)), opts)
    return {
      ...out,
      text: out.stdout.toString(),
    }
  }

  export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
    return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
  }
}
