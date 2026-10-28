//! Site filters (v1.4b spec §3.1): MEGA's three gap treatments as 0/1
//! column weights fed into the existing weighted distance path
//! (`compute_weighted`, bootstrap resampling). No distance function
//! changes; `Pairwise` is today's path bit for bit.
//!
//! A character is *missing* under the same rule the engine already
//! applies per pair: anything `dist::is_base` rejects for DNA
//! (`-`, `?`, `N`, IUPAC ambiguities) and anything `protein_index`
//! rejects for protein (`X`, `B Z J O * - ?`, …). Kept columns still
//! pairwise-delete missing characters, as MEGA does.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alphabet::{protein_index, Alphabet};
use crate::dist::is_base;
use crate::error::NeoError;
use crate::seq::Alignment;

/// MEGA's gap treatment (v1.4b spec §3.1, plan "Decided in this plan"):
/// the wire shape is `{ "kind": "pairwise" | "complete" | "partial",
/// "cutoff_pct": <0–100> }` with `cutoff_pct` present only for partial.
/// `Pairwise` is the default and the pre-v1.4b behavior.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum SiteFilter {
    /// Every column counts; missing characters are deleted per pair.
    /// Exactly today's path.
    #[default]
    Pairwise,
    /// A column counts only if no sequence is missing there.
    Complete,
    /// A column counts if the percentage of sequences not missing there
    /// is at least `cutoff_pct` (MEGA's site-coverage cutoff, integer
    /// comparison `present*100 >= cutoff_pct*n`; observed `>=` in
    /// `fixtures/worked/mega-notes.md`).
    Partial { cutoff_pct: u8 },
}

impl SiteFilter {
    /// The name used in `NeoError::NoSitesKept` and messages
    /// ("complete", "partial 95%").
    fn describe(self) -> String {
        match self {
            SiteFilter::Pairwise => "pairwise".to_string(),
            SiteFilter::Complete => "complete".to_string(),
            SiteFilter::Partial { cutoff_pct } => format!("partial {cutoff_pct}%"),
        }
    }
}

/// The result of applying a `SiteFilter` to an alignment: one weight
/// per column plus the dropped column indices (v1.4b spec §3.1 — the UI
/// shows them in the pair panel).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct SiteMask {
    /// 0/1 weight per alignment column, length = the longest sequence.
    pub weights: Vec<u32>,
    /// 0-based indices of the columns the filter removed, in order.
    pub removed: Vec<usize>,
}

/// Turn `aln` into 0/1 column weights under `filter` (v1.4b spec §3.1).
///
/// `cutoff_pct > 100` is `InvalidExercise { field:
/// "site_filter.cutoff_pct" }`. When the filter removes every column the
/// result is `NoSitesKept` naming the treatment; a zero-column
/// alignment is not "removed" and keeps the existing downstream errors.
pub fn site_mask(aln: &Alignment, filter: SiteFilter) -> Result<SiteMask, NeoError> {
    let cols = aln.seqs.iter().map(Vec::len).max().unwrap_or(0);
    let is_present: fn(u8) -> bool = match aln.alphabet {
        Alphabet::Dna => is_base,
        Alphabet::Protein => |b| protein_index(b).is_some(),
    };
    let mut weights = vec![0u32; cols];
    let mut removed = Vec::new();
    match filter {
        SiteFilter::Pairwise => weights.fill(1),
        SiteFilter::Complete => {
            for (k, w) in weights.iter_mut().enumerate() {
                if aln
                    .seqs
                    .iter()
                    .all(|s| s.get(k).is_some_and(|&b| is_present(b)))
                {
                    *w = 1;
                } else {
                    removed.push(k);
                }
            }
        }
        SiteFilter::Partial { cutoff_pct } => {
            if cutoff_pct > 100 {
                return Err(NeoError::InvalidExercise {
                    field: "site_filter.cutoff_pct".to_string(),
                    msg: format!("cutoff_pct must be an integer in 0-100, got {cutoff_pct}"),
                });
            }
            let n = aln.seqs.len() as u64;
            for (k, w) in weights.iter_mut().enumerate() {
                let present = aln
                    .seqs
                    .iter()
                    .filter(|s| s.get(k).is_some_and(|&b| is_present(b)))
                    .count() as u64;
                if present * 100 >= u64::from(cutoff_pct) * n {
                    *w = 1;
                } else {
                    removed.push(k);
                }
            }
        }
    }
    if !removed.is_empty() && removed.len() == cols {
        return Err(NeoError::NoSitesKept {
            filter: filter.describe(),
        });
    }
    Ok(SiteMask { weights, removed })
}
