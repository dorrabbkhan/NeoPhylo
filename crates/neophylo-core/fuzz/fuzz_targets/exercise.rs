#![no_main]

//! Feeds arbitrary UTF-8 to `load_exercise`. When an exercise parses, the
//! target drives the whole pipeline — simulate, compute, build_tree — so a
//! structurally valid but pathological exercise can still not panic the
//! engine.

use libfuzzer_sys::fuzz_target;
use neophylo_core::{build_tree, compute, load_exercise, parse_newick, simulate, BuildOptions};

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(exercise) = load_exercise(text) else {
        return;
    };
    let Ok(tree) = parse_newick(&exercise.true_tree) else {
        return;
    };
    let Ok(aln) = simulate(&tree, &exercise.sim) else {
        return;
    };
    let Ok(m) = compute(&aln, exercise.analysis.correction) else {
        return;
    };
    let _ = build_tree(&m, exercise.analysis.method, BuildOptions { trace: true });
});
