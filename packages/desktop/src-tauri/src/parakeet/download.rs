// SPDX-License-Identifier: MIT

use futures::StreamExt;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncWriteExt;

const MODEL_SOURCE: &str = "https://github.com/Kieirra/murmure-model/releases/download/1.0.0/parakeet-tdt-0.6b-v3-int8.zip";
const MODEL_VERSION: &str = "1.0.0";
const MODEL_ARCHIVE_SHA256: &str =
    "c5d0197e0b98552d8b88c569dbd9715199b68f6d0de17045b96e8541d4f75c03";
const MODEL_ARCHIVE_SIZE: u64 = 463_415_355;
const MODEL_FOLDER: &str = "parakeet-tdt-0.6b-v3-int8";
const MAX_UNCOMPRESSED_ARCHIVE_SIZE: u64 = 3 * 1024 * 1024 * 1024;
const REQUIRED_MODEL_FILES: [&str; 4] = [
    "nemo128.onnx",
    "encoder-model.int8.onnx",
    "decoder_joint-model.int8.onnx",
    "vocab.txt",
];

pub(crate) fn model_is_complete(model_dir: &Path) -> bool {
    REQUIRED_MODEL_FILES.iter().all(|name| {
        fs::symlink_metadata(model_dir.join(name))
            .is_ok_and(|metadata| metadata.file_type().is_file() && metadata.len() > 0)
    })
}

pub(crate) async fn download_model(app: &AppHandle, model_dir: &Path) -> Result<(), String> {
    tracing::info!("[STT] Downloading Parakeet model {MODEL_VERSION}...");
    let parent = model_dir
        .parent()
        .ok_or_else(|| "Parakeet model path has no parent directory".to_string())?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|error| format!("Create speech directory: {error}"))?;

    let identifier = uuid::Uuid::new_v4();
    let archive_path = parent.join(format!("parakeet-{identifier}.zip.part"));
    let staging_path = parent.join(format!("parakeet-{identifier}.staging"));
    let backup_path = parent.join(format!("parakeet-{identifier}.previous"));
    let result =
        download_verify_and_install(app, model_dir, &archive_path, &staging_path, &backup_path)
            .await;
    cleanup_temporary_paths([archive_path, staging_path]);
    result
}

async fn download_verify_and_install(
    app: &AppHandle,
    model_dir: &Path,
    archive_path: &Path,
    staging_path: &Path,
    backup_path: &Path,
) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(20 * 60))
        .build()
        .map_err(|error| format!("Build Parakeet download client: {error}"))?
        .get(MODEL_SOURCE)
        .send()
        .await
        .map_err(|error| format!("Download Parakeet model: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "Parakeet model download returned HTTP {}",
            response.status()
        ));
    }
    if response
        .content_length()
        .is_some_and(|size| size != MODEL_ARCHIVE_SIZE)
    {
        return Err("Parakeet model archive size does not match the pinned release".into());
    }

    let mut file = tokio::fs::File::create(archive_path)
        .await
        .map_err(|error| format!("Create temporary Parakeet archive: {error}"))?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Read Parakeet download: {error}"))?;
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "Parakeet archive size overflow".to_string())?;
        if downloaded > MODEL_ARCHIVE_SIZE {
            return Err("Parakeet model archive exceeds its pinned size".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|error| format!("Write temporary Parakeet archive: {error}"))?;
        if last_emit.elapsed().as_millis() > 300 {
            if let Err(error) = app.emit(
                "stt-download-progress",
                downloaded as f64 / MODEL_ARCHIVE_SIZE as f64,
            ) {
                tracing::warn!("Could not publish Parakeet download progress: {error}");
            }
            last_emit = std::time::Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|error| format!("Flush temporary Parakeet archive: {error}"))?;
    drop(file);

    if downloaded != MODEL_ARCHIVE_SIZE {
        return Err(format!(
            "Parakeet archive size mismatch: expected {MODEL_ARCHIVE_SIZE}, received {downloaded}"
        ));
    }
    verify_archive_sha256(&format!("{:x}", hasher.finalize()))?;

    tracing::info!("[STT] Extracting verified Parakeet model...");
    let archive = archive_path.to_path_buf();
    let staging = staging_path.to_path_buf();
    let model = model_dir.to_path_buf();
    let backup = backup_path.to_path_buf();
    tokio::task::spawn_blocking(move || {
        extract_archive_safely(&archive, &staging)?;
        let candidate = locate_complete_model(&staging)?;
        promote_model(&candidate, &model, &backup)
    })
    .await
    .map_err(|error| format!("Parakeet extraction task failed: {error}"))??;
    Ok(())
}

fn verify_archive_sha256(actual_sha256: &str) -> Result<(), String> {
    if actual_sha256 == MODEL_ARCHIVE_SHA256 {
        Ok(())
    } else {
        Err(format!(
            "Parakeet archive SHA-256 mismatch: expected {MODEL_ARCHIVE_SHA256}, received {actual_sha256}"
        ))
    }
}

