// SPDX-License-Identifier: MIT
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
use zip::ZipArchive;

use crate::ArtifactSpec;

const MANIFEST_FILE: &str = ".unifia-artifact.json";
const MAX_ARCHIVE_ENTRIES: usize = 10_000;
const MAX_MANIFEST_SIZE_BYTES: u64 = 1024 * 1024;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledManifest {
    model_id: String,
    version: String,
    archive_sha256: String,
    files: BTreeMap<String, String>,
}

pub fn is_installed(spec: &ArtifactSpec, model_dir: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(model_dir) else {
        return false;
    };
    if !metadata.file_type().is_dir() {
        return false;
    }
    let Ok(manifest_metadata) = fs::symlink_metadata(model_dir.join(MANIFEST_FILE)) else {
        return false;
    };
    if !manifest_metadata.file_type().is_file() {
        return false;
    }
    if manifest_metadata.len() > MAX_MANIFEST_SIZE_BYTES {
        return false;
    }
    let Ok(bytes) = fs::read(model_dir.join(MANIFEST_FILE)) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_slice::<InstalledManifest>(&bytes) else {
        return false;
    };
    manifest.model_id == spec.model_id
        && manifest.version == spec.version
        && manifest.archive_sha256 == spec.archive_sha256
        && spec.required_files.iter().all(|name| {
            fs::symlink_metadata(model_dir.join(name)).is_ok_and(|entry| {
                entry.file_type().is_file()
                    && spec.file_sha256.get(name).is_some_and(|expected| {
                        manifest.files.get(name) == Some(expected)
                            && sha256_file(&model_dir.join(name))
                                .is_ok_and(|actual| &actual == expected)
                    })
            })
        })
}

pub async fn install(
    spec: &ArtifactSpec,
    model_dir: &Path,
    mut progress: impl FnMut(f64) + Send,
) -> Result<(), String> {
    recover_previous(spec, model_dir)?;
    if is_installed(spec, model_dir) {
        return Ok(());
    }
    let parent = model_dir
        .parent()
        .ok_or("Voice model destination has no parent")?;
    tokio::fs::create_dir_all(parent)
        .await
        .map_err(|_| "Could not create Voice model directory")?;
    let id = Uuid::new_v4();
    let archive_path = parent.join(format!(".{}-{id}.zip.part", spec.model_id));
    let staging_path = parent.join(format!(".{}-{id}.staging", spec.model_id));
    let backup_path = parent.join(format!(".{}-{id}.previous", spec.model_id));
    let result = download_extract_promote(
        spec,
        model_dir,
        &archive_path,
        &staging_path,
        &backup_path,
        &mut progress,
    )
    .await;
    cleanup_paths([archive_path, staging_path]);
    result
}

async fn download_extract_promote(
    spec: &ArtifactSpec,
    model_dir: &Path,
    archive_path: &Path,
    staging_path: &Path,
    backup_path: &Path,
    progress: &mut impl FnMut(f64),
) -> Result<(), String> {
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(20 * 60))
        .build()
        .map_err(|_| "Could not create Voice artifact HTTP client")?
        .get(&spec.source)
        .send()
        .await
        .map_err(|_| "Voice artifact download failed")?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|size| size != spec.archive_size_bytes)
    {
        return Err("Voice artifact response does not match the pinned registry entry".into());
    }

    let mut file = tokio::fs::File::create(archive_path)
        .await
        .map_err(|_| "Could not create temporary Voice artifact")?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut last_progress = std::time::Instant::now();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "Voice artifact download stream failed")?;
        downloaded = downloaded
            .checked_add(chunk.len() as u64)
            .ok_or("Voice artifact size overflow")?;
        if downloaded > spec.archive_size_bytes {
            return Err("Voice artifact exceeds its pinned size".into());
        }
        hasher.update(&chunk);
        file.write_all(&chunk)
            .await
            .map_err(|_| "Could not write temporary Voice artifact")?;
        if last_progress.elapsed().as_millis() >= 300 {
            progress(downloaded as f64 / spec.archive_size_bytes as f64);
            last_progress = std::time::Instant::now();
        }
    }
    file.flush()
        .await
        .map_err(|_| "Could not flush temporary Voice artifact")?;
    file.sync_all()
        .await
        .map_err(|_| "Could not sync temporary Voice artifact")?;
    drop(file);
    verify_archive_summary(downloaded, &format!("{:x}", hasher.finalize()), spec)?;

    let archive_path = archive_path.to_path_buf();
    let staging_path = staging_path.to_path_buf();
    let model_dir = model_dir.to_path_buf();
    let backup_path = backup_path.to_path_buf();
    let spec = spec.clone();
    tokio::task::spawn_blocking(move || {
        extract_verified_archive(&spec, &archive_path, &staging_path)?;
        let candidate = locate_model(&spec, &staging_path)?;
        write_install_manifest(&spec, &candidate)?;
        if !is_installed(&spec, &candidate) {
            return Err("Extracted Voice model did not pass integrity verification".into());
        }
        promote_model(&candidate, &model_dir, &backup_path)?;
        if is_installed(&spec, &model_dir) {
            Ok(())
        } else {
            Err("Installed Voice model did not pass integrity verification".into())
        }
    })
    .await
    .map_err(|_| "Voice artifact installation task failed")?
}

fn verify_archive_summary(
    size_bytes: u64,
    sha256: &str,
    spec: &ArtifactSpec,
) -> Result<(), String> {
    if size_bytes == spec.archive_size_bytes && sha256 == spec.archive_sha256 {
        Ok(())
    } else {
        Err("Voice artifact size or SHA-256 does not match the registry".into())
    }
}

