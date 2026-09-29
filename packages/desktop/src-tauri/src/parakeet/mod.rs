#[cfg(feature = "onnx")]
mod download;
mod engine;

#[cfg(feature = "onnx")]
pub(crate) use download::{download_model, model_is_complete};
pub use engine::ParakeetEngine;
