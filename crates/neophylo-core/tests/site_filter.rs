//! Site filters (v1.4b spec §3.1, plan Task 3): `Pairwise` is the
//! existing path bit for bit; `Complete` and `Partial` match the frozen
//! MEGA-CC fixtures, including the 95% coverage boundary (`>=`, observed
//! in `fixtures/worked/mega-notes.md`).

use neophylo_core::bootstrap::{
    bootstrap_batch, bootstrap_batch_filtered, replicate_detail, replicate_detail_filtered,
};
use neophylo_core::dist::{compute, compute_filtered, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::site_filter::{site_mask, SiteFilter};
use neophylo_core::Method;
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn fixture_aln(rel: &str) -> Alignment {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(rel);
    parse_fasta(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn mega_json(rel: &str) -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/mega")
        .join(rel);
    serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn aln(records: &[(&str, &str)]) -> Alignment {
    let text: String = records
        .iter()
        .map(|(name, seq)| format!(">{name}\n{seq}\n"))
        .collect();
    parse_fasta(&text).unwrap()
}

/// The six top-level FASTA inputs, all DNA.
fn dna_inputs() -> &'static [&'static str] {
    &[
        "inputs/gaps_boundary.fasta",
        "inputs/jc12.fasta",
        "inputs/jc6.fasta",
        "inputs/jc7_long.fasta",
        "inputs/jc8_gaps.fasta",
        "inputs/k80_10.fasta",
    ]
}

/// Every cell bitwise equal (`f64::to_bits`), including Saturated — the
/// same rule `tests/weighted.rs` uses for the weighted path.
fn assert_bitwise(a: &DistanceMatrix, b: &DistanceMatrix, ctx: &str) {
    assert_eq!(a.labels, b.labels, "{ctx}: labels");
    assert_eq!(a.model, b.model, "{ctx}: model");
    assert_eq!(a.cells.len(), b.cells.len(), "{ctx}: cell count");
    for (i, (c1, c2)) in a.cells.iter().zip(b.cells.iter()).enumerate() {
        match (c1, c2) {
            (Cell::Value(v1), Cell::Value(v2)) => {
                assert_eq!(v1.to_bits(), v2.to_bits(), "{ctx}: cell {i}")
            }
            _ => assert_eq!(c1, c2, "{ctx}: cell {i}"),
        }
    }
}

#[test]
fn pairwise_is_identity() {
    for rel in dna_inputs() {
        let aln = fixture_aln(rel);
        for model in [DistModel::P, DistModel::Jc69, DistModel::K80] {
            let ctx = format!("{rel} {}", model.name());
            assert_bitwise(
                &compute_filtered(&aln, model, SiteFilter::Pairwise).unwrap(),
                &compute(&aln, model).unwrap(),
                &ctx,
            );
            for method in [Method::Nj, Method::Upgma] {
                let ctx = format!("{ctx} {method:?}");
                assert_eq!(
                    bootstrap_batch_filtered(&aln, model, method, SiteFilter::Pairwise, 7, 0, 20)
                        .unwrap(),
                    bootstrap_batch(&aln, model, method, 7, 0, 20).unwrap(),
                    "{ctx}: tally"
                );
            }
        }
        // Same identity for the per-replicate detail path.
        for i in [0u32, 3, 19] {
            assert_eq!(
                replicate_detail_filtered(
                    &aln,
                    DistModel::P,
                    Method::Nj,
                    SiteFilter::Pairwise,
                    7,
                    i
                )
                .unwrap(),
                replicate_detail(&aln, DistModel::P, Method::Nj, 7, i).unwrap(),
                "{rel}: replicate {i}"
            );
        }
    }
}

#[test]
fn complete_removes_any_gap_column() {
    // gaps_boundary: column 0 is 19/20 present, column 1 is 18/20; every
    // other column is gap-free (fixtures/worked/mega-notes.md).
    let aln = fixture_aln("inputs/gaps_boundary.fasta");
    let mask = site_mask(&aln, SiteFilter::Complete).unwrap();
    assert_eq!(mask.removed, vec![0, 1]);
    assert_eq!(mask.weights.len(), 1000);
    assert_eq!(mask.weights.iter().filter(|&&w| w == 1).count(), 998);
}

#[test]
fn partial_boundary_matches_mega() {
    // MEGA keeps the column at exactly 95% coverage and drops the 90%
    // column, so the comparison is `present*100 >= cutoff_pct*n`
    // (fixtures/worked/mega-notes.md, "Partial cutoff boundary").
    let aln = fixture_aln("inputs/gaps_boundary.fasta");
    let mask = site_mask(&aln, SiteFilter::Partial { cutoff_pct: 95 }).unwrap();
    assert_eq!(mask.removed, vec![1]);
    assert_eq!(mask.weights.iter().filter(|&&w| w == 1).count(), 999);
}

#[test]
fn mega_p_distance_matches() {
    // MEGA-CC's own p-distance under complete and partial-95 deletion on
    // every DNA input, within half an ulp of the printed 8 decimals
    // (per-task note; leaves JC69/K80/protein to Task 4's parity test).
    let tol = 0.5e-8;
    for rel in dna_inputs() {
        let aln = fixture_aln(rel);
        let stem = rel.rsplit('/').next().unwrap().trim_end_matches(".fasta");
        let fixture = mega_json(&format!("{stem}.json"));
        for (key, filter) in [
            ("p/complete", SiteFilter::Complete),
            ("p/partial95", SiteFilter::Partial { cutoff_pct: 95 }),
        ] {
            let ctx = format!("{rel} {key}");
            let expected = &fixture["distances"][key];
            let dm = compute_filtered(&aln, DistModel::P, filter).unwrap();
            let labels: Vec<&str> = expected["labels"]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| l.as_str().unwrap())
                .collect();
            assert_eq!(dm.labels, labels, "{ctx}: labels");
            let matrix = expected["matrix"].as_array().unwrap();
            let n = labels.len();
            for (i, row) in matrix.iter().enumerate() {
                for (j, cell) in row.as_array().unwrap().iter().enumerate() {
                    let exp = cell.as_f64().unwrap_or_else(|| {
                        panic!("{ctx}: MEGA reports n/c at ({i},{j}) but we computed a matrix")
                    });
                    match dm.cells[i * n + j] {
                        Cell::Value(v) => assert!(
                            (v - exp).abs() <= tol,
                            "{ctx}: cell ({i},{j}): {v} vs MEGA {exp}"
                        ),
                        Cell::Saturated => {
                            panic!("{ctx}: cell ({i},{j}) saturated, MEGA has {exp}")
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn all_gap_alignment_is_no_sites_kept() {
    // Every column is missing in some sequence (Review Focus 1).
    let aln = aln(&[("a", "-AA"), ("b", "A-A"), ("c", "AA-")]);
    let err = site_mask(&aln, SiteFilter::Complete).unwrap_err();
    assert_eq!(
        err,
        NeoError::NoSitesKept {
            filter: "complete".to_string()
        }
    );
    assert_eq!(
        err.to_string(),
        "every site was removed by complete deletion"
    );
    // Partial with 2 of 3 present per column also removes all at 95%.
    let err = site_mask(&aln, SiteFilter::Partial { cutoff_pct: 95 }).unwrap_err();
    assert_eq!(
        err,
        NeoError::NoSitesKept {
            filter: "partial 95%".to_string()
        }
    );
    assert_eq!(
        err.to_string(),
        "every site was removed by partial 95% deletion"
    );
    // The same error reaches callers of the distance entry point.
    assert_eq!(
        compute_filtered(&aln, DistModel::P, SiteFilter::Complete).unwrap_err(),
        NeoError::NoSitesKept {
            filter: "complete".to_string()
        }
    );
}

#[test]
fn cutoff_over_100_is_refused() {
    // Review Focus 2: out-of-range cutoffs are refused with a field path.
    let aln = aln(&[("a", "ACGT"), ("b", "ACGT")]);
    for cutoff_pct in [101u8, 255] {
        match site_mask(&aln, SiteFilter::Partial { cutoff_pct }) {
            Err(NeoError::InvalidExercise { field, .. }) => {
                assert_eq!(field, "site_filter.cutoff_pct")
            }
            other => panic!("cutoff {cutoff_pct}: expected InvalidExercise, got {other:?}"),
        }
        match compute_filtered(&aln, DistModel::P, SiteFilter::Partial { cutoff_pct }) {
            Err(NeoError::InvalidExercise { field, .. }) => {
                assert_eq!(field, "site_filter.cutoff_pct")
            }
            other => panic!("cutoff {cutoff_pct}: expected InvalidExercise, got {other:?}"),
        }
    }
}

#[test]
fn filtered_pair_without_overlap_is_insufficient_overlap() {
    // Review Focus 1: kept columns whose missing characters leave one
    // pair nothing to compare take the existing InsufficientOverlap
    // path, not NaN. 20 taxa, two columns each missing in one taxon:
    // both columns survive partial-95 (19/20), but taxa a and b share
    // no comparable kept site.
    let mut records: Vec<(String, String)> = (0..20)
        .map(|i| (format!("t{i}"), "AC".to_string()))
        .collect();
    records[0].1 = "-C".to_string();
    records[1].1 = "A-".to_string();
    let text: String = records
        .iter()
        .map(|(n, s)| format!(">{n}\n{s}\n"))
        .collect();
    let aln = parse_fasta(&text).unwrap();
    let mask = site_mask(&aln, SiteFilter::Partial { cutoff_pct: 95 }).unwrap();
    assert_eq!(mask.removed, Vec::<usize>::new());
    match compute_filtered(&aln, DistModel::P, SiteFilter::Partial { cutoff_pct: 95 }) {
        Err(NeoError::InsufficientOverlap { a, b }) => {
            assert_eq!((a.as_str(), b.as_str()), ("t0", "t1"))
        }
        other => panic!("expected InsufficientOverlap, got {other:?}"),
    }
}

#[test]
fn serde_wire_shape() {
    // The wire shape decided in the plan: internally tagged on `kind`,
    // `cutoff_pct` present only for partial.
    assert_eq!(
        serde_json::to_value(SiteFilter::Pairwise).unwrap(),
        serde_json::json!({ "kind": "pairwise" })
    );
    assert_eq!(
        serde_json::to_value(SiteFilter::Complete).unwrap(),
        serde_json::json!({ "kind": "complete" })
    );
    assert_eq!(
        serde_json::to_value(SiteFilter::Partial { cutoff_pct: 95 }).unwrap(),
        serde_json::json!({ "kind": "partial", "cutoff_pct": 95 })
    );
    assert_eq!(
        serde_json::from_value::<SiteFilter>(
            serde_json::json!({ "kind": "partial", "cutoff_pct": 80 })
        )
        .unwrap(),
        SiteFilter::Partial { cutoff_pct: 80 }
    );
    assert_eq!(SiteFilter::default(), SiteFilter::Pairwise);
}
