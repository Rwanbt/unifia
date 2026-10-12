<!-- SPDX-License-Identifier: MIT -->
# ADR-096 — The desktop's remote password lives in the system keychain

**Status:** accepted on `fix/sidecar-credentials-not-inherited`, pending independent review.
**Date:** 2026-10-12

## Context

The desktop application's remote password is the owner's authority on the server: basic auth is the `admin` role. It was stored in clear in the settings store (`opencode.settings.dat`, under the application data folder), where any process of the same user can read it. ADR-094 recorded this as an open residual.

## Decision

The password is kept in the system keychain, at service `unifia.remote`, key `password`. The settings store keeps only the username, the enabled flag, TLS, and `password_in_keychain`, a flag that says the keychain holds the password. Implemented in `packages/desktop/src-tauri/src/remote_secret.rs`, used by `load_remote_config` and `save_remote_config` in `server.rs`.

- **Namespace.** The remote password is read and written through the raw keychain backend, on `unifia.remote` only. The shim's helpers fall back to `opencode.remote` when the new entry is empty, and another product may write that entry. The remote password never adopts a value from it.
- **Migration.** A settings file that still holds a password in clear reads the keychain first. If the keychain is empty, the password is written there and read back, and the settings file is rewritten without it only after the read-back matches (`Migrated`). If the keychain already holds a different password, the keychain's stays active, the settings file's copy is dropped, the desktop logs a warning, and the settings file is rewritten (`Superseded`). If the keychain cannot be read, nothing is written (`LegacyKept`). If it cannot be written, the settings file is left as it was (`LegacyKept`). Both cases are logged.
- **Lost entry.** A flagged password that the keychain no longer holds is replaced by a new one, and that new one is kept (`Lost`). Clients paired with the old password must pair again. The desktop logs a warning that says so. This is the recovery path, and it is not silent.
- **Keychain unusable.** A keychain that cannot be read gives a password for this run only (`Unavailable`). That password is session-only: no save writes it to the keychain, and nothing from it reaches the settings file. A save in that state keeps the settings flag at `true`, because the keychain entry is still the one recorded. The next launch therefore reads the stored password again when the keychain works. If the keychain holds nothing, the password is reported as lost. A keychain that cannot take a new password gives the same session-only password.
- **Owner's choice.** `set_remote_credentials` with a non-blank password, and `reset_remote_password`, clear the session-only mark (`remote_secret::replace`). The password the owner chose is then written even when the stored one could not be read.
- **Rotation.** `reset_remote_password` overwrites the keychain entry. The application keeps no copy of the old value. The running sidecar keeps the password it was started with until it restarts (see Open decisions).
- **Keychain commands.** `auth_storage_get`, `_set`, `_delete` and `_list` name only the entries their callers use: the sidecar's provider credentials (service `auth`, any provider key) and the GitHub session (`github` / `session`). Every other entry is refused, including `remote/password` and its case variants. The check is inside the commands, so the sidecar's `/kc/` route, which calls the same functions, is held to it too.
- The sidecar does not read the settings store for the password. The desktop hands it over on the credential line (ADR-094).

## Verified here

- `cargo test --lib` of `unifia-desktop` on Linux: 106 pass, 0 fail. Of these, 17 are in `remote_secret` and 4 are in `auth_storage`. The `remote_secret` tests use a mock keychain, a keychain that fails every call, and a keychain whose reads fail while its writes are kept. They cover the migration cases above, the lost entry (resolved to `Lost`, with its warning), the first launch, a save after a failed read that leaves the stored password in place, an owner's password written after a failed read, the legacy namespace not being adopted, and a refused write returned as an error.
- The `auth_storage` tests: the remote entry is refused by get, set, delete and list, including its case variants. The sidecar's and GitHub's entries are accepted.
- Mutation check on this head: putting the password back into the settings form fails `the_settings_form_after_a_migration_holds_no_password`, `the_settings_bytes_after_a_migration_hold_no_password_value` and `a_save_after_a_failed_read_leaves_the_stored_password_in_the_keychain`. The change was reverted, and the tree matched the commit.
- `cargo check` of `unifia-desktop`: exit 0, zero warnings. `rustfmt --edition 2024 --check` is clean on the changed Rust files.
- Not run: the keychain of Windows (Credential Manager) and macOS, the Secret Service on Linux with a live session, an installed application migrating its own settings file, a Windows build, and a running webview calling the keychain commands.

## Not verified here, and residual risk

1. **Old copies of the plaintext.** The settings store is rewritten without the password, but a copy of the previous file may remain in free blocks, a file-system journal, a backup, or a synchronised folder. The application cannot erase those. This is stated, not claimed as removed.
2. **Keychain unavailable on a legacy install.** The password stays in the settings file, with a warning in the log. The plaintext residual therefore remains on that machine until the keychain works.
3. **Keychain unusable at launch.** The password is for that run only, so a client paired with it stops working at the next launch. The operator sees a warning. This favours a visible failure over a stored secret.
4. **A same-account process.** The keychain entry is readable by the same account where the operating system's policy allows it. The keychain is a better boundary than a settings file, not a barrier against a same-account process, which can read the desktop's memory or ask the keychain itself.
5. **Backup and recovery.** The application does not export the password. A lost keychain entry is recovered by generating a new one, which invalidates the paired clients. A controlled backup of the password is not implemented, and is a decision for the owner.
6. **The username** stays in the settings store. It is not secret.

## Open decisions and known defects (not changed here)

1. **Rotation takes effect on restart (owner's decision).** `reset_remote_password` overwrites the keychain entry and returns the new password to the UI. The sidecar was started with the old one (`load_remote_config` at startup, in `lib.rs`, then `cli::serve`, which hands it to `cli::spawn_command`), and it checks basic auth against that value until it exits. Until the next launch, the old password stays valid and the new one is refused. The UI says the change takes effect after restart. Two options:
   - (a) Keep the restart requirement. The old credential remains valid after a rotation, which is the reason for rotating.
   - (b) Restart the sidecar inside the reset. The old credential stops at once, but every open PTY WebSocket and SSE stream is dropped. `set_remote_enabled` gives that as its reason for not restarting at runtime. The desktop's own connection must also take the new password from `ServerReadyData`, which is fixed at startup.
2. **A session-only password changes between loads.** `load_remote_config` runs in many commands, and each call that finds the keychain unreadable draws a new session-only password. Within one run, a command can therefore return a password that differs from the one the sidecar was started with. Options: keep one session password per process, or make the mismatch impossible.
3. **A settings store that cannot be opened.** `load_remote_config` returns the default configuration without consulting the keychain. The sidecar then runs with a random password that is not saved, and no warning is logged.
4. **A lost entry whose regeneration cannot be written** is reported as session-only (`Unavailable`), not as lost.

## Consequences

- The settings store no longer holds the owner's password, after the first load on a machine whose keychain works.
- A desktop whose keychain cannot be read runs with a password for that run only. A client paired with it stops working at the next launch.
- ADR-094's open item on the plaintext password is closed by this decision, subject to review and to the Windows and macOS keychains being checked.
