//! Reading-corpus oracle parity (v1.4d spec §5.6, plan Task 3).
//!
//! Every value in `fixtures/ref/reading/*.json` is replayed exactly — no
//! tolerance is involved: MRCA tip sets (`ape::getMRCA`), monophyly
//! (`ape::is.monophyletic`), sister tip sets, restricted subtrees
//! (`ape::keep.tip`), ancestor pairs, clade counts (`phy$Nnode`), rooted
//! same-relationships (`phangorn::RF.dist(rooted = TRUE) == 0`), and trait
//! tip states and change counts (the R `nodepath` walk). Each committed
//! input line under `fixtures/inputs/reading/` is also checked to parse
//! to the ref tree's topology.
//!
//! Fixtures are the oracle: a failure here is a bug in the engine, never
//! in the fixture (AGENTS.md rule 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use neophylo_core::newick::parse_newick;
use neophylo_core::reading::query::{
    clade_key, count_clades, find_clade, is_ancestor, is_clade, mrca, restrict, same_relationships,
    sister_tips,
};
use neophylo_core::reading::traits::{change_count, tip_states, Mark};
use neophylo_core::Tree;

#[derive(Deserialize)]
struct RefFile {
    trees: Vec<RefTree>,
    #[serde(default)]
    same: Vec<SamePair>,
    #[serde(default)]
    traits: Vec<TraitOut>,
}

#[derive(Deserialize)]
struct RefTree {
    newick: String,
    #[serde(default)]
    mrca: Vec<MrcaQ>,
    #[serde(default)]
    monophyletic: Vec<MonoQ>,
    #[serde(default)]
    sister: Vec<SisterQ>,
    #[serde(default)]
    restrict: Vec<RestrictQ>,
    #[serde(default)]
    ancestor_pairs: Vec<AncPair>,
    #[serde(default)]
    clade_count: Option<u32>,
    #[serde(default)]
    marks: Vec<Mark>,
}

#[derive(Deserialize)]
struct MrcaQ {
    tips: Vec<String>,
    clade: Vec<String>,
}

#[derive(Deserialize)]
struct MonoQ {
    tips: Vec<String>,
    value: bool,
}

#[derive(Deserialize)]
struct SisterQ {
    tip: String,
    sisters: Vec<String>,
}

#[derive(Deserialize)]
struct RestrictQ {
    tips: Vec<String>,
    newick: String,
}

#[derive(Deserialize)]
struct AncPair {
    ancestor: Vec<String>,
    descendant: Vec<String>,
}

#[derive(Deserialize)]
struct SamePair {
    a: usize,
    b: usize,
    value: bool,
}

#[derive(Deserialize)]
struct TraitOut {
    tree: usize,
    states: BTreeMap<String, BTreeMap<String, bool>>,
    changes: BTreeMap<String, u32>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: PathBuf) -> T {
    let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {path:?}: {e}"))
}

/// The committed input `.nwk` lines parse to the ref trees' topologies.
fn input_trees(name: &str, rf: &RefFile) -> Vec<Tree> {
    let input = fs::read_to_string(fixtures_dir().join(format!("inputs/reading/{name}.nwk")))
        .unwrap_or_else(|e| panic!("read {name}.nwk: {e}"));
    let lines: Vec<&str> = input.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(
        lines.len(),
        rf.trees.len(),
        "{name}: input/ref tree count differs"
    );
    rf.trees
        .iter()
        .enumerate()
        .map(|(i, rt)| {
            let reference = parse_newick(&rt.newick)
                .unwrap_or_else(|e| panic!("{name} ref tree {i} newick: {e}"));
            let input = parse_newick(lines[i].trim())
                .unwrap_or_else(|e| panic!("{name} input line {i}: {e}"));
            assert!(
                same_relationships(&reference, &input).unwrap(),
                "{name} tree {i}: input line differs from the ref newick"
            );
            reference
        })
        .collect()
}

fn check_corpus(name: &str) {
    let rf: RefFile = read_json(fixtures_dir().join(format!("ref/reading/{name}.json")));
    let trees = input_trees(name, &rf);
    for (i, rt) in rf.trees.iter().enumerate() {
        let t = &trees[i];
        for q in &rt.mrca {
            let got = clade_key(t, mrca(t, &q.tips).unwrap());
            assert_eq!(got, q.clade, "{name} tree {i} mrca {:?}", q.tips);
        }
        for q in &rt.monophyletic {
            assert_eq!(
                is_clade(t, &q.tips).unwrap(),
                q.value,
                "{name} tree {i} monophyletic {:?}",
                q.tips
            );
        }
        for q in &rt.sister {
            assert_eq!(
                sister_tips(t, &q.tip).unwrap(),
                q.sisters,
                "{name} tree {i} sister of {}",
                q.tip
            );
        }
        for q in &rt.restrict {
            let got = restrict(t, &q.tips).unwrap();
            let want = parse_newick(&q.newick)
                .unwrap_or_else(|e| panic!("{name} tree {i} restrict newick: {e}"));
            assert!(
                same_relationships(&got, &want).unwrap(),
                "{name} tree {i} restrict {:?} topology differs",
                q.tips
            );
        }
        for p in &rt.ancestor_pairs {
            let anc = find_clade(t, &p.ancestor)
                .unwrap_or_else(|| panic!("{name} tree {i} ancestor clade {:?}", p.ancestor));
            let desc = find_clade(t, &p.descendant)
                .unwrap_or_else(|| panic!("{name} tree {i} descendant clade {:?}", p.descendant));
            assert!(
                is_ancestor(t, anc, desc),
                "{name} tree {i} ancestor {:?} of {:?}",
                p.ancestor,
                p.descendant
            );
        }
        assert_eq!(
            count_clades(t),
            rt.clade_count.expect("corpus trees carry clade_count"),
            "{name} tree {i} clade_count"
        );
    }
    for pair in &rf.same {
        let got = same_relationships(&trees[pair.a], &trees[pair.b]).unwrap();
        assert_eq!(got, pair.value, "{name} same {} vs {}", pair.a, pair.b);
    }
}

#[test]
fn corpus_binary_parity() {
    check_corpus("corpus_binary");
}

#[test]
fn corpus_polytomy_parity() {
    check_corpus("corpus_polytomy");
}

#[test]
fn rotations_parity() {
    check_corpus("rotations");
}

#[test]
fn traits_parity() {
    let rf: RefFile = read_json(fixtures_dir().join("ref/reading/traits.json"));
    let trees = input_trees("traits", &rf);
    for (i, rt) in rf.trees.iter().enumerate() {
        assert_eq!(
            count_clades(&trees[i]),
            rt.clade_count.expect("corpus trees carry clade_count"),
            "traits tree {i} clade_count"
        );
    }
    for out in &rf.traits {
        let rt = &rf.trees[out.tree];
        let t = &trees[out.tree];
        for (trait_name, &count) in &out.changes {
            assert_eq!(
                change_count(&rt.marks, trait_name),
                count,
                "traits tree {} changes for {trait_name}",
                out.tree
            );
            let states = tip_states(t, &rt.marks, trait_name).unwrap();
            for (tip, tip_states_ref) in &out.states {
                let want = tip_states_ref[trait_name];
                let got = *states
                    .get(tip)
                    .unwrap_or_else(|| panic!("traits tree {} tip {tip} missing", out.tree));
                assert_eq!(
                    got, want,
                    "traits tree {} tip {tip} state for {trait_name}",
                    out.tree
                );
            }
        }
    }
}
