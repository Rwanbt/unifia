// SPDX-License-Identifier: MIT

//! Parakeet TDT 0.6B v3 (INT8) on ONNX Runtime, shared by both runtimes.
//!
//! One copy on purpose: the desktop and mobile engines used to live in two
//! files that had already drifted (different `ort` versions, different
//! execution-provider API), so a fix had to be written twice and could differ
//! in behaviour between the two platforms.

pub mod onnx_runtime;

mod engine;

pub use engine::ParakeetEngine;

#[cfg(test)]
mod baseline_tests;
