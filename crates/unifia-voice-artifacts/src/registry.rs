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

pub fn bundled_pocket_spec(language: &str) -> Result<ArtifactSpec, String> {
    let model_id = match language {
        "fr" => "pocket-tts-fr-24l-int8",
        _ => {
            return Err(format!(
                "No Pocket voice pack is published for '{language}'"
            ))
        }
    };
    ArtifactSpec::from_registry(
        include_str!("../../../packages/voice-host/models/registry.json"),
        model_id,
    )
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A relative `/`-separated path: a pack keeps its voice prompts under
/// `voices/`. Every segment must be a plain name, so nothing escapes the
/// install directory.
fn valid_required_name(value: &str) -> bool {
    value.split('/').all(|segment| {
        !segment.is_empty()
            && segment != "."
            && segment != ".."
            && segment
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
    })
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
    fn reads_the_french_pocket_pack_with_its_voice_prompt() {
        let spec = bundled_pocket_spec("fr").unwrap();
        assert_eq!(spec.model_id, "pocket-tts-fr-24l-int8");
        assert_eq!(spec.archive_size_bytes, 258_357_927);
        assert_eq!(spec.required_files.len(), 8);
        assert!(spec
            .required_files
            .iter()
            .any(|name| name == "voices/voice.wav"));
        assert!(bundled_pocket_spec("xx").is_err());
    }

    #[test]
    fn accepts_nested_names_but_never_an_escaping_segment() {
        assert!(valid_required_name("voices/voice.wav"));
        for name in ["voices/../x", "/abs", "voices//x", "voices/", "./x", ".."] {
            assert!(!valid_required_name(name), "accepted {name}");
        }
    }

    #[test]
    fn rejects_unpinned_or_unsafe_entries() {
        let invalid = r#"{"models":[{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"bad","size_bytes":1,"compatibility":{"archive_sha256":"bad","archive_size_bytes":1,"max_uncompressed_size_bytes":10,"required_files":["../escape"],"file_sha256":{"../escape":"bad"}}}]}"#;
        assert!(ArtifactSpec::from_registry(invalid, "x").is_err());
        assert!(ArtifactSpec::from_registry("{}", "missing").is_err());
    }

    /// VO03 "immutable revision": the two digests in one registry entry are
    /// two statements about the same bytes. If they disagree, one of them was
    /// edited after the other was pinned, and accepting the entry would let a
    /// tampered pin through behind a legitimate-looking one.
    #[test]
    fn rejects_an_entry_whose_two_digests_disagree() {
        let pinned = "a".repeat(64);
        let other = "b".repeat(64);
        let entry = format!(
            r#"{{"models":[{{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"{pinned}","size_bytes":10,"compatibility":{{"archive_sha256":"{other}","archive_size_bytes":10,"max_uncompressed_size_bytes":100,"required_files":["m.onnx"],"file_sha256":{{"m.onnx":"{pinned}"}}}}}}]}}"#
        );
        assert!(ArtifactSpec::from_registry(&entry, "x").is_err());

        // The same entry with the digests reconciled is accepted, so the
        // assertion above is about the disagreement and nothing else.
        let agreed = format!(
            r#"{{"models":[{{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"{pinned}","size_bytes":10,"compatibility":{{"archive_sha256":"{pinned}","archive_size_bytes":10,"max_uncompressed_size_bytes":100,"required_files":["m.onnx"],"file_sha256":{{"m.onnx":"{pinned}"}}}}}}]}}"#
        );
        assert!(ArtifactSpec::from_registry(&agreed, "x").is_ok());
    }

    /// The size is pinned twice for the same reason as the digest.
    #[test]
    fn rejects_an_entry_whose_two_sizes_disagree() {
        let pinned = "a".repeat(64);
        let entry = format!(
            r#"{{"models":[{{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"{pinned}","size_bytes":10,"compatibility":{{"archive_sha256":"{pinned}","archive_size_bytes":11,"max_uncompressed_size_bytes":100,"required_files":["m.onnx"],"file_sha256":{{"m.onnx":"{pinned}"}}}}}}]}}"#
        );
        assert!(ArtifactSpec::from_registry(&entry, "x").is_err());
    }

    /// A pin that is not a 64-character lowercase hex digest is not a pin.
    #[test]
    fn rejects_a_digest_that_is_not_lowercase_hex() {
        for digest in [
            "A".repeat(64),
            format!("{}z", "a".repeat(63)),
            String::new(),
        ] {
            let entry = format!(
                r#"{{"models":[{{"model_id":"x","version":"1","source":"https://example.test/x","sha256":"{digest}","size_bytes":10,"compatibility":{{"archive_sha256":"{digest}","archive_size_bytes":10,"max_uncompressed_size_bytes":100,"required_files":["m.onnx"],"file_sha256":{{"m.onnx":"{digest}"}}}}}}]}}"#
            );
            assert!(
                ArtifactSpec::from_registry(&entry, "x").is_err(),
                "accepted a malformed digest: {digest}"
            );
        }
    }
}
