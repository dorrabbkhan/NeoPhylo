//! neophylo-core: distance-based phylogenetics engine.
//!
//! Pure Rust, deterministic, no wasm/UI dependencies. All failures are
//! reported as `NeoError`; the engine must never panic on any input.

pub const VERSION: &str = env!("CARGO_PKG_VERSION");

pub mod algos;
pub mod alphabet;
pub mod bootstrap;
pub mod compare;
pub mod dist;
mod dist_phylip;
pub mod edit;
pub mod error;
pub mod exercise;
pub mod matrix;
pub mod meg;
pub mod model;
pub mod newick;
pub mod phylip;
pub mod protein_dist;
pub mod reroot;
pub mod seq;
pub mod sim;
pub mod site_filter;
pub mod tree;

pub use algos::{build_tree, BuildOptions, BuildResult, Method, NjFinal, NjStep, Trace, UpgmaStep};
// `bootstrap::Split` stays namespaced: `compare::Split` already owns the
// root-level name.
pub use alphabet::{detect_alphabet, protein_index, with_alphabet, Alphabet, PROTEIN_STATES};
pub use bootstrap::{
    bootstrap_batch, bootstrap_batch_filtered, consensus, consensus_dropped, merge_tallies,
    replicate_detail, replicate_detail_filtered, resample_weights, support_on_tree, tree_splits,
    BootstrapTally, ConsensusKind, DroppedGroup, ReplicateDetail,
};
pub use compare::{rf, RfResult, Split};
pub use dist::{compute, compute_filtered, Cell, DistModel, DistanceMatrix};
pub use error::NeoError;
pub use exercise::{
    load_exercise, Analysis, Exercise, ExerciseBootstrap, ExerciseData, Prompt, PromptType,
    Reference, ReferenceKind, Source,
};
pub use matrix::Matrix;
pub use meg::{parse_meg, write_meg, MegFile};
pub use model::{RateModel, JTT};
pub use newick::{
    compatible_names, labels_need_quotes, parse_newick, write_newick, write_newick_compatible,
    write_newick_with_support,
};
pub use phylip::{parse_phylip, write_phylip_matrix, NameMode};
pub use protein_dist::{jtt_ml, jtt_pair_detail, kimura_from_p, pair_counts, PairDetail};
pub use reroot::{reference_outgroup, reroot_on_outgroup, RerootResult};
pub use seq::{parse_fasta, Alignment, MAX_SITES, MAX_TAXA};
pub use sim::{simulate, SimModel, SimSpec};
pub use site_filter::{site_mask, SiteFilter, SiteMask};
pub use tree::{BranchAttrs, Node, NodeId, Tree};
