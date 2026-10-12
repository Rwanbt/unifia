// SPDX-License-Identifier: MIT
//! The remote password is kept in the system keychain, not in the settings file.
//!
//! The settings file is readable by every process of the user. The remote password is the owner's authority on the server:
//! basic auth is the admin role. The keychain holds the password, and the settings file keeps only a flag that says so.
//! A settings file written before this module holds the password in clear: it is moved on load, and the settings file is
//! rewritten without it only after the keychain has returned the same value. A keychain that already holds a different
//! password keeps it, and the settings file's is dropped with a warning. While the keychain cannot be read or written, the
//! settings file is left as it is, and the caller is told so.

use unifia_keyring_shim::KeyringBackend;

use crate::server::RemoteConfig;

/// The keychain service and key that hold the remote password.
pub const SERVICE: &str = "remote";
pub const KEY: &str = "password";
/// The keychain namespace of the remote password: the brand prefix and the service. It is read and written through the raw
/// backend only. The shim's helpers would fall back to the legacy `opencode.` namespace, which another product may write.
pub const NAMESPACE: &str = "unifia.remote";

/// What `resolve` did, so the caller knows whether the settings file must be rewritten.
#[derive(Debug, PartialEq, Eq)]
pub enum Resolution {
    /// The keychain held the password. Nothing to rewrite.
    Keychain,
    /// A password from the settings file moved to the keychain. The settings file must be rewritten without it.
    Migrated,
    /// No password existed (first launch): a new one is in the keychain. The settings file must be rewritten.
    Generated,
    /// The settings file flagged the password as stored, but the keychain holds none: a new one is in the keychain, and clients
    /// paired with the old one must pair again. The caller warns.
    Lost,
    /// The keychain cannot be read or written. The settings file's password stays as it is, and the caller warns.
    LegacyKept,
    /// The settings file held a password that differs from the keychain's. The keychain's stays active, the settings file's
    /// is dropped, and the settings file must be rewritten. The caller warns.
    Superseded,
    /// The keychain cannot be read or written. The password is for this session only, and nothing is persisted from it.
    Unavailable,
}

/// The stored remote password, read from the namespace only. `Ok(None)` when the keychain holds nothing there.
fn read_stored(store: &dyn KeyringBackend) -> Result<Option<String>, String> {
    store.get(NAMESPACE, KEY)
}

fn write_stored(store: &dyn KeyringBackend, password: &str) -> Result<(), String> {
    store.set(NAMESPACE, KEY, password)
}

/// Resolve the password a configuration holds, against the keychain.
pub fn resolve(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
    if config.password_in_keychain {
        return match read_stored(store) {
            Ok(Some(password)) if !password.trim().is_empty() => {
                config.password = password;
                Resolution::Keychain
            }
            Ok(_) => lost(config, store),
            Err(_) => session_only(config),
        };
    }
    if config.password.trim().is_empty() {
        return generate(config, store);
    }
    migrate_legacy(config, store)
}

/// Move a password the settings file holds in clear to the keychain. The keychain is read first: a value it already holds
/// is never replaced silently. A keychain that cannot be read gets no write, because what it holds is unknown.
fn migrate_legacy(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
    let legacy = config.password.clone();
    match read_stored(store) {
        Err(_) => Resolution::LegacyKept,
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
            if write_stored(store, &legacy).is_err() {
                return Resolution::LegacyKept;
            }
            match read_stored(store) {
                Ok(Some(back)) if back == legacy => {
                    config.password_in_keychain = true;
                    Resolution::Migrated
                }
                _ => Resolution::LegacyKept,
            }
        }
    }
}

/// The settings form of a configuration: no password, only the flag. The password is written to the keychain first, and a
/// failure is returned with nothing written to the settings file.
///
/// A session-only password is not written. The keychain keeps the password it holds, and the form still says it is there: the
/// next launch reads it again, or, if it is gone, reports it as lost. Writing `false` here would make that launch generate a
/// password over the stored one without a word.
pub fn persist(config: &RemoteConfig, store: &dyn KeyringBackend) -> Result<RemoteConfig, String> {
    if !config.password_session_only {
        write_stored(store, &config.password).map_err(|error| {
            format!("the system keychain did not accept the remote password: {error}")
        })?;
    }
    let mut form = config.clone();
    form.password = String::new();
    form.password_in_keychain = true;
    Ok(form)
}