fn extract_archive_safely(archive_path: &Path, staging_path: &Path) -> Result<(), String> {
    fs::create_dir(staging_path)
        .map_err(|error| format!("Create Parakeet staging directory: {error}"))?;
    let archive_file =
        fs::File::open(archive_path).map_err(|error| format!("Open Parakeet archive: {error}"))?;
    let mut archive = zip::ZipArchive::new(archive_file)
        .map_err(|error| format!("Read Parakeet archive: {error}"))?;
    let mut expanded_size = 0_u64;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("Read Parakeet archive entry: {error}"))?;
        expanded_size = expanded_size
            .checked_add(entry.size())
            .ok_or_else(|| "Parakeet expanded archive size overflow".to_string())?;
        if expanded_size > MAX_UNCOMPRESSED_ARCHIVE_SIZE {
            return Err("Parakeet expanded archive exceeds the safety limit".into());
        }
        let Some(relative_path) = entry.enclosed_name() else {
            return Err("Parakeet archive contains an unsafe path".into());
        };
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Parakeet archive contains a symbolic link".into());
        }
        let output_path = staging_path.join(relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&output_path)
                .map_err(|error| format!("Create extracted Parakeet directory: {error}"))?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("Create extracted Parakeet parent: {error}"))?;
        }
        let mut output = fs::File::create(&output_path)
            .map_err(|error| format!("Create extracted Parakeet file: {error}"))?;
        std::io::copy(&mut entry, &mut output)
            .map_err(|error| format!("Extract Parakeet file: {error}"))?;
        output
            .flush()
            .map_err(|error| format!("Flush extracted Parakeet file: {error}"))?;
    }
    Ok(())
}

fn locate_complete_model(staging_path: &Path) -> Result<PathBuf, String> {
    let candidates = [staging_path.join(MODEL_FOLDER), staging_path.to_path_buf()];
    candidates
        .into_iter()
        .find(|candidate| model_is_complete(candidate))
        .ok_or_else(|| "Verified Parakeet archive is missing required model files".into())
}

fn promote_model(candidate: &Path, model_dir: &Path, backup_path: &Path) -> Result<(), String> {
    let had_previous = model_dir.exists();
    if had_previous {
        fs::rename(model_dir, backup_path)
            .map_err(|error| format!("Preserve previous Parakeet model: {error}"))?;
    }
    if let Err(error) = fs::rename(candidate, model_dir) {
        if had_previous {
            fs::rename(backup_path, model_dir).map_err(|restore_error| {
                format!(
                    "Install Parakeet model failed ({error}); restoring previous model failed ({restore_error})"
                )
            })?;
        }
        return Err(format!("Promote verified Parakeet model: {error}"));
    }
    if had_previous && let Err(error) = fs::remove_dir_all(backup_path) {
        tracing::warn!("Could not remove previous Parakeet model backup: {error}");
    }
    Ok(())
}

fn cleanup_temporary_paths(paths: [PathBuf; 2]) {
    for path in paths {
        if path.is_dir() {
            if let Err(error) = fs::remove_dir_all(&path) {
                tracing::warn!(
                    "Could not remove temporary Parakeet path {}: {error}",
                    path.display()
                );
            }
        } else if path.exists()
            && let Err(error) = fs::remove_file(&path)
        {
            tracing::warn!(
                "Could not remove temporary Parakeet path {}: {error}",
                path.display()
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zip::write::SimpleFileOptions;

    fn temporary_directory() -> PathBuf {
        std::env::temp_dir().join(format!("unifia-parakeet-test-{}", uuid::Uuid::new_v4()))
    }

    fn write_test_archive(path: &Path, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("create test archive");
        let mut archive = zip::ZipWriter::new(file);
        for (name, contents) in entries {
            archive
                .start_file(*name, SimpleFileOptions::default())
                .expect("start archive entry");
            archive.write_all(contents).expect("write archive entry");
        }
        archive.finish().expect("finish test archive");
    }

    #[test]
    fn corrupted_archive_digest_is_rejected() {
        let corrupted = format!("{:x}", Sha256::digest(b"corrupted archive"));
        assert!(verify_archive_sha256(&corrupted).is_err());
    }

    #[test]
    fn archive_path_traversal_is_rejected() {
        let root = temporary_directory();
        let archive_path = root.join("unsafe.zip");
        let staging_path = root.join("staging");
        fs::create_dir_all(&root).expect("create test root");
        write_test_archive(&archive_path, &[("../outside.txt", b"unsafe")]);

        let result = extract_archive_safely(&archive_path, &staging_path);
        assert!(result.is_err());
        assert!(!root.join("outside.txt").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn valid_archive_promotes_only_a_complete_model() {
        let root = temporary_directory();
        let archive_path = root.join("model.zip");
        let staging_path = root.join("staging");
        let model_dir = root.join(MODEL_FOLDER);
        let backup_path = root.join("previous");
        fs::create_dir_all(&root).expect("create test root");
        let entries: Vec<_> = REQUIRED_MODEL_FILES
            .iter()
            .map(|name| (format!("{MODEL_FOLDER}/{name}"), b"model".as_slice()))
            .collect();
        let borrowed_entries: Vec<_> = entries
            .iter()
            .map(|(name, contents)| (name.as_str(), *contents))
            .collect();
        write_test_archive(&archive_path, &borrowed_entries);

        extract_archive_safely(&archive_path, &staging_path).expect("extract valid archive");
        let candidate = locate_complete_model(&staging_path).expect("find complete model");
        promote_model(&candidate, &model_dir, &backup_path).expect("promote complete model");
        assert!(model_is_complete(&model_dir));

        let _ = fs::remove_dir_all(root);
    }
}
