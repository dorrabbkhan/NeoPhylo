//! Tree-reading engine (v1.4d spec §5).
//!
//! `query` holds the pure `Tree` functions that answer every tree-reading
//! question — MRCA, clade tests, sister and outside groups, relatedness,
//! rooted topology comparison, restriction, ancestry and node ordering;
//! `traits` walks gain/loss `Mark`s into tip states. Nodes are named
//! across the wasm boundary by [`query::CladeKey`] — the sorted tip labels
//! below the node — so identifiers survive rotation, restyling and
//! variants. `set` is the reading-set file format and its validation,
//! `answer` computes each item's key and explanation and checks
//! responses, `variant` applies the seeded rotate / shuffle / relabel
//! transforms.

pub mod query;
pub mod traits;

mod answer;
mod set;
mod variant;

pub use answer::{answer, check, Accepted, AnswerKey, Response, Verdict};
pub use query::{
    clade_key, closer, count_clades, find_clade, is_ancestor, is_clade, mrca, order_consistent,
    outside_tips, restrict, rooted_clades, same_relationships, sister_tips, CladeKey, Closer,
};
pub use set::{
    load_reading_set, Item, NodeAge, NodeLetter, Point, PointAt, Question, ReadingMode, ReadingSet,
    ReadingTree, RelForm, Shape, Statement, Style, Times, TipSide, TraitAsk, TraitDef,
};
pub use traits::{change_count, origins_shared, tip_states, Change, Mark};
pub use variant::{relabel, relabel_map, rotate, shuffle_tip_order};
