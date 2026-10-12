# Test Fixtures Guide

## Temporary Directory Fixture

The `tmpdir` function in `fixture/fixture.ts` creates temporary directories for tests with automatic cleanup.

### Basic Usage

```typescript
import { tmpdir } from "./fixture/fixture"

test("example", async () => {
  await using tmp = await tmpdir()
  // tmp.path is the temp directory path
  // automatically cleaned up when test ends
})
```

### Options

- `git?: boolean` - Initialize a git repo with a root commit
- `config?: Partial<Config.Info>` - Write an `unifia.json` config file
- `init?: (dir: string) => Promise<T>` - Custom setup function, returns value accessible as `tmp.extra`
- `dispose?: (dir: string) => Promise<T>` - Custom cleanup function

### Examples

**Git repository:**

```typescript
await using tmp = await tmpdir({ git: true })
```

**With config file:**

```typescript
await using tmp = await tmpdir({
  config: { model: "test/model", username: "testuser" },
})
```

**Custom initialization (returns extra data):**

```typescript
await using tmp = await tmpdir<string>({
  init: async (dir) => {
    await Bun.write(path.join(dir, "file.txt"), "content")
    return "extra data"
  },
})
// Access extra data via tmp.extra
console.log(tmp.extra) // "extra data"
```

**With cleanup:**

```typescript
await using tmp = await tmpdir({
  init: async (dir) => {
    const specialDir = path.join(dir, "special")
    await fs.mkdir(specialDir)
    return specialDir
  },
  dispose: async (dir) => {
    // Custom cleanup logic
    await fs.rm(path.join(dir, "special"), { recursive: true })
  },
})
```

### Returned Object

- `path: string` - Absolute path to the temp directory (realpath resolved)
- `extra: T` - Value returned by the `init` function
- `[Symbol.asyncDispose]` - Enables automatic cleanup via `await using`
- `spawn(cmd, options)` - Starts a child process that belongs to this fixture. Disposal terminates it (SIGTERM, then SIGKILL) and waits for it before the directory is removed. A child that does not exit makes disposal throw and keeps the directory.

### Run directories

Each test process owns one run directory, `<tmp>/unifia-tests/run-<random id>/`, that holds an owner record (`owner.json`: format, pid, host, boot id, start time, creation time, end time). Every fixture is created inside it as `unifia-test-*`.

- The preload sweeps run directories before the run starts. A directory is removed only when its owner record parses, it is a real directory directly under the root (never a link), its owner process is gone, it is older than `UNIFIA_TEST_SWEEP_GRACE_MS` (default one hour), and, if the run ended, `UNIFIA_TEST_RETAIN_SECONDS` (default 3600) have passed since it ended. Anything else is kept and reported. A run whose owner is alive is never removed.
- When a run ends (the end of the test run, exit, SIGINT or SIGTERM), its directory is stamped with the end time and kept, with its residue. It is not removed at exit, so the residue of a failing run is still there to read. A SIGKILL never ends a run; the sweep removes such a directory after the grace period.
- The residue of one run is bounded by the retention period: the first test process to start after `UNIFIA_TEST_RETAIN_SECONDS` has passed since the run ended removes it. A machine that runs no tests keeps it until the next test start.
- Retention keeps what disposal did not remove: a dispose that failed, a background writer's late output, and the fixtures of a killed run. Per-test disposal is unchanged, so a fixture of a failing test is still removed by its own `await using` or afterEach. Bun does not show a test's outcome to its disposal, so retention cannot keep that fixture.
- `UNIFIA_TEST_KEEP=1` keeps every fixture for inspection: per-test fixtures are not removed. Tests that assert a removal fail under it by design, so use it to inspect one run, not as a test gate.
- Code that needs a plain directory outside `tmpdir()` uses `fixtureDirSync(prefix)` and `removeFixtureSync(dir)` from `fixture/run.ts`. Do not call `mkdtemp` under `os.tmpdir()` in a test.

### Disposal rule

Bind every `tmpdir()` with `await using`. Disposal runs on the failure path too, so each fixture is removed even when its test fails; the run directory keeps only what disposal did not remove (see Run directories). `fixture/non-disposing.test.ts` fails on any other binding that is not on its allowlist. An allowlist entry gives the count and the reason the fixture is disposed anyway (an afterEach, an `Effect.acquireRelease`, or a helper that returns the disposable to callers that use `await using`). Update the count and reason there when the call changes.

### Notes

- Use `await using` for automatic cleanup when the variable goes out of scope
- Paths are sanitized to strip null bytes (defensive fix for CI environments)
