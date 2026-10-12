// SPDX-License-Identifier: MIT
//! The remote password is kept in the system keychain, not in the settings file.
//!
//! The settings file is readable by every process of the user. The remote password is the owner's authority on the server:
//! basic auth is the admin role. The keychain holds the password, and the settings file keeps only a flag that says so.
//! A settings file written before this module holds the password in clear: it is moved on load, and the settings file is
//! rewritten without it only after the keychain has returned the same value. A keychain that already holds a different
//! password keeps it, and the settings file's is dropped with a warning. While the keychain cannot be read or written, the
//! settings file is left as it is, and the caller is told so.
//!
//! Each install has its own keychain entry, named by its flavour (`flavour`, from the application identifier): two installs of one
//! user never share a password, so a reset in one never changes the other.

use unifia_keyring_shim::{KEYRING_PREFIX, KeyringBackend};

use crate::server::RemoteConfig;

/// The keychain service and key that hold the remote password.
pub const SERVICE: &str = "remote";
pub const KEY: &str = "password";
/// The flavour of an install, from its Tauri application identifier (`tauri.conf.json` and its overlays): the development build is
/// `dev`, the beta build `beta`, and the stable build `stable`. Any other identifier is `custom-<identifier>`. No official flavour
/// starts with `custom-`, so no other identifier can name an official entry, whatever it is spelled like (`dev`, `beta`, `Dev`).
pub fn flavour(identifier: &str) -> String {
    match identifier {
        "ai.unifia.workbench.dev" => "dev".into(),
        "ai.unifia.workbench.beta" => "beta".into(),
        "ai.unifia.desktop" => "stable".into(),
        other => format!("custom-{other}"),
    }
}

/// The brand prefix and the service, which every install's entry extends. The entries are read and written through the raw
/// backend only: the shim's helpers would fall back to the legacy `opencode.` namespace, which another product may write.
fn shared_namespace() -> String {
    format!("{KEYRING_PREFIX}.{SERVICE}")
}

/// The keychain of one install: the store, and the entry this install's remote password lives in (ADR-096). The namespace is the
/// shared one with the install's flavour appended, so two installs of one user never share a password.
pub struct Keychain<'a> {
    store: &'a dyn KeyringBackend,
    namespace: String,
}

impl<'a> Keychain<'a> {
    /// The keychain of the install with this application identifier.
    pub fn for_identifier(store: &'a dyn KeyringBackend, identifier: &str) -> Self {
        Self {
            store,
            namespace: format!("{}.{}", shared_namespace(), flavour(identifier)),
        }
    }

    /// The password in this install's entry. `Ok(None)` when the entry holds nothing.
    fn own_read(&self) -> Result<Option<String>, String> {
        self.store.get(&self.namespace, KEY)
    }

    fn own_write(&self, password: &str) -> Result<(), String> {
        self.store.set(&self.namespace, KEY, password)
    }
}

/// What `resolve` did, so the caller knows whether the settings file must be rewritten.
#[derive(Debug, PartialEq, Eq)]
pub enum Resolution {
    /// The keychain held the password. Nothing to rewrite.
    Keychain,
    /// A password from the settings file moved to the keychain. The settings file must be rewritten without it.
    Migrated,
    /// No password existed (first launch): a new one is in the keychain. The settings file must be rewritten.
    Generated,
    /// The settings file flagged the password as stored, or the settings cannot be read at all, and the keychain holds none: a new
    /// one is in the keychain, and clients paired with an earlier one must pair again. The caller warns.
    Lost,
    /// The keychain cannot be read or written. The settings file's password stays as it is, and the caller warns.
    LegacyKept,
    /// The settings file held a password that differs from the keychain's. The keychain's stays active, the settings file's
    /// is dropped, and the settings file must be rewritten. The caller warns.
    Superseded,
    /// The keychain cannot be read or written. The run uses a password for this run only, and a save writes nothing to the
    /// keychain. The caller warns.
    Unavailable,
}

/// Resolve the password a configuration holds, against this install's keychain entry. A flagged configuration reads the entry.
/// A password in clear moves to the entry, and no password at all generates one.
pub fn resolve(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    if config.password_in_keychain {
        return match keychain.own_read() {
            Ok(Some(password)) if !password.trim().is_empty() => {
                config.password = password;
                Resolution::Keychain
            }
            Ok(_) => lost(config, keychain),
            Err(_) => session_only(config),
        };
    }
    if config.password.trim().is_empty() {
        return generate(config, keychain);
    }
    migrate_legacy(config, keychain)
}

