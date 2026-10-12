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
//! user never share a password, so a reset in one never changes the other. The entry that every install shared before that is
//! adopted once, by an install whose settings flag says it wrote there (`adopt_shared`), and it is never changed.
//!
//! A process holds one password for its whole run: the first load fixes it (`RunPassword`), and every later load returns it.
//! The sidecar is started with that first password, so the password the UI shows must be the same. A keychain that changes during
//! the run is read again on each load, but it decides only what a save may write, never the password the run uses.

use std::sync::{Mutex, MutexGuard, PoisonError};

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

/// The namespace that every install of the user shared before each install had its own entry: the brand prefix and the service.
/// It is read by one adoption (`adopt_shared`) and never written or deleted. It is read and written through the raw backend only:
/// the shim's helpers would fall back to the legacy `opencode.` namespace, which another product may write.
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

    /// The password in the shared entry. Read only by `adopt_shared`.
    fn shared_read(&self) -> Result<Option<String>, String> {
        self.store.get(&shared_namespace(), KEY)
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
    /// The install's own entry holds the password: the shared entry's password was copied there (the shared entry is unchanged), or
    /// an earlier launch copied it. The settings file must be rewritten, to record that the install has its own entry.
    Adopted,
    /// The settings file flagged the password as stored, or the settings cannot be read at all, and the keychain holds none: a new
    /// one is in the keychain, and clients paired with an earlier one must pair again. The caller warns.
    Lost,
    /// The keychain cannot be read or written. The settings file's password stays as it is, and the caller warns.
    LegacyKept,
    /// The settings file held a password that differs from the keychain's. The keychain's stays active, the settings file's
    /// is dropped, and the settings file must be rewritten. The caller warns.
    Superseded,
    /// The keychain cannot be read or written, or it does not hold the run's password. The run keeps its password, and a save
    /// writes nothing to the keychain. The caller warns.
    Unavailable,
    /// A later load of the run found the keychain holding a different password. The run keeps its own, and a save does not
    /// overwrite the keychain's. The caller warns.
    Diverged,
}

/// Resolve the password a configuration holds, against this install's keychain entry. A flagged configuration that has its own
/// entry reads that entry. A flagged configuration without one was written before the entries were per install, and adopts (see
/// `adopt_shared`). A password in clear moves to the entry, and no password at all generates one.
pub fn resolve(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    if config.password_in_keychain && config.password_in_own_entry {
        return match keychain.own_read() {
            Ok(Some(password)) if !password.trim().is_empty() => {
                config.password = password;
                Resolution::Keychain
            }
            Ok(_) => lost(config, keychain),
            Err(_) => session_only(config),
        };
    }
    if config.password_in_keychain {
        return adopt_shared(config, keychain);
    }
    if config.password.trim().is_empty() {
        return generate(config, keychain);
    }
    migrate_legacy(config, keychain)
}

/// The password when the settings file cannot be read, so nothing is known from it. The keychain decides: a password it holds is
/// used, and a new one is generated and kept only when it holds none. That generation is reported as `Lost`, so the caller logs
/// that clients paired with an earlier password must pair again. The settings file, which would say whether a password was
/// expected, cannot be read, so this report cannot be narrowed to the cases where one was.
pub fn resolve_without_settings(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    // Without the settings file nothing shows that this install wrote the shared entry, so that entry is never adopted here: the
    // install's own entry is the only one read.
    config.password_in_keychain = true;
    config.password_in_own_entry = true;
    resolve(config, keychain)
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
            config.password_in_own_entry = true;
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
                    config.password_in_own_entry = true;
                    Resolution::Migrated
                }
                _ => legacy_kept(config),
            }
        }
    }
}

/// A configuration that flags the password as stored, but does not say it is in the install's own entry: it was written before the
/// entries were per install, to the shared one. Its password is copied to the install's own entry, once. The shared entry is never
/// changed or deleted, and an install that holds its own entry does not read it again: a password the install no longer finds in
/// its entry is lost, and the install generates a new one, rather than adopting whatever the shared entry holds by then.
fn adopt_shared(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    match keychain.own_read() {
        Err(_) => session_only(config),
        // An earlier launch copied the password, and its settings were not saved: the install's own entry is the one.
        Ok(Some(own)) if !own.trim().is_empty() => adopted(config, own),
        Ok(_) => match keychain.shared_read() {
            Err(_) => session_only(config),
            Ok(Some(shared)) if !shared.trim().is_empty() => copy_shared(config, keychain, shared),
            Ok(_) => lost(config, keychain),
        },
    }
}

/// The shared password is written to the install's entry and read back. If that does not hold, the run keeps the shared password for
/// this run only, and the entry stays unclaimed: the next launch adopts again.
fn copy_shared(config: &mut RemoteConfig, keychain: &Keychain<'_>, shared: String) -> Resolution {
    let copied = keychain.own_write(&shared).is_ok()
        && matches!(keychain.own_read(), Ok(Some(ref back)) if *back == shared);
    if copied {
        adopted(config, shared)
    } else {
        run_only(config, shared)
    }
}

