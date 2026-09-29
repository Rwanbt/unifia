// SPDX-License-Identifier: MIT
//! Crash-conscious persistence for the portable VoiceCore snapshot.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{VoiceCore, VoiceCoreSnapshot};

const SNAPSHOT_SCHEMA: u32 = 1;
const MAX_SNAPSHOT_BYTES: u64 = 1024 * 1024;

#[derive(Debug)]
pub enum VoiceCoreSnapshotStoreError {
    Io(std::io::Error),
    InvalidSnapshot,
    StaleSnapshot,
    SnapshotTooLarge,
    RevisionExhausted,
    LockPoisoned,
}

impl std::fmt::Display for VoiceCoreSnapshotStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "snapshot storage I/O failed: {error}"),
            Self::InvalidSnapshot => formatter.write_str("snapshot is invalid or corrupt"),
            Self::StaleSnapshot => {
                formatter.write_str("snapshot would roll back stored Voice state")
            }
            Self::SnapshotTooLarge => formatter.write_str("snapshot exceeds the size limit"),
            Self::RevisionExhausted => formatter.write_str("snapshot revision is exhausted"),
            Self::LockPoisoned => formatter.write_str("snapshot store lock is poisoned"),
        }
    }
}

impl std::error::Error for VoiceCoreSnapshotStoreError {}

impl From<std::io::Error> for VoiceCoreSnapshotStoreError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

#[derive(Debug)]
pub struct VoiceCoreSnapshotStore {
    root: PathBuf,
    lock: Mutex<()>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SnapshotRecord {
    schema: u32,
    revision: u64,
    snapshot: VoiceCoreSnapshot,
    sha256: String,
}

#[derive(Serialize)]
struct SnapshotPayload<'a> {
    schema: u32,
    revision: u64,
    snapshot: &'a VoiceCoreSnapshot,
}

