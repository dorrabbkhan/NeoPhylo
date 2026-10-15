//! neophylo-core: distance-based phylogenetics engine.
//!
//! Pure Rust, deterministic, no wasm/UI dependencies. All failures are
//! reported as `NeoError`; the engine must never panic on any input.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod error;
pub mod matrix;
pub mod seq;

pub use error::NeoError;
pub use matrix::Matrix;
pub use seq::{parse_fasta, Alignment, MAX_SITES, MAX_TAXA};
