//! Grouping tallies (v1.2 spec §3.3): canonical split/cluster
//! extraction, batch independence, failed replicates, tiny trees
//! (Review Focus 1) and `replicate_detail` agreeing with
//! `bootstrap_batch`.

use neophylo_core::algos::{build_tree, BuildOptions, Method};
use neophylo_core::bootstrap::{
    bootstrap_batch, merge_tallies, replicate_detail, resample_weights, tree_splits, Split,
};
use neophylo_core::dist::{compute, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::tree::Tree;
use proptest::prelude::*;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

fn fixture_aln(rel: &str) -> Alignment {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(rel);
    parse_fasta(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn built_tree(aln: &Alignment, model: DistModel, method: Method) -> Tree {
    let dm = compute(aln, model).unwrap();
    build_tree(&dm, method, BuildOptions { trace: false })
        .unwrap()
        .tree
}

fn grouping_set(tree: &Tree, labels: &[String], rooted: bool) -> BTreeSet<Split> {
    tree_splits(tree, labels, rooted)
        .into_iter()
        .map(|(_, s)| s)
        .collect()
}

#[test]
fn batch_independence() {
    // spec §3.2 consequence: a replicate depends only on (seed, i), so
    // any batching — or a cancelled run resumed later — merges to the
    // same tally.
    let aln = fixture_aln("inputs/jc12.fasta");
    let full = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 100).unwrap();

    let mut quarters = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 25).unwrap();
    for start in [25u32, 50, 75] {
        let next = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, start, 25).unwrap();
        quarters = merge_tallies(&quarters, &next).unwrap();
    }
    assert_eq!(quarters, full, "4x25 merged differs from 1x100");

    let mut singles = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 1).unwrap();
    for i in 1..100u32 {
        let next = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, i, 1).unwrap();
        singles = merge_tallies(&singles, &next).unwrap();
    }
    assert_eq!(singles, full, "100x1 merged differs from 1x100");

    let first = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 60).unwrap();
    let rest = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 60, 40).unwrap();
    assert_eq!(
        merge_tallies(&first, &rest).unwrap(),
        full,
        "60 + 40 (cancelled run) differs from 1x100"
    );
}

#[test]
fn merge_rejects_mismatched_tallies() {
    let aln = fixture_aln("inputs/jc6.fasta");
    let nj = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 10).unwrap();
    let upgma = bootstrap_batch(&aln, DistModel::Jc69, Method::Upgma, 1, 0, 10).unwrap();
    let err = merge_tallies(&nj, &upgma).unwrap_err();
    assert!(
        matches!(err, NeoError::InvalidExercise { ref field, .. } if field == "method"),
        "method mismatch gave {err:?}"
    );

    let other = fixture_aln("inputs/jc7_long.fasta");
    let b = bootstrap_batch(&other, DistModel::Jc69, Method::Nj, 1, 0, 10).unwrap();
    let err = merge_tallies(&nj, &b).unwrap_err();
    assert!(
        matches!(err, NeoError::LabelMismatch { .. }),
        "label mismatch gave {err:?}"
    );
}

#[test]
fn canonical_splits() {
    let aln = fixture_aln("inputs/jc12.fasta");
    let labels = aln.labels.clone();
    let n = labels.len();

    // NJ: n - 3 canonical splits, none containing taxon 0, both sides >= 2.
    let nj = built_tree(&aln, DistModel::Jc69, Method::Nj);
    let splits = tree_splits(&nj, &labels, false);
    assert_eq!(splits.len(), n - 3, "unrooted binary tree on {n} taxa");
    for (_, s) in &splits {
        assert!(!s.contains(0), "canonical split contains taxon 0");
        assert!(s.len() >= 2 && s.len() <= n as u32 - 2);
    }

    // UPGMA: n - 2 clusters, each of size 2..=n-1.
    let upgma = built_tree(&aln, DistModel::Jc69, Method::Upgma);
    let clusters = tree_splits(&upgma, &labels, true);
    assert_eq!(clusters.len(), n - 2, "rooted binary tree on {n} taxa");
    for (_, s) in &clusters {
        assert!(
            (2..=n as u32 - 1).contains(&s.len()),
            "cluster of size {} out of range",
            s.len()
        );
    }
}

