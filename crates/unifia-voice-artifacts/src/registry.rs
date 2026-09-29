// SPDX-License-Identifier: MIT
use serde::Deserialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct ArtifactSpec {
    pub model_id: String,
    pub version: String,
    pub source: String,
    pub archive_sha256: String,
    pub archive_size_bytes: u64,
    pub max_uncompressed_size_bytes: u64,
    pub required_files: Vec<String>,
    pub file_sha256: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct Registry {
    models: Vec<Model>,
}

#[derive(Deserialize)]
struct Model {
    model_id: String,
    version: String,
    source: String,
    sha256: String,
    size_bytes: u64,
    compatibility: Compatibility,
}

#[derive(Deserialize)]
struct Compatibility {
    archive_sha256: Option<String>,
    archive_size_bytes: Option<u64>,
    max_uncompressed_size_bytes: Option<u64>,
    required_files: Option<Vec<String>>,
    file_sha256: Option<BTreeMap<String, String>>,
}

impl ArtifactSpec {
    pub fn from_registry(registry_json: &str, model_id: &str) -> Result<Self, String> {
        let registry: Registry =
            serde_json::from_str(registry_json).map_err(|_| "Invalid Voice model registry")?;
        let model = registry
            .models
            .into_iter()
            .find(|model| model.model_id == model_id)
            .ok_or("Voice model is missing from the registry")?;
        let compatibility = model.compatibility;
        let archive_sha256 = compatibility
            .archive_sha256
            .ok_or("Voice model registry entry lacks an archive digest")?;
        let archive_size_bytes = compatibility
            .archive_size_bytes
            .ok_or("Voice model registry entry lacks an archive size")?;
        let max_uncompressed_size_bytes = compatibility
            .max_uncompressed_size_bytes
            .ok_or("Voice model registry entry lacks an extraction limit")?;
        let required_files = compatibility
            .required_files
            .ok_or("Voice model registry entry lacks required files")?;
        let file_sha256 = compatibility
            .file_sha256
            .ok_or("Voice model registry entry lacks pinned file digests")?;
        if model.version.trim().is_empty()
            || !model.source.starts_with("https://")
            || !valid_sha256(&archive_sha256)
            || model.sha256 != archive_sha256
            || model.size_bytes != archive_size_bytes
            || archive_size_bytes == 0
            || max_uncompressed_size_bytes == 0
            || required_files.is_empty()
            || required_files.iter().any(|name| !valid_required_name(name))
            || required_files.iter().any(|name| {
                file_sha256
                    .get(name)
                    .is_none_or(|digest| !valid_sha256(digest))
            })
            || file_sha256
                .keys()
                .any(|name| !required_files.contains(name))
        {
            return Err("Voice model registry entry is incomplete or unsafe".into());
        }
        Ok(Self {
            model_id: model.model_id,
            version: model.version,
            source: model.source,
            archive_sha256,
            archive_size_bytes,
            max_uncompressed_size_bytes,
            required_files,
            file_sha256,
        })
    }
}

pub fn bundled_parakeet_spec() -> Result<ArtifactSpec, String> {
    ArtifactSpec::from_registry(
        include_str!("../../../packages/voice-host/models/registry.json"),
        "parakeet-tdt-0.6b-v3-int8",
    )
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_required_name(value: &str) -> bool {
    !value.is_empty()
        && value != "."
        && value != ".."
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_parakeet_pin_from_the_shared_registry() {
        let spec = bundled_parakeet_spec().unwrap();
        assert_eq!(spec.model_id, "parakeet-tdt-0.6b-v3-int8");
        assert_eq!(spec.archive_size_bytes, 463_415_355);
        assert_eq!(
            spec.archive_sha256,
            "c5d0197e0b98552d8b88c569dbd9715199b68f6d0de17045b96e8541d4f75c03"
        );
        assert_eq!(spec.required_files.len(), 4);
    }

    #[test]
    fn rejects_unpinned_or_unsafe_entries() {
        let invalid = r#"{"models":[{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"bad","size_bytes":1,"compatibility":{"archive_sha256":"bad","archive_size_bytes":1,"max_uncompressed_size_bytes":10,"required_files":["../escape"],"file_sha256":{"../escape":"bad"}}}]}"#;
        assert!(ArtifactSpec::from_registry(invalid, "x").is_err());
        assert!(ArtifactSpec::from_registry("{}", "missing").is_err());
    }
}
