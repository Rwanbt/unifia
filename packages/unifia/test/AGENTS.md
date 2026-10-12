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

### Run directories

Each test process owns one run directory, `<tmp>/unifia-tests/run-<random id>/`, that holds an owner record (`owner.json`: format, pid, host, boot id, start time, creation time, end time). Every fixture is created inside it as `unifia-test-*`, and the preload puts the run's XDG data there too.

- When a run ends (the end of the test run, exit, SIGINT or SIGTERM), its directory is removed with whatever its fixtures left behind. A SIGKILL never ends a run, so its directory stays.
- `UNIFIA_TEST_KEEP=1` keeps every fixture and the run directory for inspection. Tests that assert a removal fail under it by design, so use it to inspect one run, not as a test gate.
- Code that needs a plain directory outside `tmpdir()` uses `fixtureDirSync(prefix)` and `removeFixtureSync(dir)` from `fixture/run.ts`. Do not call `mkdtemp` under `os.tmpdir()` in a test.

### Notes

- Use `await using` for automatic cleanup when the variable goes out of scope
- Paths are sanitized to strip null bytes (defensive fix for CI environments)
