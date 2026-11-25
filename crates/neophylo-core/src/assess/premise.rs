//! Content premises (v1.5 spec §5.2, plan Task 4): machine-checkable
//! conditions a variant must satisfy before it is served to a
//! student. Premises are computed by the engine from the variant's
//! own data — never hand-copied numbers — and a premise that cannot
//! apply to the content kind is `InvalidAssignment`, not `false`
//! (conductor's ruling for Task 4).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{build_tree, BuildOptions, Method};
use crate::assess::assignment::Content;
use crate::assess::variant::exercise_distance_matrix;
use crate::compare::rf;
use crate::error::NeoError;
use crate::exercise::ReferenceKind;
use crate::newick::parse_newick;
use crate::reading::load_reading_set;
use crate::worksheet::worksheet_facts;

/// A machine-checkable condition on a content variant. Serialized in
/// snake_case — the same spelling `exercises/*.json` and
/// `exercises/reading/*.json` declare in their `premises` array.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Premise {
    /// No ambiguous tie anywhere in the run: every join has
    /// `tied.len() == 1 || tie_same_split` — the same rule
    /// `tests/lesson_premises.rs::nj_by_hand_has_no_ambiguous_tie`
    /// asserts. A "no tie at all" premise is impossible: the
    /// four-active complement Q tie happens in every NJ run with at
    /// least five taxa (owner ruling on #147).
    TieFree,
    /// The first join's `chosen_is_closest == false`, under the
    /// exercise's own analysis method — the "the closest pair is not
    /// the answer" fact `nj-by-hand` teaches from.
    ClosestPairNotFirst,
    /// `rf(UPGMA tree, NJ tree) > 0` on the variant's matrix — the
    /// "UPGMA gets it wrong" fact `upgma-vs-nj-matrix` teaches from.
    UpgmaDiffersFromNj,
    /// `rf(reference tree, NJ tree) == 0`, requiring
    /// `reference.kind == "true"` — NJ recovers the generating tree.
    /// Without a true reference the premise cannot apply.
    NjRecoversTrueTree,
    /// The transformed reading set passes the same validation
    /// `load_reading_set` applies — evaluated by re-serialising the
    /// set and running the shared loader, not by duplicating rules.
    ReadingValid,
}

impl Premise {
    /// The snake_case wire name — the string `premises` arrays carry.
    pub fn name(self) -> &'static str {
        match self {
            Premise::TieFree => "tie_free",
            Premise::ClosestPairNotFirst => "closest_pair_not_first",
            Premise::UpgmaDiffersFromNj => "upgma_differs_from_nj",
            Premise::NjRecoversTrueTree => "nj_recovers_true_tree",
            Premise::ReadingValid => "reading_valid",
        }
    }
}

fn inapplicable(premise: &str, why: &str) -> NeoError {
    NeoError::InvalidAssignment {
        field: "premises".to_string(),
        msg: format!("{premise} does not apply here: {why}"),
    }
}

/// Whether `content` holds for `premise` — `InvalidAssignment` when
/// the premise cannot apply to the content kind.
fn premise_holds(content: &Content, premise: &Premise) -> Result<bool, NeoError> {
    match (content, premise) {
        (Content::Exercise(ex), p) => exercise_holds(ex, p),
        (Content::Reading(set), Premise::ReadingValid) => {
            // The shared validator IS the premise: re-serialise the
            // (possibly transformed) set and load it again.
            let json = serde_json::to_string(set).map_err(|e| NeoError::InvalidAssignment {
                field: "premises".to_string(),
                msg: e.to_string(),
            })?;
            Ok(load_reading_set(&json).is_ok())
        }
        (Content::Reading(_), p) => Err(inapplicable(
            p.name(),
            "a reading set has no distance pipeline",
        )),
    }
}

/// Every premise in `premises` holds for `content` — short-circuits
/// `Ok(false)` on the first failure.
pub fn premises_hold(content: &Content, premises: &[Premise]) -> Result<bool, NeoError> {
    for p in premises {
        if !premise_holds(content, p)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Exercise-kind premises — each computes from the variant's own
/// matrix and trace.
fn exercise_holds(ex: &crate::exercise::Exercise, p: &Premise) -> Result<bool, NeoError> {
    let matrix = || exercise_distance_matrix(ex);
    match p {
        Premise::TieFree => {
            let facts = worksheet_facts(&matrix()?, ex.analysis.method)?;
            Ok(facts.iter().all(|f| f.tied.len() == 1 || f.tie_same_split))
        }
        Premise::ClosestPairNotFirst => {
            let facts = worksheet_facts(&matrix()?, ex.analysis.method)?;
            Ok(facts.first().is_some_and(|f| !f.chosen_is_closest))
        }
        Premise::UpgmaDiffersFromNj => {
            let m = matrix()?;
            let opts = || BuildOptions { trace: false };
            let upgma = build_tree(&m, Method::Upgma, opts())?.tree;
            let nj = build_tree(&m, Method::Nj, opts())?.tree;
            Ok(rf(&upgma, &nj)?.rf > 0)
        }
        Premise::NjRecoversTrueTree => {
            let Some(reference) = &ex.reference else {
                return Err(inapplicable(
                    "nj_recovers_true_tree",
                    "the exercise has no true reference tree",
                ));
            };
            if reference.kind != ReferenceKind::True {
                return Err(inapplicable(
                    "nj_recovers_true_tree",
                    "the exercise has no true reference tree",
                ));
            }
            let truth = parse_newick(&reference.newick)
                .map_err(|e| inapplicable("nj_recovers_true_tree", &e.to_string()))?;
            let m = matrix()?;
            let nj = build_tree(&m, Method::Nj, BuildOptions { trace: false })?.tree;
            Ok(rf(&truth, &nj)?.rf == 0)
        }
        Premise::ReadingValid => Err(inapplicable(
            "reading_valid",
            "an exercise is not a reading set",
        )),
    }
}
