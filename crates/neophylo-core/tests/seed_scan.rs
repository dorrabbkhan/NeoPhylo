// Scratch harness for the Task-14 round-2 seed re-search (owner note:
// the designed {E,F,G,H} grouping must be weakest by ≥ 10 points below
// the next-weakest at length 300, still < 70%, still rising ≥ 20
// points at 3,000, still rf = 0 at both lengths). Run:
//
//   cargo test -p neophylo-core --test seed_scan -- --ignored --nocapture
//
// Not part of the shipped suite — deleted after the scan reports.

use neophylo_core::{
    bootstrap_batch, build_tree, compute, parse_newick, rf, support_on_tree,
    tree_splits, BuildOptions, DistModel, Method, SimModel, SimSpec,
};

const TRUE: &str =
    "((A:0.1,B:0.12):0.06,(C:0.1,D:0.11):0.06,((E:0.1,F:0.12):0.06,(G:0.1,H:0.11):0.06):0.005);";

/** Support per internal grouping, keyed by the canonical-side labels
 * joined "|" — the same key the drawn `data-split` carries. */
fn supports(
    tree: &neophylo_core::Tree,
    labels: &[String],
) -> Vec<(String, f64)> {
    let n = labels.len();
    let a_ix = labels.iter().position(|l| l == "A").unwrap();
    let mut out = Vec::new();
    for (id, split) in tree_splits(tree, labels, false) {
        let s = tree.branches[id.0 as usize].support;
        if s.is_none() {
            continue;
        }
        // Canonical side = the side that does not contain taxon 0 ("A").
        let mut side: Vec<&str> = Vec::new();
        if split.contains(a_ix) {
            for i in 0..n {
                if !split.contains(i) {
                    side.push(&labels[i]);
                }
            }
        } else {
            for i in 0..n {
                if split.contains(i) {
                    side.push(&labels[i]);
                }
            }
        }
        side.sort_unstable();
        out.push((side.join("|"), s.unwrap()));
    }
    out
}

#[test]
#[ignore = "scratch scan"]
fn seed_scan() {
    let truth = parse_newick(TRUE).expect("true tree parses");
    let labels = truth.leaf_labels();
    let opts = BuildOptions { trace: false };
    let target = "E|F|G|H";

    // Near-misses for the owner report: (margin300, sim, boot, efg300,
    // min_other300, efg3000, rise).
    let mut near: Vec<(f64, u64, u64, f64, f64, f64, f64)> = Vec::new();
    let mut found = false;

    'sim: for sim_seed in 0u64..200 {
        let spec300 = SimSpec {
            model: SimModel::Jc69,
            length: 300,
            seed: sim_seed,
        };
        let aln300 =
            neophylo_core::simulate(&truth, &spec300).expect("sim 300");
        let nj300 =
            build_tree(&compute(&aln300, DistModel::Jc69).unwrap(), Method::Nj, opts)
                .unwrap()
                .tree;
        if rf(&truth, &nj300).map(|r| r.rf).unwrap_or(u32::MAX) != 0 {
            continue;
        }
        let spec3000 = SimSpec {
            model: SimModel::Jc69,
            length: 3000,
            seed: sim_seed,
        };
        let aln3000 =
            neophylo_core::simulate(&truth, &spec3000).expect("sim 3000");
        let nj3000 =
            build_tree(&compute(&aln3000, DistModel::Jc69).unwrap(), Method::Nj, opts)
                .unwrap()
                .tree;
        if rf(&truth, &nj3000).map(|r| r.rf).unwrap_or(u32::MAX) != 0 {
            continue;
        }
        eprintln!("sim seed {sim_seed}: rf=0 at both lengths");

        for boot_seed in 0u64..200 {
            let tally =
                bootstrap_batch(&aln300, DistModel::Jc69, Method::Nj, boot_seed, 0, 100)
                    .unwrap();
            let st = support_on_tree(&nj300, &tally);
            let sup = supports(&st, &labels);
            let efg = sup.iter().find(|(k, _)| k == target).map(|(_, s)| *s);
            let Some(efg300) = efg else { continue };
            let mut others: Vec<(String, f64)> =
                sup.into_iter().filter(|(k, _)| k != target).collect();
            others.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            let (ref ok, min_other) = others[0];
            let margin = min_other - efg300;

            if margin >= 0.10 - 1e-9 && efg300 < 0.70 {
                let tally3 = bootstrap_batch(
                    &aln3000,
                    DistModel::Jc69,
                    Method::Nj,
                    boot_seed,
                    0,
                    100,
                )
                .unwrap();
                let st3 = support_on_tree(&nj3000, &tally3);
                let sup3 = supports(&st3, &labels);
                let efg3000 =
                    sup3.iter().find(|(k, _)| k == target).map(|(_, s)| *s);
                if let Some(e3) = efg3000 {
                    if e3 - efg300 >= 0.20 - 1e-9 {
                        println!(
                            "FOUND sim={sim_seed} boot={boot_seed} \
                             300: {target}={efg300:.2} next={ok}@{min_other:.2} \
                             margin={margin:.2}  3000: {e3:.2} rise={:.2}",
                            e3 - efg300
                        );
                        found = true;
                        break 'sim;
                    }
                }
                near.push((margin, sim_seed, boot_seed, efg300, min_other, f64::NAN, f64::NAN));
            } else if efg300 < others.iter().map(|(_, s)| *s).fold(f64::INFINITY, f64::min)
            {
                // EFGH uniquely weakest but margin < 10 — a candidate.
                near.push((margin, sim_seed, boot_seed, efg300, min_other, f64::NAN, f64::NAN));
            }
        }
    }

    near.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    for (m, s, b, e, o, _, _) in near.iter().take(8) {
        println!("candidate sim={s} boot={b} EFGH={e:.2} next={o:.2} margin={m:.2}");
    }
    assert!(found, "no seed pair met the margin premise within 200×200");
}