fn adopted(config: &mut RemoteConfig, password: String) -> Resolution {
    config.password = password;
    config.password_in_keychain = true;
    config.password_in_own_entry = true;
    config.password_session_only = false;
    config.password_legacy_kept = false;
    Resolution::Adopted
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
        form.password_in_own_entry = true;
    }
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
            "the system keychain cannot be read or written, or does not hold this run's remote password: this run keeps its password, and a save does not write it to the keychain",
        ),
        Resolution::Diverged => Some(
            "the remote password in the system keychain differs from the one this run uses: this run keeps its password, and a save does not overwrite the keychain's; from the next launch the keychain's is used, and clients paired with this run's password must pair again",
        ),
        Resolution::Superseded => Some(
            "the remote password in the settings file differs from the one in the system keychain: the keychain's stays active, and the settings file's is dropped",
        ),
        Resolution::Keychain
        | Resolution::Migrated
        | Resolution::Generated
        | Resolution::Adopted => None,
    }
}

/// The flag said the keychain held a password and it holds none. The password is regenerated, and the caller is told it was lost.
fn lost(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    match generate(config, keychain) {
        Resolution::Generated => Resolution::Lost,
        other => other,
    }
}

/// A password the owner chose, or a reset: the next save writes it to the keychain, even if the stored one could not be read.
pub fn replace(config: &mut RemoteConfig, password: String) {
    config.password = password;
    config.password_session_only = false;
    config.password_legacy_kept = false;
    config.password_from_settings = false;
}

/// A new password, kept in the keychain. The keychain is read first: a password it already holds is kept, never replaced, and a
/// keychain that cannot be read gets no write, since what it holds is unknown.
fn generate(config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
    // Whatever follows, this install takes its own entry: a later launch must not adopt the shared one in its place.
    config.password_in_own_entry = true;
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
        Err(_) => run_only(config, session_password()),
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

fn session_only(config: &mut RemoteConfig) -> Resolution {
    run_only(config, session_password())
}

/// The run keeps `password` for this run only. Nothing from it is written, and the configuration does not record it in the keychain.
/// Whether the install has its own entry is left as it was.
fn run_only(config: &mut RemoteConfig, password: String) -> Resolution {
    config.password = password;
    config.password_in_keychain = false;
    config.password_session_only = true;
    Resolution::Unavailable
}

/// Where the password a run holds came from. It decides what a later load of the run may write to the keychain.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Origin {
    /// The keychain holds it, or this run wrote it there. A later load may write it to a keychain that is empty.
    Stored,
    /// The settings file held it in clear, and the keychain could not be read when the run started. The settings file keeps it.
    Legacy,
    /// It was drawn for this run, because the keychain could not be used. Nothing from it is written, by a load or by a save.
    Session,
}

/// The password a run holds, and where it came from. It has no `Debug`: the password must not reach a debug print.
struct Held {
    password: String,
    origin: Origin,
}

/// The password of this process. The first load fixes it, and each later load of the process returns it, because the sidecar was
/// started with the first one. The keychain is read on every load, but only to decide what a save may write. The owner's set or
/// reset replaces the password, once the keychain has accepted it.
pub struct RunPassword(Mutex<Option<Held>>);

/// The password of the desktop process. `load_remote_config` and the owner's commands use it.
pub static RUN_PASSWORD: RunPassword = RunPassword::new();

impl RunPassword {
    pub const fn new() -> Self {
        Self(Mutex::new(None))
    }

    /// A load of the configuration. The first load of the process resolves it against the keychain; a later one holds the password
    /// of the first.
    pub fn load(&self, config: &mut RemoteConfig, keychain: &Keychain<'_>) -> Resolution {
        self.hold(config, keychain, resolve)
    }

    /// The same, for a process whose settings file cannot be read (see `resolve_without_settings`).
    pub fn load_without_settings(
        &self,
        config: &mut RemoteConfig,
        keychain: &Keychain<'_>,
    ) -> Resolution {
        self.hold(config, keychain, resolve_without_settings)
    }

    /// The keychain has accepted the password the owner set or reset. The run holds it from now on, so the UI shows it. The sidecar
    /// keeps the password it was started with until the next launch.
    pub fn adopt(&self, password: &str) {
        *self.lock() = Some(Held {
            password: password.to_string(),
            origin: Origin::Stored,
        });
    }

