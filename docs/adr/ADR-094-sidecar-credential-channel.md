<!-- SPDX-License-Identifier: MIT -->
# ADR-094 — The sidecar receives its credentials on stdin, not in its environment

Status: **Accepted** for the desktop launch. The headless `serve` fallback is unchanged and weaker, see *Consequences*.
Date: 2026-10-11

## Context

The desktop application starts its sidecar with the server's basic-auth username and password, and with the keychain token, in the sidecar's environment. Three things then follow:

- Every process the sidecar starts inherits that environment. The commands the agent runs in its shell are such processes, and the shell tool builds its environment from the whole process environment.
- A basic credential is the owner's authority: the server treats basic-auth as the `admin` role, and the owner's routes accept it. A command that printed its environment could therefore open the owner's routes. The keychain token reaches the operating system's keychain endpoint.
- On Linux the operating system exposes a process's environment as `/proc/<pid>/environ`, readable by a process of the same user. Removing the variable from the process at run time does not change that file.

## Decision

The host writes the credentials as one line of JSON on the stdin pipe it already holds for the sidecar's parent watchdog, and keeps the pipe open:

```
{"username":"…","password":"…","keychainToken":"…"}
```

- The sidecar starts with `--credentials-stdin`. It reads that one line before the parent watchdog is armed (the watchdog resumes stdin without a data listener, and would discard the line). The values are held in memory, in `packages/unifia/src/flag/held-credentials.ts`.
- `Flag.UNIFIA_SERVER_PASSWORD`, `UNIFIA_SERVER_USERNAME` and `UNIFIA_KEYCHAIN_TOKEN` read the held values first, then the environment. They are read at access, so a value that arrives after import is seen.
- The end of stdin still means the host is gone. A host that dies before the line is sent leaves no sidecar running: the reader rejects on end-of-stdin, on a line that is too long, on a line that is not the expected JSON, and after ten seconds with no line. `serve` exits with status 1 in each case, before it listens.
- Nothing is written to disk. A new sidecar needs a new line; the credentials of an earlier one are not kept.
- The desktop does not put the credentials in the command line, in the environment of the sidecar or in the shell's environment. The keychain endpoint travels on the same line as its token, because the token is sent to that address: when the host sent a token, the environment does not choose the endpoint.

## Verified here