impl VoiceCoreSnapshotStore {
    /// Creates a session-scoped store rooted at an application-owned data directory.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            lock: Mutex::new(()),
        }
    }

    /// Loads the newest complete, checksum-verified snapshot, if one exists.
    pub fn load(&self) -> Result<Option<VoiceCoreSnapshot>, VoiceCoreSnapshotStoreError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| VoiceCoreSnapshotStoreError::LockPoisoned)?;
        self.load_unlocked()
            .map(|record| record.map(|(_, snapshot)| snapshot))
    }

    /// Persists a bounded snapshot while leaving the previous valid slot intact.
    pub fn persist(&self, snapshot: &VoiceCoreSnapshot) -> Result<(), VoiceCoreSnapshotStoreError> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| VoiceCoreSnapshotStoreError::LockPoisoned)?;
        VoiceCore::recover(snapshot.clone())
            .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?;
        fs::create_dir_all(&self.root)?;
        Self::validate_root(&self.root)?;

        let previous = self.load_unlocked()?;
        if let Some((_, previous_snapshot)) = &previous {
            if !snapshot.is_forward_of(previous_snapshot) {
                return Err(VoiceCoreSnapshotStoreError::StaleSnapshot);
            }
        }
        let revision = previous.as_ref().map_or(Ok(1), |(revision, _)| {
            revision
                .checked_add(1)
                .ok_or(VoiceCoreSnapshotStoreError::RevisionExhausted)
        })?;
        let payload = SnapshotPayload {
            schema: SNAPSHOT_SCHEMA,
            revision,
            snapshot,
        };
        let digest = Sha256::digest(
            serde_json::to_vec(&payload)
                .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?,
        );
        let record = SnapshotRecord {
            schema: SNAPSHOT_SCHEMA,
            revision,
            snapshot: snapshot.clone(),
            sha256: hex::encode(digest),
        };
        let contents = serde_json::to_vec(&record)
            .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?;
        if contents.len() as u64 > MAX_SNAPSHOT_BYTES {
            return Err(VoiceCoreSnapshotStoreError::SnapshotTooLarge);
        }

        self.write_slot(revision, &contents)
    }

    fn load_unlocked(
        &self,
    ) -> Result<Option<(u64, VoiceCoreSnapshot)>, VoiceCoreSnapshotStoreError> {
        match fs::symlink_metadata(&self.root) {
            Ok(_) => Self::validate_root(&self.root)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        }
        let slots = [self.read_slot(0)?, self.read_slot(1)?];
        match slots {
            [None, None] => Ok(None),
            [Some(first), None] | [None, Some(first)] => Ok(Some(first)),
            [Some(first), Some(second)] if first.0 == second.0 => {
                if first.1 == second.1 {
                    Ok(Some(first))
                } else {
                    Err(VoiceCoreSnapshotStoreError::InvalidSnapshot)
                }
            }
            [Some(first), Some(second)] => {
                Ok(Some(if first.0 > second.0 { first } else { second }))
            }
        }
    }

    fn read_slot(
        &self,
        slot: u8,
    ) -> Result<Option<(u64, VoiceCoreSnapshot)>, VoiceCoreSnapshotStoreError> {
        let path = self.slot_path(slot);
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(VoiceCoreSnapshotStoreError::InvalidSnapshot);
        }
        if metadata.len() > MAX_SNAPSHOT_BYTES {
            return Err(VoiceCoreSnapshotStoreError::SnapshotTooLarge);
        }
        let mut file = File::open(path)?;
        let mut contents = Vec::with_capacity(metadata.len() as usize);
        Read::take(&mut file, MAX_SNAPSHOT_BYTES + 1).read_to_end(&mut contents)?;
        if contents.len() as u64 > MAX_SNAPSHOT_BYTES {
            return Err(VoiceCoreSnapshotStoreError::SnapshotTooLarge);
        }
        let record: SnapshotRecord = serde_json::from_slice(&contents)
            .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?;
        if record.schema != SNAPSHOT_SCHEMA || record.revision == 0 {
            return Err(VoiceCoreSnapshotStoreError::InvalidSnapshot);
        }
        VoiceCore::recover(record.snapshot.clone())
            .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?;
        let payload = SnapshotPayload {
            schema: record.schema,
            revision: record.revision,
            snapshot: &record.snapshot,
        };
        let digest = Sha256::digest(
            serde_json::to_vec(&payload)
                .map_err(|_| VoiceCoreSnapshotStoreError::InvalidSnapshot)?,
        );
        if record.sha256 != hex::encode(digest) {
            return Err(VoiceCoreSnapshotStoreError::InvalidSnapshot);
        }
        Ok(Some((record.revision, record.snapshot)))
    }

    fn write_slot(
        &self,
        revision: u64,
        contents: &[u8],
    ) -> Result<(), VoiceCoreSnapshotStoreError> {
        let slot = (revision % 2) as u8;
        let target = self.slot_path(slot);
        let temporary = self
            .root
            .join(format!(".voice-core-{revision}-{}.tmp", std::process::id()));
        let result = self.write_and_promote(&temporary, &target, contents);
        if result.is_err() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    fn write_and_promote(
        &self,
        temporary: &Path,
        target: &Path,
        contents: &[u8],
    ) -> Result<(), VoiceCoreSnapshotStoreError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(temporary)?;
        file.write_all(contents)?;
        file.sync_all()?;
        drop(file);

        match fs::remove_file(target) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        fs::rename(temporary, target)?;
        #[cfg(unix)]
        File::open(&self.root)?.sync_all()?;
        Ok(())
    }

    fn slot_path(&self, slot: u8) -> PathBuf {
        self.root.join(format!("voice-core-{slot}.json"))
    }

    fn validate_root(root: &Path) -> Result<(), VoiceCoreSnapshotStoreError> {
        let metadata = fs::symlink_metadata(root)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err(VoiceCoreSnapshotStoreError::InvalidSnapshot);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::VoiceCoreError;

    fn test_root(label: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("voice-core-{label}-{}-{nonce}", std::process::id()))
    }

    #[test]
    fn round_trip_preserves_verified_turn_history() {
        let root = test_root("round-trip");
        let store = VoiceCoreSnapshotStore::new(&root);
        let mut core = VoiceCore::new("ses_store_round_trip").unwrap();
        core.begin_turn("turn_saved").unwrap();

        store.persist(&core.snapshot()).unwrap();
        let snapshot = store.load().unwrap().unwrap();
        let mut recovered = VoiceCore::recover(snapshot).unwrap();
        assert!(matches!(
            recovered.begin_turn("turn_saved"),
            Err(VoiceCoreError::DuplicateTurn)
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn incomplete_temporary_write_keeps_previous_revision_readable() {
        let root = test_root("two-slots");
        let store = VoiceCoreSnapshotStore::new(&root);
        let core = VoiceCore::new("ses_store_slots").unwrap();
        store.persist(&core.snapshot()).unwrap();
        store.persist(&core.snapshot()).unwrap();

        fs::remove_file(store.slot_path(1)).unwrap();
        fs::write(root.join(".voice-core-interrupted.tmp"), b"incomplete").unwrap();
        assert!(store.load().unwrap().is_some());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_corrupt_newest_snapshot_instead_of_replaying_stale_turns() {
        let root = test_root("corrupt-newest");
        let store = VoiceCoreSnapshotStore::new(&root);
        let core = VoiceCore::new("ses_store_corrupt").unwrap();
        store.persist(&core.snapshot()).unwrap();
        store.persist(&core.snapshot()).unwrap();
        fs::write(store.slot_path(0), b"corrupt").unwrap();

        assert!(matches!(
            store.load(),
            Err(VoiceCoreSnapshotStoreError::InvalidSnapshot)
        ));
        assert!(fs::read(store.slot_path(1)).is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_oversized_snapshot_before_deserializing_it() {
        let root = test_root("oversized");
        let store = VoiceCoreSnapshotStore::new(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(
            store.slot_path(0),
            vec![b' '; MAX_SNAPSHOT_BYTES as usize + 1],
        )
        .unwrap();

        assert!(matches!(
            store.load(),
            Err(VoiceCoreSnapshotStoreError::SnapshotTooLarge)
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn refuses_to_replace_a_newer_snapshot_with_older_turn_history() {
        let root = test_root("stale");
        let store = VoiceCoreSnapshotStore::new(&root);
        let mut old = VoiceCore::new("ses_store_stale").unwrap();
        let old_snapshot = old.snapshot();
        old.begin_turn("turn_latest").unwrap();
        store.persist(&old.snapshot()).unwrap();

        assert!(matches!(
            store.persist(&old_snapshot),
            Err(VoiceCoreSnapshotStoreError::StaleSnapshot)
        ));
        let mut recovered = VoiceCore::recover(store.load().unwrap().unwrap()).unwrap();
        assert_eq!(
            recovered.begin_turn("turn_latest").unwrap_err(),
            VoiceCoreError::DuplicateTurn
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_a_snapshot_whose_payload_digest_changed() {
        let root = test_root("digest");
        let store = VoiceCoreSnapshotStore::new(&root);
        let core = VoiceCore::new("ses_store_digest").unwrap();
        store.persist(&core.snapshot()).unwrap();
        let path = store.slot_path(1);
        let mut record: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        record["snapshot"]["generation"] = serde_json::json!(9);
        fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();

        assert!(matches!(
            store.load(),
            Err(VoiceCoreSnapshotStoreError::InvalidSnapshot)
        ));
        let _ = fs::remove_dir_all(root);
    }
}