/// Move a password the settings file holds in clear to the keychain. The keychain is read first: a value it already holds
/// is never replaced silently. A keychain that cannot be read gets no write, because what it holds is unknown.
fn migrate_legacy(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    let legacy = config.password.clone();
    match keychain.own_read() {
        Err(_) => legacy_kept(config),
        Ok(Some(current)) if !current.trim().is_empty() => {
            config.password = current.clone();
            config.password_in_keychain = true;
            if current == legacy {
                Resolution::Migrated
            } else {
                Resolution::Superseded
            }
        }
        Ok(_) => {
            if keychain.own_write(&legacy).is_err() {
                return legacy_kept(config);
            }
            match keychain.own_read() {
                Ok(Some(back)) if back == legacy => {
                    config.password_in_keychain = true;
                    Resolution::Migrated
                }
                _ => legacy_kept(config),
            }
        }
    }
}

/// The keychain's state is unknown: it cannot be read, or it could not be written and read back. Nothing more is written to it,
/// by this load or by a save, and the settings file keeps the password it has.
fn legacy_kept(config: &mut RemoteConfig) -> Resolution {
    config.password_in_keychain = false;
    config.password_legacy_kept = true;
    Resolution::LegacyKept
}

/// The settings form of a configuration: no password, only the flag. The password is written to the keychain first, and a
/// failure is returned with nothing written to the settings file.
///
/// A session-only password is not written. The keychain keeps the password it holds, and the form still says it is there: the
/// next launch reads it again, or, if it is gone, reports it as lost. Writing `false` here would make that launch generate a
/// password over the stored one without a word.
///
/// A legacy-kept configuration writes nothing to the keychain, because its state is unknown. The form keeps the password the
/// settings file held in clear, and only that: the random default of a configuration without a remote section is not written to
/// the settings file, and the flag stays `false`.
pub fn persist(config: &RemoteConfig, keychain: &Keychain<'_>) -> Result<RemoteConfig, String> {
    let mut form = config.clone();
    if config.password_legacy_kept {
        form.password = if config.password_from_settings {
            config.password.clone()
        } else {
            String::new()
        };
        form.password_in_keychain = false;
        return Ok(form);
    }
    if !config.password_session_only {
        keychain.own_write(&config.password).map_err(|error| {
            format!("the system keychain did not accept the remote password: {error}")
        })?;
    }
    form.password = String::new();
    form.password_in_keychain = true;
    Ok(form)
}

/// The flag said the keychain held a password and it holds none. The password is regenerated, and the caller is told it was lost.
fn lost(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    match generate(config, keychain) {
        Resolution::Generated => Resolution::Lost,
        other => other,
    }
}

/// A new password, kept in the keychain. The keychain is read first: a password it already holds is kept, never replaced, and a
/// keychain that cannot be read gets no write, since what it holds is unknown.
fn generate(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    match keychain.own_read() {
        Ok(Some(stored)) if !stored.trim().is_empty() => {
            config.password = stored;
            config.password_in_keychain = true;
            config.password_session_only = false;
            return Resolution::Keychain;
        }
        Ok(_) => {}
        Err(_) => return session_only(config),
    }
    let fresh = uuid::Uuid::new_v4().to_string();
    match keychain.own_write(&fresh) {
        Ok(()) => {
            config.password = fresh;
            config.password_in_keychain = true;
            config.password_session_only = false;
            Resolution::Generated
        }
        Err(_) => session_only(config),
    }
}

/// The password for this run when the keychain cannot be used. It is drawn once: every load in the run gives the same one, and
/// the sidecar was started with it. A password drawn per load would differ from the one the sidecar checks.
fn session_password() -> String {
    static PASSWORD: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    PASSWORD
        .get_or_init(|| uuid::Uuid::new_v4().to_string())
        .clone()
}

