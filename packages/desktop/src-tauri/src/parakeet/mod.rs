#[cfg(feature = "onnx")]
mod download;

#[cfg(feature = "onnx")]
pub(crate) use download::{download_model, model_is_complete};
#[cfg(feature = "onnx")]
pub use unifia_parakeet::ParakeetEngine;