/// The message the desktop logs for a resolution that the owner must see. `None` when there is nothing to say.
pub fn warning(resolution: &Resolution) -> Option<&'static str> {
    match resolution {
        Resolution::Lost => Some(
            "the remote password is missing from the system keychain: a new one was generated and kept, and clients paired with the old one must pair again",
        ),
        Resolution::LegacyKept => Some(
            "the remote password stays in the settings file: the system keychain could not be read or did not keep it",
        ),
        Resolution::Unavailable => Some(
            "the system keychain cannot be read or written: the remote password is for this session only",
        ),
        Resolution::Superseded => Some(
            "the remote password in the settings file differs from the one in the system keychain: the keychain's stays active, and the settings file's is dropped",
        ),
        Resolution::Keychain | Resolution::Migrated | Resolution::Generated => None,
    }
}

/// The flag said the keychain held a password and it holds none. The password is regenerated, and the caller is told it was lost.
fn lost(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
    match generate(config, store) {
        Resolution::Generated => Resolution::Lost,
        other => other,
    }
}

/// A password the owner chose, or a reset: the next save writes it to the keychain, even if the stored one could not be read.
pub fn replace(config: &mut RemoteConfig, password: String) {
    config.password = password;
    config.password_session_only = false;
}

fn generate(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
    let fresh = uuid::Uuid::new_v4().to_string();
    match write_stored(store, &fresh) {
        Ok(()) => {
            config.password = fresh;
            config.password_in_keychain = true;
            config.password_session_only = false;
            Resolution::Generated
        }
        Err(_) => {
            config.password = fresh;
            config.password_in_keychain = false;
            config.password_session_only = true;
            Resolution::Unavailable
        }
    }
}

fn session_only(config: &mut RemoteConfig) -> Resolution {
    config.password = uuid::Uuid::new_v4().to_string();
    config.password_in_keychain = false;
    config.password_session_only = true;
    Resolution::Unavailable
}

#[cfg(test)]
mod tests {
    use super::*;
    use unifia_keyring_shim::{KEYRING_PREFIX, MockBackend, keyring_get, keyring_set};

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

    fn settings(password: &str, in_keychain: bool) -> RemoteConfig {
        RemoteConfig {
            enabled: false,
            password: password.into(),
            username: "unifia".into(),
            tls_enabled: false,
            password_in_keychain: in_keychain,
            password_session_only: false,
        }
    }

