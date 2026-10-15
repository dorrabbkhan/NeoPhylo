//! neophylo-core: distance-based phylogenetics engine.
//!
//! Pure Rust, deterministic, no wasm/UI dependencies. All failures are
//! reported as `NeoError`; the engine must never panic on any input.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod dist;
pub mod error;
pub mod matrix;
pub mod newick;
pub mod seq;
pub mod tree;

pub use dist::{compute, Cell, DistModel, DistanceMatrix};
pub use error::NeoError;
pub use matrix::Matrix;
pub use newick::{parse_newick, write_newick};
pub use seq::{parse_fasta, Alignment, MAX_SITES, MAX_TAXA};
pub use tree::{BranchAttrs, Node, NodeId, Tree};