fn extract_verified_archive(
    spec: &ArtifactSpec,
    archive_path: &Path,
    staging_path: &Path,
) -> Result<(), String> {
    fs::create_dir(staging_path).map_err(|_| "Could not create Voice model staging area")?;
    let archive_file =
        File::open(archive_path).map_err(|_| "Could not open verified Voice archive")?;
    let mut archive =
        ZipArchive::new(archive_file).map_err(|_| "Verified Voice archive is invalid")?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err("Voice archive contains too many entries".into());
    }
    let mut expanded_size = 0_u64;
    let mut seen = HashSet::new();
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| "Could not read Voice archive entry")?;
        let name = entry
            .enclosed_name()
            .ok_or("Voice archive contains an unsafe path")?;
        if name.file_name().is_some_and(|part| part == MANIFEST_FILE) {
            return Err("Voice archive uses the reserved integrity manifest path".into());
        }
        if !seen.insert(name.clone()) {
            return Err("Voice archive contains duplicate paths".into());
        }
        let mode = entry.unix_mode().unwrap_or(0);
        let kind = mode & 0o170000;
        if kind == 0o120000 || !matches!(kind, 0 | 0o100000 | 0o040000) {
            return Err("Voice archive contains a non-regular filesystem entry".into());
        }
        expanded_size = expanded_size
            .checked_add(entry.size())
            .ok_or("Voice archive expanded size overflow")?;
        if expanded_size > spec.max_uncompressed_size_bytes {
            return Err("Voice archive exceeds its uncompressed size limit".into());
        }
        let output_path = staging_path.join(name);
        if entry.is_dir() {
            fs::create_dir_all(output_path)
                .map_err(|_| "Could not create Voice model directory")?;
            continue;
        }
        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent).map_err(|_| "Could not create Voice model directory")?;
        }
        let mut output =
            File::create(&output_path).map_err(|_| "Could not create Voice model file")?;
        let entry_size = entry.size();
        let copied = {
            let mut limited = (&mut entry).take(entry_size.saturating_add(1));
            std::io::copy(&mut limited, &mut output)
                .map_err(|_| "Could not extract Voice model file")?
        };
        if copied != entry_size {
            return Err("Voice archive entry size does not match its contents".into());
        }
        output
            .flush()
            .map_err(|_| "Could not flush Voice model file")?;
    }
    Ok(())
}

fn locate_model(spec: &ArtifactSpec, staging_path: &Path) -> Result<PathBuf, String> {
    [
        staging_path.join(&spec.model_id),
        staging_path.to_path_buf(),
    ]
    .into_iter()
    .find(|path| {
        spec.required_files.iter().all(|name| {
            fs::symlink_metadata(path.join(name))
                .is_ok_and(|metadata| metadata.file_type().is_file() && metadata.len() > 0)
        })
    })
    .ok_or_else(|| "Verified Voice archive lacks required model files".into())
}

fn write_install_manifest(spec: &ArtifactSpec, model_dir: &Path) -> Result<(), String> {
    let files = spec
        .required_files
        .iter()
        .map(|name| Ok((name.clone(), sha256_file(&model_dir.join(name))?)))
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let manifest = InstalledManifest {
        model_id: spec.model_id.clone(),
        version: spec.version.clone(),
        archive_sha256: spec.archive_sha256.clone(),
        files,
    };
    let path = model_dir.join(MANIFEST_FILE);
    let mut file = File::create(path).map_err(|_| "Could not create Voice integrity manifest")?;
    serde_json::to_writer(&mut file, &manifest)
        .map_err(|_| "Could not encode Voice integrity manifest")?;
    file.flush()
        .map_err(|_| "Could not flush Voice integrity manifest")?;
    file.sync_all()
        .map_err(|_| "Could not sync Voice integrity manifest")?;
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "Could not read installed Voice model file")?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "Could not hash installed Voice model file")?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn promote_model(candidate: &Path, model_dir: &Path, backup_path: &Path) -> Result<(), String> {
    let had_previous = model_dir.exists();
    if had_previous {
        fs::rename(model_dir, backup_path)
            .map_err(|_| "Could not preserve previous Voice model")?;
    }
    if let Err(error) = fs::rename(candidate, model_dir) {
        if had_previous {
            fs::rename(backup_path, model_dir)
                .map_err(|_| "Voice model promotion failed and previous model restore failed")?;
        }
        return Err(format!("Could not promote verified Voice model: {error}"));
    }
    if had_previous {
        let _ = fs::remove_dir_all(backup_path);
    }
    Ok(())
}

fn recover_previous(spec: &ArtifactSpec, model_dir: &Path) -> Result<(), String> {
    if model_dir.exists() {
        return Ok(());
    }
    let parent = model_dir
        .parent()
        .ok_or("Voice model destination has no parent")?;
    if !parent.exists() {
        return Ok(());
    }
    let prefix = format!(".{}-", spec.model_id);
    let mut backups = fs::read_dir(parent)
        .map_err(|_| "Could not inspect previous Voice model installations")?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(&prefix) && name.ends_with(".previous"))
        })
        .collect::<Vec<_>>();
    backups.sort();
    for backup in backups.into_iter().rev() {
        if is_installed(spec, &backup) {
            fs::rename(backup, model_dir)
                .map_err(|_| "Could not restore previous verified Voice model")?;
            return Ok(());
        }
    }
    Ok(())
}

fn cleanup_paths(paths: [PathBuf; 2]) {
    for path in paths {
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
}

#[cfg(test)]
#[path = "extract_tests.rs"]
mod tests;