Linux, the real CLI started as `serve`, from `packages/unifia/test/server/sidecar-stdin.test.ts` (12 tests in total with the reader's unit tests):

- the password on stdin authenticates requests, and a request without it gets 401;
- `/proc/<pid>/environ` and `/proc/<pid>/cmdline` of the running server do not contain the password. A control start with the environment method does show it in `/proc/<pid>/environ`, so the check is not vacuous;
- end of stdin, a non-credential line, and a restart without a new line each exit with status 1, and nothing listens.

## Not verified here

- The Rust launch in `packages/desktop/src-tauri/src/cli.rs` is checked, not run. `cargo check` of the `unifia-desktop` crate passes with no warnings, on Linux, after installing the GTK and WebKit development packages. Two environment substitutions were needed in this sandbox, and neither is in the repository: a stub ONNX Runtime location (`ORT_LIB_LOCATION`, with `ORT_SKIP_DOWNLOAD=1`) because the download host is blocked, and a placeholder for the Linux sidecar file, which Tauri only checks for existence. The launch itself, and the desktop application, were not run. The CI Rust job is the first build of this change with the real dependencies.
- The WSL launch. It passes stdin through `wsl … exec`; this was not run.
- Windows and macOS: whether another process of the same user can see a process's environment or memory there.
- The desktop application running end to end.

## Residual risk, stated plainly

A process of the same user that can read the sidecar's memory can still obtain the values. Whether it can depends on the operating system:

- On Linux, reading another process's memory needs ptrace permission. The agent's shell is a *descendant* of the sidecar. Under Yama `ptrace_scope` 1 (the common default) a descendant cannot attach to its ancestor, which would make the agent's shell unable to read the sidecar's memory. This was **not verified here**: `/proc/sys/kernel/yama` is absent in this environment. Under `ptrace_scope` 0 the shell could.
- The process environment and command line are the things this ADR removes from reach. Memory is not, and the decision does not claim otherwise.

## Consequences

- The voice helper (`voice_live.rs`) still receives the password in its environment. It is a second process of the desktop, and is not covered by this ADR; it needs its own change.
- The headless `serve`, `web` and `run` commands keep the environment method when `--credentials-stdin` is absent. A headless user who sets `UNIFIA_SERVER_PASSWORD` has the environment exposure described above, and that is the user's choice.
- Basic-auth remains the owner's authority. Whether a sidecar should hold a narrower, per-capability token instead is a design question, not decided here.
- Migration: none. The change is the launch and the reader. No file is created, moved or deleted.

## Second review (2026-10-11): what changed, and what is still open

An adversarial review of this channel found the following. The fixes are in this branch; the rest are open, and each needs a decision or a separate change.

**Fixed in this branch**

- The Workbench and the native voice read their credentials from the held values, not from the environment. Before the fix, the desktop path (password on stdin, none in the environment) silently disabled the Workbench bridge and native TTS. A test now holds a password from stdin with no environment copy and checks that the bridge opens; it fails on the previous code.
- An empty credential field is refused. Before, an empty password started a server that checked nothing.
- The reader judges size on bytes, on every chunk, and decodes the line once whole. Before, a line of 100 KiB whose newline arrived in the same chunk was accepted, and a character split across two chunks was corrupted.
- The refusal messages name no key. Before, a value placed in a key name was echoed to stderr.
- The headless start withholds the username and the keychain token as well as the password.

**Open, with the reason**

1. **The desktop stores the server password in plain text.** `RemoteConfig.password` is saved in the application's settings store (`opencode.settings.dat`, under the application data folder), unencrypted. Any process of the same user can read it, and then authenticate as the owner over Basic. This is a storage decision (for example the operating system keychain), so it is not changed here.
2. **The Electron desktop still passes the password in the sidecar's environment** (`packages/desktop-electron/src/main/cli.ts`). It is a separate desktop build, outside this change. It needs the same channel.
3. **The voice helper receives the password and the LiveKit secret in its environment** (`voice_live.rs`). It needs them. A change of channel for the helper is a follow-up.
4. **The browser host's command line carries seeded browser storage, cookies included** (`node-host-transport.ts`, `workbench.ts`). The value is in the process arguments. It is a separate change.
5. **On Bun, a child started without an explicit environment can still see a variable that was present at start, even after `delete process.env.X`.** Checked here: with the variable set in the native environment, a child started without an `env` option read it after the delete. The desktop path never has the variable in its environment, so it is not exposed. A headless start from the environment is. Closing it needs every spawn to pass an explicit environment, which is a larger change.
6. **On Unix, the credential pipe is the login shell's stdin** (`cli.rs`). A profile that reads stdin would consume the line. Plausible, not run.
7. **Not run here:** Windows and macOS process visibility, WSL, the Electron application, the voice helper, and the Rust launch.

## Fifth review (2026-10-11, head `ac4b9dc6f`): what changed

A review of the channel found the items below. They are fixed on this branch.

- A host-sent credential is not replaced by the environment's copy. The keychain endpoint is sent on the line with its token, and the endpoint, the Workbench bearer and the Flag reads take the host's value first; a bearer in the environment is not held when the host sent a token.
- A credential line needs a password, and a keychain token needs its endpoint. A line without them is refused.
- A blank username is not stored. A blank credential already in the settings file is replaced by its default, and the replacement is kept.
- The keychain endpoint is no longer in the sidecar's environment at all: it travels only on the credential line. An environment copy would disclose the port to every process the sidecar starts.
- An endpoint without a token is refused by the reader, as a token without an endpoint is.
- A failed save of the remote settings is logged. A password that is not saved is regenerated on the next launch, and the operator should see why.

**Residual, not changed here.** On a headless start with no credential line, the environment chooses the endpoint and the token, as designed. A writer of the process's environment after the start (for example a value written from the auth store) therefore changes what a headless server sends, and that is the user's own configuration. On a desktop start the held endpoint wins over the environment, so such a write does not redirect the token the host sent.

## Third review (2026-10-11, round 3, head `88c64ced8`): what changed, and what is still open

An adversarial review of the channel found the items below. The fixes are on this branch.

**Fixed in this branch**

- The desktop launch removes the credential variables from the sidecar's environment, and filters them out of the login shell's variables: `OPENCODE_SERVER_PASSWORD` matched the `OPENCODE_` prefix that is forwarded. Before, with no credential line, the keychain token was passed in the sidecar's environment; it now always travels on stdin, when the endpoint is up.
- The native Workbench route read the keychain token from the environment only. On the desktop path the variable was withheld, so the route answered 404 "bridge unavailable", and the workspace-open and issue paths failed. The route reads the held token now.
- `UNIFIA_WORKBENCH_BEARER` is withheld and held, as its legacy name was. It is held in a new field, `workbenchBearer`, which the host does not send: it is only ever copied from a headless environment.
- A field of spaces only is refused. The value is kept as sent.
- Assigning `undefined` to a credential of `Flag` clears it. It used to fall back to the environment captured at load, so a test that cleared a password could still run authenticated.
- A bearer the host sent, or a headless start held, wins over the environment. A `.env` in the working directory could override the token the desktop sent: Bun loads it. The native route reads the held value first.
- A blank password is not stored by the desktop (`set_remote_credentials`). Before, a blank one was stored, and the sidecar then refused to start.
- `get_config`, a dead function that ran `debug config` with the credential flag appended, is removed. That command is strict and refused the flag.

**Open, with the reason**

1. **A headless start, children of the sidecar.** On Bun, a child started without an explicit environment inherits the variables present when the process started, even after they are deleted from `process.env`. Checked here. The spawns that pass no environment option are: `server/routes/team.ts` (git), `tool/team.ts` (git), `local-llm-server/index.ts` (the llama server), and `local-models/index.ts` (the installers). The CLI commands `cli/cmd/models.ts` and `cli/cmd/doctor.ts` run in their own process. The spawns that pass an explicit environment built from `process.env` (`browser/host-runtime.ts`, `team/opencode-application.ts`) do not carry the variables. Closing this for the headless start needs each of the first group to pass an explicit environment. It is not changed here: the headless start keeps the environment method by the user's choice (Consequences).
2. **Memory.** A same-user process can read the sidecar's memory where the operating system allows it. On Linux the channel protects against the environment and the command line only; under `ptrace_scope` 0 the agent's shell could obtain the value. The residual risk section above says so.
3. **WSL.** The variables reach the sidecar through `wsl -e bash -lc`, and that path is unchanged. Not verified.
4. **The native route's authority.** Now that the route answers on a desktop start, it is gated by the keychain token alone: the JWT check is skipped for that route by design. On a remote bind the route is reachable with that token and no basic credential. Whether it should also require the basic credential is a decision for the owner, and is not changed here.
5. **A separate authority question** in the server's token verification is open. It is not described here, and is tracked privately with the owner.
6. The second review's open items stand: the plain-text password in `opencode.settings.dat`, the Electron application, the voice helper, the browser host's arguments, and the login shell's stdin on Unix.

**Verified here (round 3)**

- `test/server/sidecar-credential-channel.test.ts`: five cases. Four fail on `88c64ced8` and pass on this head (the blank field, the held bearer, the withheld bearer, the assigned undefined). The fifth (a password with spaces held as sent) is a guard that passes on both.
- `test/server` and `test/auth`: 391 pass, 0 fail. `tsgo --noEmit`: exit 0. Biome on the changed TypeScript sources: exit 0.
- `cargo check` of `unifia-desktop` on Linux: exit 0, no warnings, with the edits of this round. The stub ONNX Runtime location and the placeholder Linux sidecar file used for it are not in the repository (the sidecar placeholder is gitignored).
- Not run: Windows, macOS, WSL, the Electron application, and the desktop application end to end.