/// Independent compatibility check for *canonical* unrooted splits:
/// two splits coexist iff one of the four intersections is empty; with
/// canonical sides neither contains taxon 0, so the complement-corner
/// is never empty.
fn brute_compatible(a: &BTreeSet<usize>, b: &BTreeSet<usize>, n: usize) -> bool {
    let all: BTreeSet<usize> = (0..n).collect();
    let na: BTreeSet<usize> = all.difference(a).copied().collect();
    let nb: BTreeSet<usize> = all.difference(b).copied().collect();
    a.is_disjoint(b) || a.is_disjoint(&nb) || na.is_disjoint(b) || na.is_disjoint(&nb)
}

fn canonical_subset(bits: &[bool]) -> BTreeSet<usize> {
    let mut ix: BTreeSet<usize> = (0..bits.len()).filter(|&i| bits[i]).collect();
    if ix.contains(&0) {
        ix = (0..bits.len()).filter(|i| !ix.contains(i)).collect();
    }
    ix
}

proptest! {
    #[test]
    fn compatible_matches_brute_force(
        n in 4usize..=20,
        bits_a in proptest::collection::vec(proptest::bool::ANY, 4..=20),
        bits_b in proptest::collection::vec(proptest::bool::ANY, 4..=20),
    ) {
        let n = n.min(bits_a.len()).min(bits_b.len());
        let a_ix = canonical_subset(&bits_a[..n]);
        let b_ix = canonical_subset(&bits_b[..n]);
        let a = Split::from_indices(&a_ix.iter().copied().collect::<Vec<_>>());
        let b = Split::from_indices(&b_ix.iter().copied().collect::<Vec<_>>());
        prop_assert_eq!(
            a.compatible(&b, n),
            brute_compatible(&a_ix, &b_ix, n),
            "a={:?} b={:?} n={}",
            a_ix,
            b_ix,
            n
        );
    }
}

/// Four taxa near the JC69 saturation point: A vs B differ on 72 of
/// 100 columns; resampling fluctuation pushes some replicate over
/// p = 0.75 while most stay under.
fn near_saturated_aln() -> Alignment {
    let mut seqs = vec![vec![b'A'; 100]; 4];
    for b in seqs[1].iter_mut().take(72) {
        *b = b'G';
    }
    for b in seqs[2].iter_mut().take(40) {
        *b = b'C';
    }
    for b in seqs[3].iter_mut().take(40) {
        *b = b'T';
    }
    Alignment {
        labels: vec!["a".into(), "b".into(), "c".into(), "d".into()],
        seqs,
        alphabet: neophylo_core::Alphabet::Dna,
    }
}

#[test]
fn failed_replicates() {
    let aln = near_saturated_aln();
    let tally = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, 0, 100).unwrap();
    assert!(tally.failed > 0, "expected some saturated replicates");
    assert!(tally.successful > 0, "expected some replicates to succeed");
    assert_eq!(tally.successful + tally.failed, 100);

    // Every column differs for every pair: all replicates saturate.
    let all_sat = Alignment {
        labels: vec!["a".into(), "b".into(), "c".into()],
        seqs: vec![vec![b'A'; 50], vec![b'C'; 50], vec![b'G'; 50]],
        alphabet: neophylo_core::Alphabet::Dna,
    };
    let err = bootstrap_batch(&all_sat, DistModel::Jc69, Method::Nj, 1, 0, 100).unwrap_err();
    assert_eq!(
        err,
        NeoError::BootstrapFailed {
            failed: 100,
            total: 100
        }
    );
}