/// The run uses the session password. Nothing from it is written, and the configuration does not record it in the keychain.
fn session_only(config: &mut RemoteConfig) -> Resolution {
    config.password = session_password();
    config.password_in_keychain = false;
    config.password_session_only = true;
    Resolution::Unavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use unifia_keyring_shim::MockBackend;

    /// The application identifier of the install the tests run as, and the entry it names.
    const DEVELOPMENT: &str = "ai.unifia.workbench.dev";
    const DEVELOPMENT_ENTRY: &str = "unifia.remote.dev";

    fn resolve(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
        super::resolve(config, &Keychain::for_identifier(store, DEVELOPMENT))
    }

    fn persist(config: &RemoteConfig, store: &dyn KeyringBackend) -> Result<RemoteConfig, String> {
        super::persist(config, &Keychain::for_identifier(store, DEVELOPMENT))
    }

    fn own_set(store: &dyn KeyringBackend, value: &str) -> Result<(), String> {
        store.set(DEVELOPMENT_ENTRY, KEY, value)
    }

    fn own_get(store: &dyn KeyringBackend) -> Result<Option<String>, String> {
        store.get(DEVELOPMENT_ENTRY, KEY)
    }

    /// A keychain that cannot be read or written.
    struct Unavailable;

    impl KeyringBackend for Unavailable {
        fn get(&self, _service: &str, _key: &str) -> Result<Option<String>, String> {
            Err("no keychain".into())
        }
        fn set(&self, _service: &str, _key: &str, _value: &str) -> Result<(), String> {
            Err("no keychain".into())
        }
        fn delete(&self, _service: &str, _key: &str) -> Result<(), String> {
            Err("no keychain".into())
        }
    }

    /// A configuration as the settings file gives it: a password it holds in clear is one it came from the settings file.
    fn settings(password: &str, in_keychain: bool) -> RemoteConfig {
        RemoteConfig {
            enabled: false,
            password: password.into(),
            username: "unifia".into(),
            tls_enabled: false,
            password_in_keychain: in_keychain,
            password_session_only: false,
            password_legacy_kept: false,
            password_from_settings: !password.trim().is_empty(),
        }
    }

    #[test]
    fn a_password_in_the_settings_file_moves_to_the_keychain() {
        let store = MockBackend::new();
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Migrated);
        assert!(config.password_in_keychain);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some("legacy-password-0123456789")
        );
    }

    #[test]
    fn the_settings_form_after_a_migration_holds_no_password() {
        let store = MockBackend::new();
        let mut config = settings("legacy-password-0123456789", false);
        resolve(&mut config, &store);

        let form = persist(&config, &store).unwrap();

        assert_eq!(form.password, "");
        assert!(form.password_in_keychain);
    }

    #[test]
    fn a_legacy_password_stays_in_the_settings_file_while_the_keychain_cannot_be_written() {
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &Unavailable), Resolution::LegacyKept);
        assert_eq!(config.password, "legacy-password-0123456789");
        assert!(!config.password_in_keychain);
    }

    #[test]
    fn a_password_flagged_as_stored_is_read_from_the_keychain() {
        let store = MockBackend::new();
        own_set(&store, "stored-password-0123456789").unwrap();
        let mut config = settings("", true);

        assert_eq!(resolve(&mut config, &store), Resolution::Keychain);
        assert_eq!(config.password, "stored-password-0123456789");
    }

    #[test]
    fn a_lost_keychain_entry_is_replaced_by_a_new_password_that_is_kept() {
        let store = MockBackend::new();
        let mut config = settings("", true);

        assert_eq!(resolve(&mut config, &store), Resolution::Lost);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
    }

    #[test]
    fn a_first_launch_generates_a_password_in_the_keychain() {
        let store = MockBackend::new();
        let mut config = settings("", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Generated);
        assert!(!config.password.trim().is_empty());
        assert!(config.password_in_keychain);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
    }

    #[test]
    fn with_the_keychain_unavailable_the_password_is_for_the_session_only() {
        let mut config = settings("", true);

        assert_eq!(resolve(&mut config, &Unavailable), Resolution::Unavailable);
        assert!(!config.password.trim().is_empty());
        assert!(!config.password_in_keychain);
    }

    #[test]
    fn persist_refuses_when_the_keychain_cannot_be_written() {
        let config = settings("some-password-0123456789", true);

        let result = persist(&config, &Unavailable);

        assert!(result.is_err());
    }
}
