//! Tree-reading engine (v1.4d spec §5).
//!
//! `query` holds the pure `Tree` functions that answer every tree-reading
//! question — MRCA, clade tests, sister and outside groups, relatedness,
//! rooted topology comparison, restriction, ancestry and node ordering;
//! `traits` walks gain/loss `Mark`s into tip states. Nodes are named
//! across the wasm boundary by [`query::CladeKey`] — the sorted tip labels
//! below the node — so identifiers survive rotation, restyling and
//! variants. `set` is the reading-set file types, `question` the
//! question kinds, `resolve`/`load`/`validate`/`validate_statement`
//! resolve, load and validate a file; `answer` computes each item's
//! key and explanation (`response` the wire types, `differs`/
//! `trait_answer`/`statement` the per-kind answers, `check` the
//! response matcher), `variant` applies the seeded rotate / shuffle /
//! relabel transforms.

pub mod query;
pub mod traits;

mod answer;
mod check;
mod differs;
mod load;
mod question;
mod resolve;
mod response;
mod set;
mod statement;
mod trait_answer;
mod validate;
mod validate_statement;
mod variant;

pub use answer::answer;
pub use check::check;
pub use load::load_reading_set;
pub use query::{
    clade_key, closer, count_clades, find_clade, is_ancestor, is_clade, mrca, order_consistent,
    outside_tips, restrict, rooted_clades, same_relationships, sister_tips, CladeKey, Closer,
};
pub use question::{Question, RelForm, Statement, TraitAsk};
pub use response::{Accepted, AnswerKey, Response, Verdict};
pub use set::{
    Item, NodeAge, NodeLetter, Point, PointAt, ReadingMode, ReadingSet, ReadingTree, Shape, Style,
    Times, TipSide, TraitDef,
};
pub use traits::{change_count, origins_shared, tip_states, Change, Mark};
pub use variant::{relabel, relabel_map, rotate, shuffle_tip_order};
