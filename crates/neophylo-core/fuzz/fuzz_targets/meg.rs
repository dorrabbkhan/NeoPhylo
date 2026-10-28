#![no_main]

//! Feeds arbitrary UTF-8 to `parse_meg` (v1.4b spec §3.4). The parser
//! must never panic; every failure must surface as a `NeoError`. When
//! parsing succeeds and `write_meg` accepts the alignment, the writer's
//! output must re-parse to the same sequences and to the labels the
//! writer emitted (whitespace maps to `_`; names otherwise literal).

use libfuzzer_sys::fuzz_target;
use neophylo_core::meg::{parse_meg, write_meg};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(meg) = parse_meg(text) {
            let title = meg.title.clone().unwrap_or_default();
            if let Ok(out) = write_meg(&meg.alignment, &title) {
                let back = parse_meg(&out).expect("write_meg output must re-parse");
                let expected_labels: Vec<String> = meg
                    .alignment
                    .labels
                    .iter()
                    .map(|l| {
                        l.chars()
                            .map(|c| if c.is_whitespace() { '_' } else { c })
                            .collect()
                    })
                    .collect();
                assert_eq!(back.alignment.labels, expected_labels);
                assert_eq!(back.alignment.seqs, meg.alignment.seqs);
                assert_eq!(back.alignment.alphabet, meg.alignment.alphabet);
            }
        }
    }
});
