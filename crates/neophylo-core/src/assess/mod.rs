//! Classroom assessment (v1.5 spec §5, plan Tasks 4–5): assignments,
//! seeded per-student variants, premise checks, and the gradable
//! tasks `task_key`/`check_task` score. `code` encodes/decodes the
//! completion code a student submits; `grade` turns it into a score.
//! The wasm bindings land in Task 6.

pub mod assignment;
pub mod code;
pub mod grade;
pub mod hash;
pub mod precision;
pub mod premise;
pub mod task;
pub mod variant;

pub use assignment::{Assignment, Content, GradedTask, IdPrompt, Mode, Variant};
pub use code::{
    decode_code, encode_code, fingerprint, max_code_len, name_table, pack_answer, unpack_answer,
    Attempt, CodePayload, PackedAnswer, FORMAT_VERSION, GENERATOR_VERSION, MAX_FINISHED_MIN,
    MAX_ID_BYTES, MAX_TASKS,
};
pub use grade::{grade, Flag, GradeResult, Rule, TaskResult};
pub use hash::{content_hash, fnv1a64, normalise_id, retry_seed, variant_seed, IdRule};
pub use precision::{decimals, scaled, scaled_quantity, PRECISION};
pub use premise::{premises_hold, Premise};
pub use task::{check_task, task_key, AcceptedAnswer, PairRole, Quantity, TaskAnswer, TaskRef};
pub use variant::{make_variant, MAX_RETRIES};
