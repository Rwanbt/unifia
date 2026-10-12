use super::*;
use zip::write::SimpleFileOptions;

struct TestDir(PathBuf);

impl TestDir {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("unifia-artifacts-{}", Uuid::new_v4()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn spec() -> ArtifactSpec {
    ArtifactSpec {
        model_id: "parakeet-test".into(),
        version: "test-1".into(),
        source: "https://example.invalid/model.zip".into(),
        archive_sha256: "a".repeat(64),
        archive_size_bytes: 1,
        max_uncompressed_size_bytes: 1024,
        required_files: vec!["encoder.onnx".into(), "vocab.txt".into()],
        file_sha256: BTreeMap::from([
            (
                "encoder.onnx".into(),
                format!("{:x}", Sha256::digest(b"trusted")),
            ),
            (
                "vocab.txt".into(),
                format!("{:x}", Sha256::digest(b"tokens")),
            ),
        ]),
    }
}

fn write_archive(path: &Path, files: &[(&str, &[u8])]) {
    let file = File::create(path).unwrap();
    let mut archive = zip::ZipWriter::new(file);
    for (name, contents) in files {
        archive
            .start_file(*name, SimpleFileOptions::default())
            .unwrap();
        archive.write_all(contents).unwrap();
    }
    archive.finish().unwrap();
}

#[test]
fn installed_model_is_rejected_after_a_cached_file_changes() {
    let root = TestDir::new();
    let spec = spec();
    let model = root.0.join(&spec.model_id);
    fs::create_dir(&model).unwrap();
    fs::write(model.join("encoder.onnx"), b"trusted").unwrap();
    fs::write(model.join("vocab.txt"), b"tokens").unwrap();
    write_install_manifest(&spec, &model).unwrap();
    assert!(is_installed(&spec, &model));
    fs::write(model.join("encoder.onnx"), b"tampered").unwrap();
    assert!(!is_installed(&spec, &model));
}

#[test]
fn extracted_archive_is_promoted_only_when_pinned_file_hashes_match() {
    let root = TestDir::new();
    let mut spec = spec();
    let archive_path = root.0.join("model.zip");
    let staging_path = root.0.join("staging");
    let model_path = root.0.join(&spec.model_id);
    write_archive(
        &archive_path,
        &[
            ("parakeet-test/encoder.onnx", b"trusted"),
            ("parakeet-test/vocab.txt", b"tokens"),
        ],
    );
    let archive_bytes = fs::read(&archive_path).unwrap();
    spec.archive_size_bytes = archive_bytes.len() as u64;
    spec.archive_sha256 = format!("{:x}", Sha256::digest(&archive_bytes));

    extract_verified_archive(&spec, &archive_path, &staging_path).unwrap();
    let candidate = locate_model(&spec, &staging_path).unwrap();
    write_install_manifest(&spec, &candidate).unwrap();
    assert!(is_installed(&spec, &candidate));
    promote_model(&candidate, &model_path, &root.0.join("backup")).unwrap();
    assert!(is_installed(&spec, &model_path));
}

#[test]
fn extraction_rejects_path_traversal_before_writing_outside_staging() {
    let root = TestDir::new();
    let archive_path = root.0.join("unsafe.zip");
    let staging = root.0.join("staging");
    write_archive(&archive_path, &[("../escape.txt", b"unsafe")]);
    assert!(extract_verified_archive(&spec(), &archive_path, &staging).is_err());
    assert!(!root.0.join("escape.txt").exists());
}

#[test]
fn recovery_restores_only_a_previous_integrity_checked_install() {
    let root = TestDir::new();
    let spec = spec();
    let model = root.0.join(&spec.model_id);
    let backup = root.0.join(format!(".{}-old.previous", spec.model_id));
    fs::create_dir(&backup).unwrap();
    fs::write(backup.join("encoder.onnx"), b"trusted").unwrap();
    fs::write(backup.join("vocab.txt"), b"tokens").unwrap();
    write_install_manifest(&spec, &backup).unwrap();
    recover_previous(&spec, &model).unwrap();
    assert!(is_installed(&spec, &model));
}

#[test]
fn archive_summary_rejects_truncation_and_digest_mismatch() {
    let mut spec = spec();
    let bytes = b"pinned bytes";
    spec.archive_size_bytes = bytes.len() as u64;
    spec.archive_sha256 = format!("{:x}", Sha256::digest(bytes));
    assert!(verify_archive_summary(bytes.len() as u64, &spec.archive_sha256, &spec).is_ok());
    assert!(verify_archive_summary(bytes.len() as u64 - 1, &spec.archive_sha256, &spec).is_err());
    assert!(verify_archive_summary(bytes.len() as u64, &"b".repeat(64), &spec).is_err());
}

/// VO03: the download is the one place bytes actually arrive from somewhere
/// else, so this is the boundary a tampered artifact has to be refused at.
///
/// The attack this pins is the one a size check cannot see: the pinned size is
/// unchanged, only the contents differ. Flipping a single byte of a real zip
/// on disk and recomputing its digest proves the refusal comes from the hash,
/// not from the length.
#[test]
fn a_tampered_archive_is_refused_even_when_only_one_byte_differs() {
    let root = TestDir::new();
    let mut spec = spec();
    let archive_path = root.0.join("model.zip");
    write_archive(
        &archive_path,
        &[
            ("parakeet-test/encoder.onnx", b"trusted"),
            ("parakeet-test/vocab.txt", b"tokens"),
        ],
    );

    // Pin the registry entry to the honest artifact.
    let honest = fs::read(&archive_path).unwrap();
    spec.archive_size_bytes = honest.len() as u64;
    spec.archive_sha256 = format!("{:x}", Sha256::digest(&honest));
    assert!(
        verify_archive_summary(honest.len() as u64, &spec.archive_sha256, &spec).is_ok(),
        "the honest artifact must verify, or this test proves nothing"
    );

    // Flip one byte in place. The size is untouched; the digest is not.
    let mut tampered = honest.clone();
    let middle = tampered.len() / 2;
    tampered[middle] ^= 0x01;
    fs::write(&archive_path, &tampered).unwrap();

    let on_disk = fs::read(&archive_path).unwrap();
    let tampered_digest = format!("{:x}", Sha256::digest(&on_disk));
    assert_eq!(
        on_disk.len(),
        honest.len(),
        "the tamper must preserve the pinned size for this to be a real test"
    );
    assert_ne!(tampered_digest, spec.archive_sha256);
    assert!(
        verify_archive_summary(on_disk.len() as u64, &tampered_digest, &spec).is_err(),
        "a same-size artifact with the wrong SHA-256 must be refused"
    );
}

/// VO03: a refused download must not leave a usable-looking model behind.
/// This is the atomicity half: the destination only ever appears via
/// `promote_model`, and the temporary paths are cleared whatever the outcome.
#[test]
fn a_refused_install_leaves_no_partial_state_behind() {
    let root = TestDir::new();
    let spec = spec();
    let model = root.0.join(&spec.model_id);
    let archive_path = root.0.join(format!(".{}-abc.zip.part", spec.model_id));
    let staging_path = root.0.join(format!(".{}-abc.staging", spec.model_id));

    // A download that got as far as writing a temporary archive and a staging
    // area before its digest was rejected.
    fs::write(&archive_path, b"half a download").unwrap();
    fs::create_dir_all(staging_path.join("parakeet-test")).unwrap();
    fs::write(
        staging_path.join("parakeet-test/encoder.onnx"),
        b"trusted but never promoted",
    )
    .unwrap();

    // Nothing was ever promoted, so the destination does not exist and cannot
    // pass the integrity check.
    assert!(!is_installed(&spec, &model));

    cleanup_paths([archive_path.clone(), staging_path.clone()]);

    assert!(
        !archive_path.exists(),
        "the temporary archive must be removed"
    );
    assert!(!staging_path.exists(), "the staging area must be removed");
    assert!(
        !model.exists(),
        "a refused install must never create the destination model directory"
    );
}

/// VO03: rollback must not be a way to reintroduce a tampered model. The
/// manifest is written from whatever is on disk, so a backup whose *files*
/// were tampered after a legitimate install carries a self-consistent
/// manifest. Only the pinned digest can catch it, which is what this asserts.
#[test]
fn recovery_refuses_a_backup_whose_files_were_tampered_with() {
    let root = TestDir::new();
    let spec = spec();
    let model = root.0.join(&spec.model_id);
    // The name shape matters: `recover_previous` only considers siblings that
    // start with `.{model_id}-` AND end with `.previous`. A differently named
    // directory is silently not a backup, and this test would pass without
    // exercising recovery at all.
    let backup = root.0.join(format!(".{}-old.previous", spec.model_id));

    fs::create_dir_all(&backup).unwrap();
    fs::write(backup.join("encoder.onnx"), b"trusted").unwrap();
    fs::write(backup.join("vocab.txt"), b"tokens").unwrap();
    write_install_manifest(&spec, &backup).unwrap();

    // Tamper after the manifest was written. The backup is now internally
    // consistent and externally wrong.
    fs::write(backup.join("encoder.onnx"), b"tampered").unwrap();

    recover_previous(&spec, &model).unwrap();

    assert!(
        !model.exists(),
        "a tampered backup must not be promoted by recovery"
    );
    assert!(
        backup.exists(),
        "recovery must leave an integrity-failed backup in place rather than consume it"
    );
}