    /// A keychain whose reads fail while its writes are kept, so a stored value can be there and unseen.
    struct ReadsFail<'a> {
        inner: &'a MockBackend,
    }

    impl KeyringBackend for ReadsFail<'_> {
        fn get(&self, _service: &str, _key: &str) -> Result<Option<String>, String> {
            Err("read refused".into())
        }
        fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
            self.inner.set(service, key, value)
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    #[test]
    fn a_password_in_the_settings_file_moves_to_the_keychain() {
        let store = MockBackend::new();
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Migrated);
        assert!(config.password_in_keychain);
        assert_eq!(
            keyring_get(&store, SERVICE, KEY).unwrap().as_deref(),
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
    fn the_settings_bytes_after_a_migration_hold_no_password_value() {
        let store = MockBackend::new();
        let password = "legacy-password-0123456789";
        let mut config = settings(password, false);
        resolve(&mut config, &store);

        let on_disk = serde_json::to_string(&persist(&config, &store).unwrap()).unwrap();

        assert!(
            !on_disk.contains(password),
            "the password must not reach the settings file: {on_disk}"
        );
        assert!(on_disk.contains("\"password_in_keychain\":true"));
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
        keyring_set(&store, SERVICE, KEY, "stored-password-0123456789").unwrap();
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
            keyring_get(&store, SERVICE, KEY).unwrap().as_deref(),
            Some(config.password.as_str())
        );
    }

    #[test]
    fn a_legacy_password_does_not_replace_a_different_keychain_value() {
        let store = MockBackend::new();
        keyring_set(&store, SERVICE, KEY, "keychain-password-0123456789").unwrap();
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Superseded);
        assert_eq!(
            keyring_get(&store, SERVICE, KEY).unwrap().as_deref(),
            Some("keychain-password-0123456789")
        );
        assert_eq!(config.password, "keychain-password-0123456789");
        assert!(config.password_in_keychain);
    }

    #[test]
    fn a_legacy_password_is_not_written_while_the_keychain_cannot_be_read() {
        let inner = MockBackend::new();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &store), Resolution::LegacyKept);
        assert_eq!(
            keyring_get(&inner, SERVICE, KEY).unwrap(),
            None,
            "the legacy password reached a keychain that could not be read"
        );
        assert_eq!(config.password, "legacy-password-0123456789");
    }

    #[test]
    fn a_superseded_legacy_password_is_reported() {
        let text = warning(&Resolution::Superseded).expect("a superseded password is warned");

        assert!(text.contains("keychain's stays active"), "{text}");
    }

    #[test]
    fn the_remote_password_never_adopts_the_legacy_namespace() {
        let store = MockBackend::new();
        store
            .set("opencode.remote", KEY, "other-product-0123456789")
            .unwrap();
        let mut config = settings("", true);

        let resolution = resolve(&mut config, &store);

        assert_eq!(resolution, Resolution::Lost, "the legacy entry was adopted");
        assert_ne!(config.password, "other-product-0123456789");
        assert_eq!(
            store.get(NAMESPACE, KEY).unwrap().as_deref(),
            Some(config.password.as_str())
        );
        assert_eq!(
            store.get("opencode.remote", KEY).unwrap().as_deref(),
            Some("other-product-0123456789"),
            "the other product's entry was changed"
        );
    }

    #[test]
    fn the_remote_namespace_is_the_brand_prefix_and_the_service() {
        assert_eq!(NAMESPACE, format!("{KEYRING_PREFIX}.{SERVICE}"));
    }

    #[test]
    fn a_lost_entry_is_warned_with_the_instruction_to_pair_again() {
        let text = warning(&Resolution::Lost).expect("a lost entry is warned");

        assert!(
            text.contains("pair again"),
            "the warning must say so: {text}"
        );
        assert!(warning(&Resolution::Generated).is_none());
        assert!(warning(&Resolution::Keychain).is_none());
    }

    #[test]
    fn a_first_launch_generates_a_password_in_the_keychain() {
        let store = MockBackend::new();
        let mut config = settings("", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Generated);
        assert!(!config.password.trim().is_empty());
        assert!(config.password_in_keychain);
        assert_eq!(
            keyring_get(&store, SERVICE, KEY).unwrap().as_deref(),
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

    #[test]
    fn a_save_after_a_failed_read_leaves_the_stored_password_in_the_keychain() {
        let inner = MockBackend::new();
        keyring_set(&inner, SERVICE, KEY, "stored-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("", true);
        assert_eq!(resolve(&mut config, &store), Resolution::Unavailable);

        // An incidental save, such as toggling remote access, while the keychain cannot be read.
        let form = persist(&config, &store).unwrap();

        assert_eq!(
            keyring_get(&inner, SERVICE, KEY).unwrap().as_deref(),
            Some("stored-password-0123456789"),
            "a session-only password replaced the stored one"
        );
        assert_eq!(form.password, "");
        assert!(
            form.password_in_keychain,
            "the stored password is still the one to read"
        );
    }

    #[test]
    fn a_password_the_owner_chooses_is_written_after_a_failed_read() {
        let inner = MockBackend::new();
        keyring_set(&inner, SERVICE, KEY, "stored-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("", true);
        resolve(&mut config, &store);

        replace(&mut config, "chosen-by-owner-0123456789".into());
        persist(&config, &store).unwrap();

        assert_eq!(
            keyring_get(&inner, SERVICE, KEY).unwrap().as_deref(),
            Some("chosen-by-owner-0123456789")
        );
    }
}
