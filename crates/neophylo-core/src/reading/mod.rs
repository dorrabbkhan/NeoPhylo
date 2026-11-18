//! Tree-reading engine (v1.4d spec §5).
//!
//! `query` holds the pure `Tree` functions that answer every tree-reading
//! question — MRCA, clade tests, sister and outside groups, relatedness,
//! rooted topology comparison, restriction, ancestry and node ordering;
//! `traits` walks gain/loss `Mark`s into tip states. Nodes are named
//! across the wasm boundary by [`query::CladeKey`] — the sorted tip labels
//! below the node — so identifiers survive rotation, restyling and
//! variants. The reading-set file format, item validation, answers and
//! variant transforms arrive with plan Task 4.

pub mod query;
pub mod traits;

pub use query::{
    clade_key, closer, count_clades, find_clade, is_ancestor, is_clade, mrca, order_consistent,
    outside_tips, restrict, rooted_clades, same_relationships, sister_tips, CladeKey, Closer,
};
pub use traits::{change_count, origins_shared, tip_states, Change, Mark};
