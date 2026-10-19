#![no_main]

//! Feeds arbitrary UTF-8 to `load_exercise`. When an exercise parses, the
//! target drives the whole pipeline — simulate or reuse the embedded
//! alignment, compute, build_tree, then rf against the reference — so a
//! structurally valid but pathological exercise can still not panic the
//! engine. `load_exercise` normalizes v1 files to the v2 `data.kind`
//! shape, so both `Simulated` and `Embedded` are covered here.

use libfuzzer_sys::fuzz_target;
use neophylo_core::{
    build_tree, compute, load_exercise, parse_fasta, parse_newick, rf, simulate, with_alphabet,
    BuildOptions, ExerciseData,
};

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(exercise) = load_exercise(text) else {
        return;
    };
    let aln = match &exercise.data {
        ExerciseData::Simulated { true_tree, sim } => {
            let Ok(tree) = parse_newick(true_tree) else {
                return;
            };
            let Ok(aln) = simulate(&tree, sim) else {
                return;
            };
            aln
        }
        ExerciseData::Embedded { fasta, .. } => {
            let Ok(parsed) = parse_fasta(fasta) else {
                return;
            };
            let Ok(aln) = with_alphabet(parsed, exercise.alphabet) else {
                return;
            };
            aln
        }
    };
    let Ok(m) = compute(&aln, exercise.analysis.correction) else {
        return;
    };
    let Ok(built) = build_tree(&m, exercise.analysis.method, BuildOptions { trace: true }) else {
        return;
    };
    let Some(reference) = &exercise.reference else {
        return;
    };
    let Ok(truth) = parse_newick(&reference.newick) else {
        return;
    };
    let Ok(_) = rf(&truth, &built.tree) else {
        return;
    };
});
