// SPDX-License-Identifier: MIT
mod extract;
mod registry;

pub use extract::{install, is_installed};
pub use registry::{bundled_parakeet_spec, ArtifactSpec};
