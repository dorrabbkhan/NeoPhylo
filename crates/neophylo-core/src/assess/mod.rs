//! Classroom assessment (v1.5 spec §5, plan Task 4): assignments,
//! seeded per-student variants, premise checks, and the gradable
//! tasks `task_key`/`check_task` score. Completion-code encoding and
//! CSV grading land in Task 5 (`assess/code.rs`, `assess/grade.rs`);
//! the wasm bindings in Task 6.

pub mod assignment;
pub mod hash;
pub mod precision;
pub mod premise;
pub mod task;
pub mod variant;

pub use assignment::{Assignment, Content, GradedTask, IdPrompt, Mode, Variant};
pub use hash::{fnv1a64, normalise_id, retry_seed, variant_seed, IdRule};
pub use precision::{decimals, scaled, scaled_quantity, PRECISION};
pub use premise::{premises_hold, Premise};
pub use task::{check_task, task_key, AcceptedAnswer, PairRole, Quantity, TaskAnswer, TaskRef};
pub use variant::{make_variant, MAX_RETRIES};
