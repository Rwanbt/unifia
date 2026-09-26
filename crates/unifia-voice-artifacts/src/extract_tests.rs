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