#[test]
fn tiny_trees() {
    // Review Focus 1, engine side.
    // Divergence stays under p = 0.4 for every pair, so no replicate
    // can reach the JC69 saturation point.
    let three = Alignment {
        labels: vec!["a".into(), "b".into(), "c".into()],
        seqs: vec![
            b"AAAAAAAAAACCCCCCCCCC".to_vec(),
            b"AAAAAAAAAACCCCCCCCCT".to_vec(),
            b"TTTTTTAAAAACCCCCCCCC".to_vec(),
        ],
        alphabet: neophylo_core::Alphabet::Dna,
    };
    for method in [Method::Nj, Method::Upgma] {
        let tally = bootstrap_batch(&three, DistModel::Jc69, method, 1, 0, 20).unwrap();
        match method {
            // An unrooted 3-taxon tree has no non-trivial split at all.
            Method::Nj => assert!(tally.counts.is_empty()),
            // A rooted 3-taxon tree has exactly one cluster (size 2).
            Method::Upgma => {
                assert_eq!(tally.counts.values().sum::<u32>(), tally.successful);
                assert!(tally.counts.keys().all(|s| s.len() == 2));
            }
        }
        assert_eq!(tally.successful, 20);
        assert_eq!(tally.failed, 0);
    }

    // Four taxa, unrooted: exactly one canonical split per replicate.
    // Two close pairs {a, b} and {c, d} separated at 7 shared signal
    // columns; every pair is under p = 0.35, so no replicate saturates.
    let four = Alignment {
        labels: vec!["a".into(), "b".into(), "c".into(), "d".into()],
        seqs: vec![
            b"AAAAAAACCCCCCCCCCCCC".to_vec(),
            b"AAAAAATCCCCCCCCCCCCC".to_vec(),
            b"GGGGGGGCCCCCCCCCCCCC".to_vec(),
            b"GGGGGGTCCCCCCCCCCCCC".to_vec(),
        ],
        alphabet: neophylo_core::Alphabet::Dna,
    };
    let tally = bootstrap_batch(&four, DistModel::Jc69, Method::Nj, 1, 0, 20).unwrap();
    assert_eq!(tally.successful + tally.failed, 20);
    assert_eq!(
        tally.counts.values().sum::<u32>(),
        tally.successful,
        "each successful replicate contributes exactly one grouping"
    );
    assert!(tally.counts.keys().all(|s| s.len() == 2 && !s.contains(0)));
}

#[test]
fn replicate_detail_rf_is_method_consistent() {
    // rf_to_original compares like with like: NJ reports the unrooted
    // RF, UPGMA the rooted cluster distance — in both methods it is
    // zero exactly when `differing` is empty, and both regimes occur.
    let aln = fixture_aln("inputs/jc6.fasta");
    for method in [Method::Nj, Method::Upgma] {
        let mut saw_same = false;
        let mut saw_diff = false;
        for i in 0..100u32 {
            let d = replicate_detail(&aln, DistModel::Jc69, method, 1, i).unwrap();
            if d.failed {
                continue;
            }
            let rf = d.rf_to_original.unwrap();
            if method == Method::Upgma {
                // Rooted cluster distance: the size of the symmetric
                // difference of the two trees' cluster sets.
                assert_eq!(rf, d.differing.len() as u32, "{method:?} replicate {i}");
            }
            assert_eq!(rf == 0, d.differing.is_empty(), "{method:?} replicate {i}");
            saw_same |= rf == 0;
            saw_diff |= rf > 0;
        }
        assert!(saw_same, "{method:?}: no replicate reproduced the original");
        assert!(
            saw_diff,
            "{method:?}: no replicate differed from the original"
        );
    }
}

#[test]
fn replicate_detail_matches_batch() {
    let aln = fixture_aln("inputs/jc6.fasta");
    let l = aln.seqs[0].len();
    let mut saw_identical = false;
    for i in 0..20u32 {
        let d = replicate_detail(&aln, DistModel::Jc69, Method::Nj, 1, i).unwrap();
        assert_eq!(d.index, i);
        let w = resample_weights(1, i, l);
        assert_eq!(d.weights, w, "replicate {i}: weights differ from resample");
        assert_eq!(
            d.undrawn,
            w.iter().filter(|&&x| x == 0).count() as u32,
            "replicate {i}: undrawn"
        );

        // The same replicate seen through a one-replicate batch.
        let one = bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, 1, i, 1).unwrap();
        if d.failed {
            assert_eq!(one.failed, 1, "replicate {i} failed but batch built it");
            assert!(d.tree.is_none());
            assert!(d.rf_to_original.is_none());
        } else {
            assert_eq!(one.successful, 1);
            let tree = d.tree.as_ref().unwrap();
            let groupings = grouping_set(tree, &one.labels, false);
            let counted: BTreeSet<Split> = one.counts.keys().copied().collect();
            assert_eq!(
                groupings, counted,
                "replicate {i}: batch counted other groupings"
            );
            // RF 0 exactly when no grouping differs.
            assert_eq!(d.rf_to_original == Some(0), d.differing.is_empty());
            if d.rf_to_original == Some(0) {
                saw_identical = true;
            }
        }
    }
    assert!(
        saw_identical,
        "expected at least one replicate to reproduce the original tree"
    );
}
