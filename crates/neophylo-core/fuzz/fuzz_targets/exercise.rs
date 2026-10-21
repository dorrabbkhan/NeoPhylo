#![no_main]

//! Feeds arbitrary UTF-8 to `load_exercise`. When an exercise parses, the
//! target drives the whole pipeline — simulate or reuse the embedded
//! alignment, compute, build_tree, then rf against the reference — so a
//! structurally valid but pathological exercise can still not panic the
//! engine. `load_exercise` normalizes v1 files to the v2 `data.kind`
//! shape, so both `Simulated` and `Embedded` are covered here.
//!
//! v1.2 Task 14: an exercise carrying a `bootstrap` block also drives a
//! small bootstrap (two replicates with the block's seed), support
//! annotation and every consensus kind; with a reference the target
//! reroots on the reference's outgroup too (spec §3.8).

use libfuzzer_sys::fuzz_target;
use neophylo_core::{
    bootstrap_batch, build_tree, compute, consensus, load_exercise, parse_fasta, parse_newick,
    reference_outgroup, reroot_on_outgroup, rf, simulate, support_on_tree, with_alphabet,
    BuildOptions, ConsensusKind, ExerciseData,
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
    // v1.2 Task 14: an exercise carrying a `bootstrap` block drives the
    // bootstrap paths too — two replicates keep the run trivial while
    // still exercising the tally, support annotation and all consensus
    // kinds (spec §3.8).
    if let Some(b) = exercise.bootstrap {
        if let Ok(tally) = bootstrap_batch(
            &aln,
            exercise.analysis.correction,
            exercise.analysis.method,
            b.seed,
            0,
            2,
        ) {
            let _ = support_on_tree(&built.tree, &tally);
            for kind in [
                ConsensusKind::Strict,
                ConsensusKind::Majority,
                ConsensusKind::Extended,
            ] {
                let _ = consensus(&tally, kind);
            }
        }
    }
    let Some(reference) = &exercise.reference else {
        return;
    };
    let Ok(truth) = parse_newick(&reference.newick) else {
        return;
    };
    let _ = rf(&truth, &built.tree);
    let outgroup = reference_outgroup(&truth);
    let _ = reroot_on_outgroup(&built.tree, &outgroup);
});