    fn hold(
        &self,
        config: &mut RemoteConfig,
        keychain: &Keychain<'_>,
        first: fn(&mut RemoteConfig, &Keychain<'_>) -> Resolution,
    ) -> Resolution {
        let mut held = self.lock();
        if let Some(run) = held.as_ref() {
            return hold_to_run(config, keychain, run);
        }
        let resolution = first(config, keychain);
        *held = Some(Held {
            password: config.password.clone(),
            origin: origin_of(&resolution, config),
        });
        resolution
    }

    /// The lock is held across the keychain calls of one load, so loads of the run do not interleave. A poisoned lock still holds
    /// the password, so it is taken as it is.
    fn lock(&self) -> MutexGuard<'_, Option<Held>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The origin of the password a first load resolved.
fn origin_of(resolution: &Resolution, config: &RemoteConfig) -> Origin {
    match resolution {
        Resolution::Keychain
        | Resolution::Migrated
        | Resolution::Generated
        | Resolution::Adopted
        | Resolution::Lost
        | Resolution::Superseded => Origin::Stored,
        Resolution::LegacyKept if config.password_from_settings => Origin::Legacy,
        Resolution::LegacyKept | Resolution::Unavailable | Resolution::Diverged => Origin::Session,
    }
}

/// A later load of the run. The password is the run's, whatever the keychain holds now. The keychain decides only what the
/// configuration may write: a value the run does not own is never overwritten, and a password drawn for the session is never
/// written.
fn hold_to_run(config: &mut RemoteConfig, keychain: &Keychain<'_>, run: &Held) -> Resolution {
    config.password = run.password.clone();
    config.password_from_settings = run.origin == Origin::Legacy;
    config.password_session_only = false;
    config.password_legacy_kept = false;
    config.password_in_keychain = false;
    match keychain.own_read() {
        Err(_) => unwritable(config, run.origin),
        Ok(Some(stored)) if stored == run.password => {
            config.password_in_keychain = true;
            config.password_in_own_entry = true;
            Resolution::Keychain
        }
        Ok(Some(stored)) if !stored.trim().is_empty() => {
            unwritable(config, run.origin);
            Resolution::Diverged
        }
        // The entry holds nothing, so the run's password can be written to it, as a generated one is. A session password is not.
        Ok(_) => match run.origin {
            Origin::Stored | Origin::Legacy => match keychain.own_write(&run.password) {
                Ok(()) => {
                    config.password_in_keychain = true;
                    config.password_in_own_entry = true;
                    Resolution::Keychain
                }
                Err(_) => unwritable(config, run.origin),
            },
            Origin::Session => unwritable(config, run.origin),
        },
    }
}

/// The keychain cannot be written now, or it holds another password, so the run keeps its password and nothing is written from it.
/// A legacy password stays in the settings file; any other is for the run only.
fn unwritable(config: &mut RemoteConfig, origin: Origin) -> Resolution {
    config.password_in_keychain = false;
    if origin == Origin::Legacy {
        config.password_legacy_kept = true;
        Resolution::LegacyKept
    } else {
        config.password_session_only = true;
        Resolution::Unavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use unifia_keyring_shim::MockBackend;

    /// The application identifiers of the two installs the tests compare, and the entries they name.
    const DEVELOPMENT: &str = "ai.unifia.workbench.dev";
    const STABLE: &str = "ai.unifia.desktop";
    const DEVELOPMENT_ENTRY: &str = "unifia.remote.dev";
    const STABLE_ENTRY: &str = "unifia.remote.stable";
    const SHARED_ENTRY: &str = "unifia.remote";
    const SHARED_PASSWORD: &str = "shared-password-0123456789";
    const STABLE_PASSWORD: &str = "stable-password-0123456789";
    const OTHER_PASSWORD: &str = "reset-elsewhere-0123456789";

    /// The keychain of the development install, the one most tests run as. The `resolve`, `persist` and `resolve_without_settings`
    /// of this module select its entry. A test that compares two installs names both keychains itself.
    fn development(store: &dyn KeyringBackend) -> Keychain<'_> {
        Keychain::for_identifier(store, DEVELOPMENT)
    }

    fn stable(store: &dyn KeyringBackend) -> Keychain<'_> {
        Keychain::for_identifier(store, STABLE)
    }

    fn resolve(config: &mut RemoteConfig, store: &dyn KeyringBackend) -> Resolution {
        super::resolve(config, &development(store))
    }

    fn persist(config: &RemoteConfig, store: &dyn KeyringBackend) -> Result<RemoteConfig, String> {
        super::persist(config, &development(store))
    }

    fn resolve_without_settings(
        config: &mut RemoteConfig,
        store: &dyn KeyringBackend,
    ) -> Resolution {
        super::resolve_without_settings(config, &development(store))
    }

    /// The development install's entry, as the store names it.
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
            password_in_own_entry: in_keychain,
            password_session_only: false,
            password_legacy_kept: false,
            password_from_settings: !password.trim().is_empty(),
        }
    }

    /// A settings file written before the entries were per install: the flag says the password is in the keychain, and nothing says
    /// which entry holds it.
    fn before_the_entries_were_per_install() -> RemoteConfig {
        RemoteConfig {
            password_in_own_entry: false,
            ..settings("", true)
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
    fn a_legacy_password_does_not_replace_a_different_keychain_value() {
        let store = MockBackend::new();
        own_set(&store, "keychain-password-0123456789").unwrap();
        let mut config = settings("legacy-password-0123456789", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Superseded);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
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
            own_get(&inner).unwrap(),
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
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
        assert_eq!(
            store.get("opencode.remote", KEY).unwrap().as_deref(),
            Some("other-product-0123456789"),
            "the other product's entry was changed"
        );
    }

    #[test]
    fn the_namespace_is_the_brand_prefix_the_service_and_the_flavour() {
        let store = MockBackend::new();

        assert_eq!(shared_namespace(), "unifia.remote");
        assert_eq!(
            Keychain::for_identifier(&store, DEVELOPMENT).namespace,
            "unifia.remote.dev"
        );
        assert_eq!(
            Keychain::for_identifier(&store, STABLE).namespace,
            "unifia.remote.stable"
        );
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
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
    }

    #[test]
    fn a_password_the_keychain_already_holds_is_kept_when_the_settings_have_none() {
        let store = MockBackend::new();
        own_set(&store, "stored-password-0123456789").unwrap();
        let mut config = settings("", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Keychain);
        assert_eq!(config.password, "stored-password-0123456789");
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some("stored-password-0123456789"),
            "a new password replaced the stored one"
        );
    }

    #[test]
    fn a_new_password_is_not_written_while_the_keychain_cannot_be_read() {
        let inner = MockBackend::new();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("", false);

        assert_eq!(resolve(&mut config, &store), Resolution::Unavailable);
        assert_eq!(
            own_get(&inner).unwrap(),
            None,
            "a new password was written over what the keychain may hold"
        );
        assert!(config.password_session_only);
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
        own_set(&inner, "stored-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("", true);
        assert_eq!(resolve(&mut config, &store), Resolution::Unavailable);

        // An incidental save, such as toggling remote access, while the keychain cannot be read.
        let form = persist(&config, &store).unwrap();

        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
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
    fn the_session_password_is_the_same_for_the_whole_run() {
        let mut first = settings("", true);
        let mut second = settings("", true);

        resolve(&mut first, &Unavailable);
        resolve(&mut second, &Unavailable);

        assert_eq!(
            first.password, second.password,
            "two loads in one run gave two different session passwords"
        );
    }

    #[test]
    fn without_settings_the_password_the_keychain_holds_is_used() {
        let store = MockBackend::new();
        own_set(&store, "stored-password-0123456789").unwrap();
        let mut config = settings("", false);

        assert_eq!(
            resolve_without_settings(&mut config, &store),
            Resolution::Keychain
        );
        assert_eq!(config.password, "stored-password-0123456789");
    }

    #[test]
    fn without_settings_a_password_is_generated_only_when_the_keychain_holds_none() {
        let store = MockBackend::new();
        let mut config = settings("", false);

        // Lost, not Generated: the generation is what a lost entry looks like without settings, and it must be warned (see the
        // warning test above). The expectation changed for that reason; the keychain outcome is unchanged.
        assert_eq!(
            resolve_without_settings(&mut config, &store),
            Resolution::Lost
        );
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
    }

    /// A keychain that records the namespace of every write, so a test can say which entries an install wrote.
    struct WritesRecorded<'a> {
        inner: &'a MockBackend,
        writes: std::sync::Mutex<Vec<String>>,
    }

    impl WritesRecorded<'_> {
        fn writes(&self) -> Vec<String> {
            self.writes.lock().unwrap().clone()
        }
    }

    impl KeyringBackend for WritesRecorded<'_> {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            self.inner.get(service, key)
        }
        fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
            self.writes.lock().unwrap().push(service.to_string());
            self.inner.set(service, key, value)
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    #[test]
    fn without_settings_a_populated_shared_entry_is_neither_adopted_nor_written() {
        // Without the settings file nothing says this install wrote the shared entry. The own entry is empty, and that path must not
        // fall through to adopting the shared one: the password is generated into the own entry and reported as lost, and the shared
        // entry is neither adopted nor written.
        let inner = MockBackend::new();
        inner.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let store = WritesRecorded {
            inner: &inner,
            writes: std::sync::Mutex::new(Vec::new()),
        };
        let mut config = settings("", false);

        let resolution = resolve_without_settings(&mut config, &store);

        assert_eq!(resolution, Resolution::Lost);
        assert_ne!(config.password, SHARED_PASSWORD);
        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some(config.password.as_str())
        );
        assert!(
            !store
                .writes()
                .iter()
                .any(|namespace| namespace == SHARED_ENTRY),
            "the shared entry was written: {:?}",
            store.writes()
        );
    }

    /// A keychain whose reads can be refused, switched between loads, as a keychain does when its state changes during a run.
    struct Switchable<'a> {
        inner: &'a MockBackend,
        readable: std::sync::atomic::AtomicBool,
    }

    impl Switchable<'_> {
        fn set_readable(&self, readable: bool) {
            self.readable
                .store(readable, std::sync::atomic::Ordering::SeqCst);
        }
    }

    impl KeyringBackend for Switchable<'_> {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            if self.readable.load(std::sync::atomic::Ordering::SeqCst) {
                self.inner.get(service, key)
            } else {
                Err("read refused".into())
            }
        }
        fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
            self.inner.set(service, key, value)
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    /// One load of a run, as `load_remote_config` makes it: the configuration comes from the settings file, flagged as stored.
    fn load_as_the_settings_file_gives_it(
        run: &RunPassword,
        store: &dyn KeyringBackend,
    ) -> (RemoteConfig, Resolution) {
        let mut config = settings("", true);
        let resolution = run.load(&mut config, &development(store));
        (config, resolution)
    }

    #[test]
    fn every_load_of_a_run_gives_the_password_the_run_started_with() {
        let inner = MockBackend::new();
        own_set(&inner, "started-password-0123456789").unwrap();
        let store = Switchable {
            inner: &inner,
            readable: std::sync::atomic::AtomicBool::new(true),
        };
        let run = RunPassword::new();
        let (started, _) = load_as_the_settings_file_gives_it(&run, &store);
        assert_eq!(started.password, "started-password-0123456789");

        store.set_readable(false);
        let (unreadable, _) = load_as_the_settings_file_gives_it(&run, &store);
        assert_eq!(
            unreadable.password, "started-password-0123456789",
            "a load with the keychain unreadable showed another password than the sidecar checks"
        );

        store.set_readable(true);
        inner.delete(DEVELOPMENT_ENTRY, KEY).unwrap();
        let (emptied, resolution) = load_as_the_settings_file_gives_it(&run, &store);
        assert_eq!(
            emptied.password, "started-password-0123456789",
            "a load after the keychain was emptied showed another password than the sidecar checks"
        );
        assert_ne!(
            resolution,
            Resolution::Lost,
            "a lost entry was reported for a run that had a password"
        );
    }

    #[test]
    fn a_keychain_holding_another_password_is_not_overwritten_by_a_save_of_the_run() {
        let inner = MockBackend::new();
        own_set(&inner, "started-password-0123456789").unwrap();
        let run = RunPassword::new();
        load_as_the_settings_file_gives_it(&run, &inner);
        // Another install of the same user resets the shared entry during this run.
        own_set(&inner, "other-install-password-0123456789").unwrap();

        let (mut config, resolution) = load_as_the_settings_file_gives_it(&run, &inner);
        let form = persist(&config, &inner).unwrap();

        assert_eq!(resolution, Resolution::Diverged);
        assert_eq!(config.password, "started-password-0123456789");
        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some("other-install-password-0123456789"),
            "a save of this run overwrote the other install's password"
        );
        assert_eq!(form.password, "");
        // Once the owner's password is replaced, the run holds that one, and a save writes it.
        replace(&mut config, "chosen-by-owner-0123456789".into());
        persist(&config, &inner).unwrap();
        run.adopt(&config.password);
        let (after, _) = load_as_the_settings_file_gives_it(&run, &inner);
        assert_eq!(after.password, "chosen-by-owner-0123456789");
    }

    #[test]
    fn a_session_password_is_never_written_even_once_the_keychain_is_readable_and_empty() {
        let inner = MockBackend::new();
        let unreadable = ReadsFail { inner: &inner };
        let run = RunPassword::new();
        let (session, _) = load_as_the_settings_file_gives_it(&run, &unreadable);

        let (later, resolution) = load_as_the_settings_file_gives_it(&run, &inner);
        let form = persist(&later, &inner).unwrap();

        assert_eq!(later.password, session.password);
        assert_eq!(resolution, Resolution::Unavailable);
        assert_eq!(
            own_get(&inner).unwrap(),
            None,
            "a password drawn for the session was written to the keychain"
        );
        assert_eq!(form.password, "");
    }

    #[test]
    fn without_settings_a_password_generated_over_an_empty_keychain_is_warned_as_lost() {
        let store = MockBackend::new();
        let mut config = settings("", false);

        let resolution = resolve_without_settings(&mut config, &store);

        let text = warning(&resolution)
            .expect("a password generated because the keychain is empty must be warned");
        assert!(text.contains("pair again"), "{text}");
    }

    #[test]
    fn a_password_the_owner_chooses_is_written_after_a_failed_read() {
        let inner = MockBackend::new();
        own_set(&inner, "stored-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("", true);
        resolve(&mut config, &store);

        replace(&mut config, "chosen-by-owner-0123456789".into());
        persist(&config, &store).unwrap();

        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some("chosen-by-owner-0123456789")
        );
    }

    #[test]
    fn a_legacy_password_does_not_replace_the_keychain_on_a_save_while_the_keychain_cannot_be_read()
    {
        let inner = MockBackend::new();
        own_set(&inner, "keychain-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        let mut config = settings("legacy-password-0123456789", false);
        assert_eq!(resolve(&mut config, &store), Resolution::LegacyKept);

        // An incidental save, such as toggling remote access, while the keychain cannot be read.
        let form = persist(&config, &store).unwrap();

        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some("keychain-password-0123456789"),
            "the legacy password replaced the keychain's"
        );
        assert_eq!(
            form.password, "legacy-password-0123456789",
            "the settings file must keep the legacy password it held"
        );
        assert!(!form.password_in_keychain);
    }

    #[test]
    fn the_random_default_without_a_remote_section_does_not_replace_the_keychain_on_a_save() {
        let inner = MockBackend::new();
        own_set(&inner, "keychain-password-0123456789").unwrap();
        let store = ReadsFail { inner: &inner };
        // No remote section: the configuration is the default, whose password was never in the settings file.
        let mut config = RemoteConfig::default();
        assert_eq!(resolve(&mut config, &store), Resolution::LegacyKept);

        let form = persist(&config, &store).unwrap();

        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some("keychain-password-0123456789"),
            "the default password replaced the keychain's"
        );
        assert_eq!(
            form.password, "",
            "a password that was never in the settings file reached it"
        );
    }

    /// A keychain that records the namespace of every read, so a test can say which entries an install read.
    struct Recording<'a> {
        inner: &'a MockBackend,
        reads: std::sync::Mutex<Vec<String>>,
    }

    impl Recording<'_> {
        fn reads(&self) -> Vec<String> {
            self.reads.lock().unwrap().clone()
        }
    }

    impl KeyringBackend for Recording<'_> {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            self.reads.lock().unwrap().push(service.to_string());
            self.inner.get(service, key)
        }
        fn set(&self, service: &str, key: &str, value: &str) -> Result<(), String> {
            self.inner.set(service, key, value)
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    /// A keychain that refuses every write, and reads what the inner keychain holds.
    struct WritesRefused<'a> {
        inner: &'a MockBackend,
    }

    impl KeyringBackend for WritesRefused<'_> {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            self.inner.get(service, key)
        }
        fn set(&self, _service: &str, _key: &str, _value: &str) -> Result<(), String> {
            Err("write refused".into())
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    /// A keychain that accepts a write and keeps nothing of it, so the value cannot be read back.
    struct WritesForgotten<'a> {
        inner: &'a MockBackend,
    }

    impl KeyringBackend for WritesForgotten<'_> {
        fn get(&self, service: &str, key: &str) -> Result<Option<String>, String> {
            self.inner.get(service, key)
        }
        fn set(&self, _service: &str, _key: &str, _value: &str) -> Result<(), String> {
            Ok(())
        }
        fn delete(&self, service: &str, key: &str) -> Result<(), String> {
            self.inner.delete(service, key)
        }
    }

    #[test]
    fn two_installs_generate_two_passwords_each_in_its_own_entry() {
        let store = MockBackend::new();
        let mut dev_config = settings("", false);
        let mut stable_config = settings("", false);

        assert_eq!(
            super::resolve(&mut dev_config, &development(&store)),
            Resolution::Generated
        );
        assert_eq!(
            super::resolve(&mut stable_config, &stable(&store)),
            Resolution::Generated
        );

        assert_ne!(dev_config.password, stable_config.password);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(dev_config.password.as_str())
        );
        assert_eq!(
            store.get(STABLE_ENTRY, KEY).unwrap().as_deref(),
            Some(stable_config.password.as_str())
        );
        assert_eq!(
            store.get(SHARED_ENTRY, KEY).unwrap(),
            None,
            "the shared entry was written"
        );
    }

    #[test]
    fn a_reset_in_one_install_does_not_change_the_password_of_another() {
        // The development and the stable build of one user, each with its own settings file. The development install resets its
        // password. The stable install's next launch must still give the password it started with.
        let store = MockBackend::new();
        let mut dev_config = settings("", false);
        super::resolve(&mut dev_config, &development(&store));
        let mut stable_config = settings("", false);
        super::resolve(&mut stable_config, &stable(&store));
        let stable_started = stable_config.password.clone();
        super::persist(&stable_config, &stable(&store)).unwrap();

        replace(&mut dev_config, "reset-in-development-0123456789".into());
        super::persist(&dev_config, &development(&store)).unwrap();

        let mut stable_next = settings("", true);
        super::resolve(&mut stable_next, &stable(&store));

        assert_eq!(
            stable_next.password, stable_started,
            "a reset in the development install changed the stable install's password"
        );
    }

    #[test]
    fn the_flavour_is_named_by_the_application_identifier_of_each_build() {
        assert_eq!(flavour("ai.unifia.workbench.dev"), "dev");
        assert_eq!(flavour("ai.unifia.workbench.beta"), "beta");
        assert_eq!(flavour("ai.unifia.desktop"), "stable");
        // Changed with the custom prefix (F2): an identifier that is not an official build is named `custom-<identifier>`, so
        // it cannot name an official flavour. The expectation was the identifier itself, which is what let `dev` collide.
        assert_eq!(flavour("ai.example.other"), "custom-ai.example.other");
    }

    #[test]
    fn a_non_official_identifier_is_named_with_the_custom_prefix() {
        assert_eq!(flavour("dev"), "custom-dev");
        assert_eq!(flavour("beta"), "custom-beta");
        assert_eq!(flavour("stable"), "custom-stable");
    }

    #[test]
    fn no_non_official_identifier_names_an_official_namespace() {
        let store = MockBackend::new();
        let official = [
            "ai.unifia.workbench.dev",
            "ai.unifia.workbench.beta",
            STABLE,
        ]
        .map(|identifier| Keychain::for_identifier(&store, identifier).namespace);
        for identifier in ["dev", "beta", "stable", "ai.example.other"] {
            let namespace = Keychain::for_identifier(&store, identifier).namespace;
            assert!(
                !official.contains(&namespace),
                "{identifier} names the official namespace {namespace}"
            );
        }
    }

    #[test]
    fn an_install_whose_identifier_is_dev_does_not_read_or_write_the_development_entry() {
        let store = MockBackend::new();
        own_set(&store, "development-password-0123456789").unwrap();
        let other = Keychain::for_identifier(&store, "dev");

        assert_eq!(other.own_read(), Ok(None));
        other
            .own_write("other-install-password-0123456789")
            .unwrap();
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some("development-password-0123456789")
        );
    }

    #[test]
    fn a_case_variant_of_a_flavour_name_has_its_own_namespace() {
        // Each spelling is a different install, so each has its own entry: the lowercase official names and their variants never
        // share one. The variants are not official, so they do not name an official entry either.
        let store = MockBackend::new();
        let namespaces: Vec<String> = [DEVELOPMENT, "dev", "Dev", "DEV", "ai.unifia.workbench.DEV"]
            .map(|identifier| Keychain::for_identifier(&store, identifier).namespace)
            .to_vec();
        for (index, namespace) in namespaces.iter().enumerate() {
            for other in &namespaces[index + 1..] {
                assert_ne!(namespace, other, "two spellings share {namespace}");
            }
        }
        assert_eq!(flavour("Dev"), "custom-Dev");
        assert_eq!(
            Keychain::for_identifier(&store, DEVELOPMENT).namespace,
            "unifia.remote.dev"
        );
    }

    #[test]
    fn a_new_install_without_a_flag_generates_its_own_entry_and_never_reads_the_shared_one() {
        let inner = MockBackend::new();
        inner.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let store = Recording {
            inner: &inner,
            reads: std::sync::Mutex::new(Vec::new()),
        };
        let mut config = settings("", false);

        let resolution = resolve(&mut config, &store);

        assert_eq!(resolution, Resolution::Generated);
        assert!(
            !store
                .reads()
                .iter()
                .any(|namespace| namespace == SHARED_ENTRY),
            "the shared entry was read: {:?}",
            store.reads()
        );
        assert_ne!(config.password, SHARED_PASSWORD);
        assert_eq!(
            own_get(&inner).unwrap().as_deref(),
            Some(config.password.as_str())
        );
        assert_eq!(
            inner.get(SHARED_ENTRY, KEY).unwrap().as_deref(),
            Some(SHARED_PASSWORD),
            "the shared entry changed"
        );
    }

    #[test]
    fn a_flagged_install_adopts_the_shared_password_once_and_leaves_the_shared_entry_unchanged() {
        let store = MockBackend::new();
        store.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let mut config = before_the_entries_were_per_install();

        let resolution = resolve(&mut config, &store);

        assert_eq!(resolution, Resolution::Adopted);
        assert_eq!(config.password, SHARED_PASSWORD);
        assert_eq!(own_get(&store).unwrap().as_deref(), Some(SHARED_PASSWORD));
        assert_eq!(
            store.get(SHARED_ENTRY, KEY).unwrap().as_deref(),
            Some(SHARED_PASSWORD),
            "the shared entry was changed"
        );
        assert!(warning(&resolution).is_none());
        let form = persist(&config, &store).unwrap();
        assert!(form.password_in_keychain);
        assert!(
            form.password_in_own_entry,
            "the settings file does not record the own entry"
        );
        assert_eq!(form.password, "");
    }

    #[test]
    fn an_adopted_install_never_adopts_the_shared_entry_again() {
        let store = MockBackend::new();
        store.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let mut first = before_the_entries_were_per_install();
        resolve(&mut first, &store);
        let form = persist(&first, &store).unwrap();
        // Another install of the user resets the shared entry after the adoption.
        store.set(SHARED_ENTRY, KEY, OTHER_PASSWORD).unwrap();

        let mut next_launch = form.clone();
        assert_eq!(resolve(&mut next_launch, &store), Resolution::Keychain);
        assert_eq!(
            next_launch.password, SHARED_PASSWORD,
            "the install took the shared entry's new password"
        );

        // The install's own entry is then lost. The shared entry holds another password by now: it is not adopted.
        store.delete(DEVELOPMENT_ENTRY, KEY).unwrap();
        let mut lost = form;
        let resolution = resolve(&mut lost, &store);

        assert_eq!(resolution, Resolution::Lost);
        assert_ne!(
            lost.password, OTHER_PASSWORD,
            "the shared entry was adopted again"
        );
        assert_eq!(
            store.get(SHARED_ENTRY, KEY).unwrap().as_deref(),
            Some(OTHER_PASSWORD),
            "the shared entry was changed"
        );
    }

    #[test]
    fn a_flagged_install_whose_shared_entry_is_empty_is_reported_lost_and_writes_nothing_shared() {
        let store = MockBackend::new();
        let mut config = before_the_entries_were_per_install();

        let resolution = resolve(&mut config, &store);

        assert_eq!(resolution, Resolution::Lost);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(config.password.as_str())
        );
        assert_eq!(
            store.get(SHARED_ENTRY, KEY).unwrap(),
            None,
            "the shared entry was written"
        );
    }

    #[test]
    fn an_adoption_that_cannot_be_copied_keeps_the_shared_password_for_the_run_only_and_is_retried()
    {
        let inner = MockBackend::new();
        inner.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let refused = WritesRefused { inner: &inner };
        let mut config = before_the_entries_were_per_install();

        assert_eq!(resolve(&mut config, &refused), Resolution::Unavailable);
        assert_eq!(
            config.password, SHARED_PASSWORD,
            "the run does not keep the shared password"
        );
        assert!(
            !config.password_in_own_entry,
            "the install claimed its entry without a copy"
        );
        assert_eq!(own_get(&inner).unwrap(), None);

        let form = persist(&config, &inner).unwrap();
        assert!(!form.password_in_own_entry);
        assert_eq!(form.password, "");

        // A later launch whose keychain takes the copy adopts it.
        let mut later = form;
        assert_eq!(resolve(&mut later, &inner), Resolution::Adopted);
        assert_eq!(later.password, SHARED_PASSWORD);
        assert_eq!(own_get(&inner).unwrap().as_deref(), Some(SHARED_PASSWORD));
    }

    #[test]
    fn an_adoption_whose_copy_is_not_read_back_is_not_recorded_as_the_own_entry() {
        let inner = MockBackend::new();
        inner.set(SHARED_ENTRY, KEY, SHARED_PASSWORD).unwrap();
        let forgetful = WritesForgotten { inner: &inner };
        let mut config = before_the_entries_were_per_install();

        assert_eq!(resolve(&mut config, &forgetful), Resolution::Unavailable);
        assert_eq!(config.password, SHARED_PASSWORD);
        assert!(!config.password_in_own_entry);
    }

    #[test]
    fn a_change_in_another_installs_entry_does_not_make_this_run_diverge() {
        let store = MockBackend::new();
        own_set(&store, SHARED_PASSWORD).unwrap();
        store.set(STABLE_ENTRY, KEY, STABLE_PASSWORD).unwrap();
        let run = RunPassword::new();
        let (started, _) = load_as_the_settings_file_gives_it(&run, &store);
        assert_eq!(started.password, SHARED_PASSWORD);

        // The stable install resets its own entry during the development run.
        store.set(STABLE_ENTRY, KEY, OTHER_PASSWORD).unwrap();

        let (config, resolution) = load_as_the_settings_file_gives_it(&run, &store);

        assert_eq!(
            resolution,
            Resolution::Keychain,
            "another install's entry made this run diverge"
        );
        assert_eq!(config.password, SHARED_PASSWORD);
    }

    #[test]
    fn the_password_of_one_launch_is_the_one_the_next_launch_holds_after_a_restart() {
        // Launch one generates the password and saves the settings file as the desktop writes it, as JSON. Launch two is a new
        // process, with a new run: it reads the settings file back and the keychain. The password is the same, and the flag that
        // names the own entry survives the file, so the shared entry is not adopted on that launch.
        let store = MockBackend::new();
        let mut first_launch = settings("", false);
        assert_eq!(resolve(&mut first_launch, &store), Resolution::Generated);
        let saved = serde_json::to_string(&persist(&first_launch, &store).unwrap()).unwrap();

        let mut second_launch: RemoteConfig = serde_json::from_str(&saved).unwrap();
        assert!(
            second_launch.password_in_own_entry,
            "the settings file lost the own-entry flag"
        );
        let resolution = RunPassword::new().load(&mut second_launch, &development(&store));

        assert_eq!(resolution, Resolution::Keychain);
        assert_eq!(
            second_launch.password, first_launch.password,
            "the password changed across a restart"
        );
    }

    #[test]
    fn a_lost_entry_is_replaced_once_and_the_replacement_is_kept_across_a_restart() {
        let store = MockBackend::new();
        // The settings file flags the entry, and the entry is gone.
        let mut first_launch = settings("", true);
        assert_eq!(resolve(&mut first_launch, &store), Resolution::Lost);
        let saved = serde_json::to_string(&persist(&first_launch, &store).unwrap()).unwrap();

        let mut second_launch: RemoteConfig = serde_json::from_str(&saved).unwrap();
        let resolution = RunPassword::new().load(&mut second_launch, &development(&store));

        assert_eq!(
            resolution,
            Resolution::Keychain,
            "the replacement was reported as lost again"
        );
        assert_eq!(second_launch.password, first_launch.password);
        assert_eq!(
            own_get(&store).unwrap().as_deref(),
            Some(first_launch.password.as_str())
        );
    }
}
