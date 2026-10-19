//! Consensus trees (v1.2 spec §3.5): exact agreement with the PHYLIP
//! `consense` fixtures (topology RF = 0 and per-grouping counts), the
//! hand worked example, the strict `count > successful / 2` boundary,
//! the extended majority tie rule and the dropped-grouping list.

use neophylo_core::algos::Method;
use neophylo_core::bootstrap::{
    consensus, consensus_dropped, tree_splits, BootstrapTally, ConsensusKind, DroppedGroup, Split,
};
use neophylo_core::compare::rf;
use neophylo_core::newick::parse_newick;
use neophylo_core::tree::Tree;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
struct GroupEntry {
    labels: Vec<String>,
    count: u32,
}

#[derive(Deserialize)]
struct ConsenseResult {
    newick: String,
    groups: Vec<GroupEntry>,
}

#[derive(Deserialize)]
struct ConsenseOut {
    strict: ConsenseResult,
    majority: ConsenseResult,
    extended: ConsenseResult,
}

#[derive(Deserialize)]
struct ConsensusFixture {
    name: String,
    rooted: bool,
    labels: Vec<String>,
    trees: Vec<String>,
    consense: ConsenseOut,
}

fn consensus_fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/consensus")
}

fn load_consensus(path: &Path) -> ConsensusFixture {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

/// Tally a fixed tree list the way a bootstrap run would (same rule as
/// tests/support.rs): each tree contributes each grouping once, every
/// tree counts as a successful replicate.
fn tally_of(labels: &[String], trees: &[String], rooted: bool) -> BootstrapTally {
    let method = if rooted { Method::Upgma } else { Method::Nj };
    let mut counts: BTreeMap<Split, u32> = BTreeMap::new();
    for text in trees {
        let t = parse_newick(text).unwrap();
        let seen: BTreeSet<Split> = tree_splits(&t, labels, rooted)
            .into_iter()
            .map(|(_, s)| s)
            .collect();
        for s in seen {
            *counts.entry(s).or_insert(0) += 1;
        }
    }
    BootstrapTally {
        method,
        labels: labels.to_vec(),
        successful: trees.len() as u32,
        failed: 0,
        counts,
    }
}

/// The `Split` a label list names. Unrooted lists name one side of a
/// bipartition; the canonical side never contains taxon 0.
fn canonical_split(labels: &[String], group: &[String], rooted: bool) -> Split {
    let mut ix: Vec<usize> = group
        .iter()
        .map(|l| {
            labels
                .iter()
                .position(|x| x == l)
                .unwrap_or_else(|| panic!("unknown label '{l}'"))
        })
        .collect();
    if !rooted && ix.contains(&0) {
        ix = (0..labels.len()).filter(|i| !ix.contains(i)).collect();
    }
    Split::from_indices(&ix)
}

/// The grouping set a tree induces for the tally's method.
fn groupings_of(tree: &Tree, labels: &[String], rooted: bool) -> BTreeSet<Split> {
    tree_splits(tree, labels, rooted)
        .into_iter()
        .map(|(_, s)| s)
        .collect()
}

#[test]
fn consense_exact() {
    let mut files: Vec<PathBuf> = fs::read_dir(consensus_fixtures_dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no consensus fixtures found");

    for path in files {
        let fix = load_consensus(&path);
        let tally = tally_of(&fix.labels, &fix.trees, fix.rooted);
        let kinds = [
            (ConsensusKind::Strict, &fix.consense.strict, "strict"),
            (ConsensusKind::Majority, &fix.consense.majority, "majority"),
            (ConsensusKind::Extended, &fix.consense.extended, "extended"),
        ];
        for (kind, expected, kind_name) in kinds {
            let got = consensus(&tally, kind);
            assert_eq!(
                got.rooted, fix.rooted,
                "{} {kind_name}: rooted flag",
                fix.name
            );
            assert!(
                got.branches.iter().all(|b| b.length.is_none()),
                "{} {kind_name}: consensus must carry no branch lengths",
                fix.name
            );

            let want = parse_newick(&expected.newick).unwrap();
            if fix.rooted {
                // Rooted comparison: the cluster sets must be equal.
                let a = groupings_of(&got, &fix.labels, true);
                let b = groupings_of(&want, &fix.labels, true);
                assert_eq!(a, b, "{} {kind_name}: cluster sets differ", fix.name);
            } else {
                let r = rf(&want, &got).unwrap();
                assert_eq!(r.rf, 0, "{} {kind_name}: RF != 0", fix.name);
            }

            // Each reported grouping's support x successful equals the
            // consense count, and the consensus shows exactly those
            // groupings.
            let support_of: BTreeMap<Split, f64> = tree_splits(&got, &fix.labels, fix.rooted)
                .into_iter()
                .map(|(id, s)| (s, got.branches[id.0 as usize].support.unwrap()))
                .collect();
            assert_eq!(
                expected.groups.len(),
                support_of.len(),
                "{} {kind_name}: grouping count",
                fix.name
            );
            for g in &expected.groups {
                let s = canonical_split(&fix.labels, &g.labels, fix.rooted);
                let support = *support_of.get(&s).unwrap_or_else(|| {
                    panic!("{} {kind_name}: missing grouping {:?}", fix.name, g.labels)
                });
                assert!(
                    (support * tally.successful as f64 - g.count as f64).abs() < 1e-9,
                    "{} {kind_name}: grouping {:?} support {support} x {} != count {}",
                    fix.name,
                    g.labels,
                    tally.successful,
                    g.count
                );
            }
        }
    }
}

#[derive(Deserialize)]
struct HandFixture {
    labels: Vec<String>,
    trees: Vec<String>,
    expected: BTreeMap<String, Vec<Vec<String>>>,
}

#[test]
fn hand_example() {
    // 7x ((A,B),C,(D,E)) + 3x ((A,B),E,(C,D)) on 5 taxa: counts
    // CDE = 10, DE = 7, CD = 3 (CD incompatible with DE).
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/worked/consensus_hand.json");
    let fix: HandFixture = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let tally = tally_of(&fix.labels, &fix.trees, false);

    for (kind, key) in [
        (ConsensusKind::Strict, "strict"),
        (ConsensusKind::Majority, "majority"),
        (ConsensusKind::Extended, "extended"),
    ] {
        let got = consensus(&tally, kind);
        let have = groupings_of(&got, &fix.labels, false);
        let want: BTreeSet<Split> = fix.expected[key]
            .iter()
            .map(|g| canonical_split(&fix.labels, g, false))
            .collect();
        assert_eq!(have, want, "consensus_hand {key}");
        for (s, &count) in &tally.counts {
            if want.contains(s) {
                // support x successful equals the grouping's count.
                let pos = tree_splits(&got, &fix.labels, false)
                    .into_iter()
                    .find(|(_, gs)| *gs == *s)
                    .map(|(id, _)| id)
                    .unwrap();
                let support = got.branches[pos.0 as usize].support.unwrap();
                assert!(
                    (support * tally.successful as f64 - count as f64).abs() < 1e-9,
                    "consensus_hand {key}: support for {s:?}"
                );
            }
        }
    }
}

#[test]
fn majority_strictly_greater() {
    // 50 of 100 is not a majority: the grouping is excluded (strict
    // `count > successful / 2`, spec §3.5).
    let labels: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
    let mut counts = BTreeMap::new();
    counts.insert(Split::from_indices(&[2, 3]), 50u32); // {c,d}
    let tally = BootstrapTally {
        method: Method::Nj,
        labels: labels.clone(),
        successful: 100,
        failed: 0,
        counts,
    };
    let got = consensus(&tally, ConsensusKind::Majority);
    assert!(
        groupings_of(&got, &labels, false).is_empty(),
        "50% grouping must not enter the majority consensus"
    );
    // At 51 it does.
    let mut tally51 = tally.clone();
    *tally51
        .counts
        .get_mut(&Split::from_indices(&[2, 3]))
        .unwrap() = 51;
    let got = consensus(&tally51, ConsensusKind::Majority);
    assert_eq!(
        groupings_of(&got, &labels, false),
        BTreeSet::from([Split::from_indices(&[2, 3])]),
        "51% grouping must enter the majority consensus"
    );
}

#[test]
fn extended_tie_rule() {
    // Two incompatible groupings with equal counts: the lower bitset
    // value wins (spec §3.5). {b,c} = bits 1,2 < {c,d} = bits 2,3.
    let labels: Vec<String> = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let bc = Split::from_indices(&[1, 2]);
    let cd = Split::from_indices(&[2, 3]);
    assert!(
        !bc.compatible(&cd, 5),
        "the test needs an incompatible pair"
    );
    let mut counts = BTreeMap::new();
    counts.insert(bc, 40u32);
    counts.insert(cd, 40u32);
    let tally = BootstrapTally {
        method: Method::Nj,
        labels: labels.clone(),
        successful: 100,
        failed: 0,
        counts,
    };
    let got = consensus(&tally, ConsensusKind::Extended);
    assert_eq!(
        groupings_of(&got, &labels, false),
        BTreeSet::from([bc]),
        "extended must keep the lower-bitset grouping on a count tie"
    );
}

#[test]
fn dropped() {
    // The original tree ((a,b),e,(c,d)) has groupings {c,d,e} and
    // {c,d}; at counts 100 and 40 Majority keeps only {c,d,e} and the
    // dropped list reports {c,d} at 0.4.
    let original = parse_newick("((a,b),e,(c,d));").unwrap();
    let labels: Vec<String> = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let mut counts = BTreeMap::new();
    counts.insert(Split::from_indices(&[2, 3, 4]), 100u32); // {c,d,e}
    counts.insert(Split::from_indices(&[2, 3]), 40u32); // {c,d}
    let tally = BootstrapTally {
        method: Method::Nj,
        labels,
        successful: 100,
        failed: 0,
        counts,
    };
    let dropped = consensus_dropped(&original, &tally, ConsensusKind::Majority);
    assert_eq!(
        dropped,
        vec![DroppedGroup {
            labels: vec!["c".to_string(), "d".to_string()],
            support: 0.4,
        }]
    );
    // Strict keeps {c,d,e} as well, so the same grouping is dropped;
    // Extended adds {c,d} (compatible), so nothing is dropped.
    assert_eq!(
        consensus_dropped(&original, &tally, ConsensusKind::Extended),
        Vec::<DroppedGroup>::new(),
        "extended keeps the compatible 40% grouping"
    );
}
