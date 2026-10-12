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

Each test process owns one run directory, `<tmp>/unifia-tests/run-<uuid>/`, that holds an owner record (`owner.json`: format, pid, host, boot id, start time, creation time). Every fixture is created inside it as `unifia-test-*`.

- The preload sweeps run directories left by killed runs before the run starts. A directory is removed only when its owner record parses, it is a real directory directly under the root (never a link), its owner process is gone, and it is older than `UNIFIA_TEST_SWEEP_GRACE_MS` (default one hour). Anything else is kept and reported.
- The run directory is removed when the run ends. Exit, SIGINT and SIGTERM also remove it. A SIGKILL cannot, which is why the sweep exists.
- `UNIFIA_TEST_KEEP=1` keeps every fixture and run directory for inspection. The sweep removes them later, after the grace period.
- Code that needs a plain directory outside `tmpdir()` uses `fixtureDirSync(prefix)` and `removeFixtureSync(dir)` from `fixture/run.ts`. Do not call `mkdtemp` under `os.tmpdir()` in a test.

### Disposal rule

Bind every `tmpdir()` with `await using`. `fixture/non-disposing.test.ts` fails on any other binding that is not on its allowlist. An allowlist entry gives the count and the reason the fixture is disposed anyway (an afterEach, an `Effect.acquireRelease`, or a helper that returns the disposable to callers that use `await using`). Update the count and reason there when the call changes.

### Notes

- Use `await using` for automatic cleanup when the variable goes out of scope
- Paths are sanitized to strip null bytes (defensive fix for CI environments)
