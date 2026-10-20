//! Bootstrap tallies (v1.2 spec §3.3): per-replicate groupings counted
//! over successful replicates, mergeable so a worker can run in batches
//! and a cancelled run can be resumed exactly.
//!
//! A replicate is *skipped* (counted in `failed`, contributes no
//! groupings) when its weighted distance matrix has any `Saturated`
//! cell or when a pair has no comparable sites. Every other engine
//! error propagates. If every requested replicate is skipped the batch
//! returns `NeoError::BootstrapFailed`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{build_tree, BuildOptions, Method};
use crate::bootstrap::resample::resample_weights;
use crate::bootstrap::split::{tree_splits, Split};
use crate::dist::{compute_weighted, DistModel};
use crate::error::NeoError;
use crate::seq::Alignment;

/// The running result of a bootstrap run (spec §3.3). Carries `labels`
/// (n = `labels.len()`) rather than the spec's bare `n`, so support and
/// consensus can name groupings; recorded in docs/decisions.md.
///
/// Serialized `counts` is a list of `{ labels, count }` — a `Split`
/// serializes as a sorted label list (spec §4).
#[derive(Debug, Clone, PartialEq, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct BootstrapTally {
    pub method: Method,
    /// Taxon names in alignment order; taxon `i` is bit `i` of a split.
    pub labels: Vec<String>,
    /// Replicates that produced a tree.
    pub successful: u32,
    /// Replicates skipped for saturation or missing overlap.
    pub failed: u32,
    /// Grouping -> number of successful replicate trees containing it.
    /// `BTreeMap` keeps iteration deterministic. On the wire a grouping
    /// is its sorted label list (spec §4), so the TS type is the
    /// serialized entry list, not the map.
    #[ts(type = "{ labels: string[], count: number, }[]")]
    pub counts: BTreeMap<Split, u32>,
}

/// One serialized `counts` entry: a grouping as a sorted label list.
#[derive(Debug, Serialize, Deserialize)]
struct CountEntry {
    labels: Vec<String>,
    count: u32,
}

#[derive(Serialize)]
struct TallyWire<'a> {
    method: Method,
    labels: &'a [String],
    successful: u32,
    failed: u32,
    counts: Vec<CountEntry>,
}

impl Serialize for BootstrapTally {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        let counts = self
            .counts
            .iter()
            .map(|(s, &count)| CountEntry {
                labels: s.labels(&self.labels),
                count,
            })
            .collect();
        TallyWire {
            method: self.method,
            labels: &self.labels,
            successful: self.successful,
            failed: self.failed,
            counts,
        }
        .serialize(ser)
    }
}

#[derive(Deserialize)]
struct TallyOwned {
    method: Method,
    labels: Vec<String>,
    successful: u32,
    failed: u32,
    counts: Vec<CountEntry>,
}

impl<'de> Deserialize<'de> for BootstrapTally {
    fn deserialize<D: serde::Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        let wire = TallyOwned::deserialize(de)?;
        let pos: HashMap<&str, usize> = wire
            .labels
            .iter()
            .enumerate()
            .map(|(i, l)| (l.as_str(), i))
            .collect();
        let mut counts = BTreeMap::new();
        for entry in wire.counts {
            let ix: Vec<usize> = entry
                .labels
                .iter()
                .map(|l| {
                    pos.get(l.as_str()).copied().ok_or_else(|| {
                        serde::de::Error::custom(format!("unknown taxon label '{l}' in counts"))
                    })
                })
                .collect::<Result<_, D::Error>>()?;
            *counts.entry(Split::from_indices(&ix)).or_insert(0) += entry.count;
        }
        Ok(BootstrapTally {
            method: wire.method,
            labels: wire.labels,
            successful: wire.successful,
            failed: wire.failed,
            counts,
        })
    }
}

/// Run replicates `start .. start + count` and tally their groupings
/// (spec §3.3). Replicate `i` depends only on `(seed, i)`, so batches
/// merge exactly via `merge_tallies`. Trees are built with no trace
/// and discarded after tallying.
///
/// Errors: any `NeoError` other than the two skip conditions
/// (`InsufficientOverlap`, saturated cells) propagates immediately;
/// when every requested replicate is skipped the result is
/// `BootstrapFailed { failed, total: count }`.
pub fn bootstrap_batch(
    aln: &Alignment,
    model: DistModel,
    method: Method,
    seed: u64,
    start: u32,
    count: u32,
) -> Result<BootstrapTally, NeoError> {
    let n = aln.seqs.len();
    // The same generated-label fallback `compute_weighted` uses, so the
    // tally names match the tree it builds.
    let labels: Vec<String> = (0..n).map(|i| crate::dist::label(&aln.labels, i)).collect();
    let l = aln.seqs.iter().map(Vec::len).max().unwrap_or(0);
    let rooted = method == Method::Upgma;

    let mut tally = BootstrapTally {
        method,
        labels,
        successful: 0,
        failed: 0,
        counts: BTreeMap::new(),
    };
    for i in start..start.saturating_add(count) {
        let w = resample_weights(seed, i, l);
        let dm = match compute_weighted(aln, model, &w) {
            Ok(dm) => dm,
            Err(NeoError::InsufficientOverlap { .. }) => {
                tally.failed += 1;
                continue;
            }
            Err(e) => return Err(e),
        };
        if !dm.saturated_cells().is_empty() {
            tally.failed += 1;
            continue;
        }
        let tree = build_tree(&dm, method, BuildOptions { trace: false })?.tree;
        // Each replicate contributes each grouping at most once, even
        // on degenerate trees with repeated leaf sets.
        let seen: BTreeSet<Split> = tree_splits(&tree, &tally.labels, rooted)
            .into_iter()
            .map(|(_, s)| s)
            .collect();
        for s in seen {
            *tally.counts.entry(s).or_insert(0) += 1;
        }
        tally.successful += 1;
    }
    if count > 0 && tally.successful == 0 {
        return Err(NeoError::BootstrapFailed {
            failed: tally.failed,
            total: count,
        });
    }
    Ok(tally)
}

/// Combine two tallies over the same alignment, method and run
/// (spec §3.3). `a` and `b` must cover disjoint replicate ranges; the
/// function cannot check that, so the caller must keep ranges apart.
pub fn merge_tallies(a: &BootstrapTally, b: &BootstrapTally) -> Result<BootstrapTally, NeoError> {
    if a.method != b.method {
        return Err(NeoError::InvalidExercise {
            field: "method".to_string(),
            msg: "cannot merge tallies computed with different methods".to_string(),
        });
    }
    if a.labels != b.labels {
        let sa: BTreeSet<&String> = a.labels.iter().collect();
        let sb: BTreeSet<&String> = b.labels.iter().collect();
        return Err(NeoError::LabelMismatch {
            only_in_a: sa.difference(&sb).map(|s| (*s).clone()).collect(),
            only_in_b: sb.difference(&sa).map(|s| (*s).clone()).collect(),
        });
    }
    let mut counts = a.counts.clone();
    for (s, c) in &b.counts {
        *counts.entry(*s).or_insert(0) += c;
    }
    Ok(BootstrapTally {
        method: a.method,
        labels: a.labels.clone(),
        successful: a.successful + b.successful,
        failed: a.failed + b.failed,
        counts,
    })
}
