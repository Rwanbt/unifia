// SPDX-License-Identifier: MIT
//! Refuses to create an ONNX Runtime session when the linked runtime cannot
//! serve the C API level `ort` was compiled against.
//!
//! WHY: `ort` resolves its API table lazily while holding its global
//! environment mutex and panics when `GetApi` returns null. The panic poisons
//! that mutex, so every later session in the process — Silero, Smart Turn,
//! Parakeet — fails with an opaque "Mutex poisoned" until the app restarts.
//! Asking the runtime first turns that into one classified, recoverable error.

use std::ffi::CStr;
use std::sync::OnceLock;

/// Stable prefix mapped to the `abi` stage by the Voice error taxonomy.
pub const ABI_UNSUPPORTED: &str = "ABI_UNSUPPORTED";

static RUNTIME_CHECK: OnceLock<Result<String, String>> = OnceLock::new();

/// Must be called before any `Session::builder()`.
pub fn ensure_compatible_runtime() -> Result<(), String> {
    RUNTIME_CHECK
        .get_or_init(|| probe_runtime(ort::sys::ORT_API_VERSION))
        .clone()
        .map(|_| ())
}

/// Returns the runtime version when it serves `required_api`.
fn probe_runtime(required_api: u32) -> Result<String, String> {
    // SAFETY: `OrtGetApiBase` is the runtime's argument-less C entry point and
    // returns a pointer to a static table owned by the library.
    let base = unsafe { ort::sys::OrtGetApiBase() };
    if base.is_null() {
        return Err(format!(
            "{ABI_UNSUPPORTED}: ONNX Runtime returned no API base"
        ));
    }
    // SAFETY: `base` is non-null and points to the library's static table.
    let (get_api, get_version) = unsafe { ((*base).GetApi, (*base).GetVersionString) };
    // SAFETY: both are plain C functions of the loaded runtime; the version
    // string is a static, null-terminated buffer that must not be freed.
    let version = unsafe {
        let raw = get_version();
        if raw.is_null() {
            "an unreported version".to_owned()
        } else {
            CStr::from_ptr(raw).to_string_lossy().into_owned()
        }
    };
    // SAFETY: `GetApi` only reads its integer argument and returns null for
    // an API level the runtime is too old to provide.
    if unsafe { get_api(required_api) }.is_null() {
        return Err(format!(
            "{ABI_UNSUPPORTED}: ONNX Runtime {version} cannot serve C API level {required_api}; \
             bundle a runtime at least that new or lower the `ort` api-* feature"
        ));
    }
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linked_runtime_serves_the_compiled_api_level() {
        let version =
            probe_runtime(ort::sys::ORT_API_VERSION).expect("compiled API level must be served");
        assert!(!version.is_empty());
    }

    #[test]
    fn a_future_api_level_is_refused_without_panicking() {
        let error = probe_runtime(u32::MAX).expect_err("no runtime serves API level u32::MAX");
        assert!(error.starts_with(ABI_UNSUPPORTED), "{error}");
        // The guard must leave ort usable: a refused probe never touches its mutex.
        assert!(probe_runtime(ort::sys::ORT_API_VERSION).is_ok());
    }
}
