#![no_main]

//! Feeds arbitrary UTF-8 to `load_reading_set`. When a set parses, the
//! target drives every item's `answer`, a `check` per response kind,
//! and all three seeded variant transforms — a structurally valid but
//! pathological set must still return `Ok` or `NeoError`, never panic
//! (v1.4d spec §5.5, plan Task 4).

use libfuzzer_sys::fuzz_target;
use neophylo_core::reading::{
    answer, check, load_reading_set, relabel, rotate, shuffle_tip_order, Response,
};

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Ok(set) = load_reading_set(text) else {
        return;
    };
    let responses = [
        Response::Choice { index: 0 },
        Response::Choices {
            indices: vec![0, 1],
        },
        Response::Node {
            clade: vec!["a".to_string()],
        },
        Response::Point {
            letter: "P".to_string(),
        },
        Response::Tips {
            tips: vec!["a".to_string()],
        },
        Response::Order {
            letters: vec!["P".to_string()],
        },
        Response::Number { value: 1 },
        Response::Pairwise {
            answer: neophylo_core::reading::Closer::Equal,
        },
    ];
    for i in 0..set.items.len() {
        let _ = answer(&set, i);
        for r in &responses {
            let _ = check(&set, i, r);
        }
    }
    let rotated = rotate(&set, 0x5EED);
    let shuffled = shuffle_tip_order(&set, 0x5EED);
    if let Ok(relabelled) = relabel(&set, 0x5EED) {
        for i in 0..relabelled.items.len() {
            let _ = answer(&relabelled, i);
        }
    }
    for i in 0..rotated.items.len() {
        let _ = answer(&rotated, i);
        let _ = answer(&shuffled, i);
    }
});
