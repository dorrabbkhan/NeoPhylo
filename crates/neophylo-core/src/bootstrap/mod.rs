//! Nonparametric bootstrap: column resampling, grouping tallies,
//! per-replicate detail, support on the original tree and consensus
//! trees (v1.2 spec §3.2-§3.6).
//!
//! The replicate RNG scheme is fixed by `resample_weights` and locked
//! by the `weights_golden` test: replicate `i` uses
//! `ChaCha8Rng::seed_from_u64(seed)` then `set_stream(i)`, so a
//! replicate never depends on batching, ordering or cancellation.
//!
//! `bootstrap::Split` is deliberately *not* re-exported at the crate
//! root: `compare::Split` already occupies that name (recorded in
//! docs/decisions.md).

pub mod consensus;
pub mod resample;
pub mod split;
pub mod support;
pub mod tally;

pub use consensus::{consensus, consensus_dropped, ConsensusKind, DroppedGroup};
pub use resample::{replicate_detail, resample_weights, ReplicateDetail};
pub use split::{tree_splits, Split};
pub use support::support_on_tree;
pub use tally::{bootstrap_batch, merge_tallies, BootstrapTally};