/// At the winning sim seed, list bootstrap seeds whose two weakest
/// groupings sit within 5 points — the tolerant-verdict e2e picks the
/// runner-up and must read "Correct".
#[test]
#[ignore = "scratch scan"]
fn close_pair_scan() {
    const SIM: u64 = 7;
    let truth = parse_newick(TRUE).expect("true tree parses");
    let labels = truth.leaf_labels();
    let opts = BuildOptions { trace: false };
    let aln = neophylo_core::simulate(
        &truth,
        &SimSpec {
            model: SimModel::Jc69,
            length: 300,
            seed: SIM,
        },
    )
    .unwrap();
    let nj = build_tree(&compute(&aln, DistModel::Jc69).unwrap(), Method::Nj, opts)
        .unwrap()
        .tree;
    let mut printed = 0;
    for reps in [10u32, 20, 25, 50, 100] {
        for boot_seed in 0u64..500 {
            let tally =
                bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, boot_seed, 0, reps)
                    .unwrap();
            let st = support_on_tree(&nj, &tally);
            let mut sup = supports(&st, &labels);
            sup.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
            if sup.len() < 2 {
                continue;
            }
            let d = sup[1].1 - sup[0].1;
            if d > 1e-9 && d <= 0.05 + 1e-9 && printed < 16 {
                println!(
                    "reps={reps} boot={boot_seed} weakest={}@{:.2} \
                     next={}@{:.2} diff={:.2} EFGH={:.2}",
                    sup[0].0,
                    sup[0].1,
                    sup[1].0,
                    sup[1].1,
                    d,
                    sup.iter()
                        .find(|(k, _)| k == "E|F|G|H")
                        .map(|(_, s)| *s)
                        .unwrap_or(f64::NAN)
                );
                printed += 1;
            }
        }
    }
}

/// EFGH support at sim 7 for a few candidate e2e seeds (100 reps).
#[test]
#[ignore = "scratch scan"]
fn e2e_seed_values() {
    let truth = parse_newick(TRUE).unwrap();
    let labels = truth.leaf_labels();
    let opts = BuildOptions { trace: false };
    let aln = neophylo_core::simulate(
        &truth,
        &SimSpec { model: SimModel::Jc69, length: 300, seed: 7 },
    )
    .unwrap();
    let nj =
        build_tree(&compute(&aln, DistModel::Jc69).unwrap(), Method::Nj, opts)
            .unwrap()
            .tree;
    for b in [1u64, 40, 97] {
        let t =
            bootstrap_batch(&aln, DistModel::Jc69, Method::Nj, b, 0, 100).unwrap();
        let st = support_on_tree(&nj, &t);
        let mut sup = supports(&st, &labels);
        sup.sort_by(|x, y| x.1.partial_cmp(&y.1).unwrap());
        println!(
            "boot={b} weakest={}@{:.2} EFGH={:.2}",
            sup[0].0,
            sup[0].1,
            sup.iter()
                .find(|(k, _)| k == "E|F|G|H")
                .map(|(_, s)| *s)
                .unwrap_or(f64::NAN)
        );
    }
}
