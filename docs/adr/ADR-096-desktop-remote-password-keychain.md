<!-- SPDX-License-Identifier: MIT -->
# ADR-096 — The desktop's remote password lives in the system keychain

**Status:** accepted on `fix/sidecar-credentials-not-inherited`, pending independent review.
**Date:** 2026-10-12

## Context

The desktop application's remote password is the owner's authority on the server: basic auth is the `admin` role. It was stored in clear in the settings store (`opencode.settings.dat`, under the application data folder), where any process of the same user can read it. ADR-094 recorded this as an open residual.

## Decision

The password is kept in the system keychain, through `unifia-keyring-shim` (service `remote`, key `password`). The settings store keeps only the username, the enabled flag, TLS, and `password_in_keychain`, a flag that says the password is there. Implemented in `packages/desktop/src-tauri/src/remote_secret.rs`, used by `load_remote_config` and `save_remote_config` in `server.rs`.

- A settings file that still holds a password in clear moves it to the keychain on load. The settings file is rewritten without it only after the keychain has returned the same value. A keychain that cannot be written leaves the settings file as it was, and the desktop logs why.
- A flagged password that the keychain no longer holds is replaced by a new one, and that new one is kept. The paired clients must be paired again: this is the recovery path, and it is not silent (the password changes and the operator sees a warning).
- A keychain that cannot be read or written gives a password for this session only. Nothing from it is persisted, so the next launch generates another one.
- Rotation is `reset_remote_password`: the keychain entry is overwritten, and the old value is not kept anywhere by the application.
- The sidecar does not read the settings store for the password. The desktop hands it over on the credential line (ADR-094).

## Verified here

- `cargo test --lib` of `unifia-desktop` on Linux: 91 pass, 0 fail. Eight of them are in `remote_secret`, on a mock keychain and on a keychain that always fails: a legacy password moves to the keychain; a lost entry is replaced and kept; a first launch generates one; an unavailable keychain keeps the legacy value and gives a session-only password; a write that the keychain refuses returns an error.
- Two regression tests (`the_settings_form_after_a_migration_holds_no_password`, `the_settings_bytes_after_a_migration_hold_no_password_value`) fail when the settings form is given back its password, and pass on this head. This was checked by reintroducing the old behaviour for one run and reverting it.
- `cargo check` of `unifia-desktop`: exit 0, no warnings. `rustfmt --edition 2024 --check` clean on the changed Rust files.
- Not run: the keychain of Windows (Credential Manager) and macOS, the Secret Service on Linux with a live session, an installed application migrating its own settings file, and a Windows build.

## Not verified here, and residual risk

1. **Old copies of the plaintext.** The settings store is rewritten without the password, but a copy of the previous file may remain in free blocks, a file-system journal, a backup, or a synchronised folder. The application cannot erase those. This is stated, not claimed as removed.
2. **Keychain unavailable on a legacy install.** The password stays in the settings file, with a warning in the log. The plaintext residual therefore remains on that machine until the keychain works.
3. **Keychain unavailable on first launch.** Each launch gives a new password, so paired clients fail after a restart. The operator sees a warning. This favours a visible failure over a stored secret.
4. **A same-account process.** The keychain entry is readable by the same account where the operating system's policy allows it. The keychain is a better boundary than a settings file, not a barrier against a same-account process, which can read the desktop's memory or ask the keychain itself.
5. **Backup and recovery.** The application does not export the password. A lost keychain entry is recovered by generating a new one, which invalidates the paired clients. A controlled backup of the password is not implemented, and is a decision for the owner.
6. **The username** stays in the settings store. It is not secret.

## Consequences

- The settings store no longer holds the owner's password, after the first load on a machine whose keychain works.
- A desktop whose keychain is down runs with a password that does not survive a restart.
- ADR-094's open item on the plaintext password is closed by this decision, subject to review and to the Windows and macOS keychains being checked.
