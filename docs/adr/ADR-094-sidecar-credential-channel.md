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
- The desktop does not put the credentials in the command line, in the environment of the sidecar or in the shell's environment. The keychain URL stays in the environment: it is not a credential.

## Verified here

Linux, the real CLI started as `serve`, from `packages/unifia/test/server/sidecar-stdin.test.ts` (12 tests in total with the reader's unit tests):

- the password on stdin authenticates requests, and a request without it gets 401;
- `/proc/<pid>/environ` and `/proc/<pid>/cmdline` of the running server do not contain the password. A control start with the environment method does show it in `/proc/<pid>/environ`, so the check is not vacuous;
- end of stdin, a non-credential line, and a restart without a new line each exit with status 1, and nothing listens.

## Not verified here

- The Rust launch in `packages/desktop/src-tauri/src/cli.rs`. The file is formatted with `rustfmt` (edition 2024, clean), but the crate was not compiled here: it needs the Tauri system libraries. The CI Rust job is the first compile check.
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
