#![no_main]

//! Feeds arbitrary UTF-8 to `parse_meg_matrix` (v1.4c spec §5.1). The
//! parser must never panic; every failure must surface as a
//! `NeoError`. On success, `write_meg_matrix` output must re-parse to
//! the same matrix.

use libfuzzer_sys::fuzz_target;
use neophylo_core::matrix_parse::{parse_meg_matrix, write_meg_matrix};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(file) = parse_meg_matrix(text) {
            let title = file.title.clone().unwrap_or_default();
            if let Ok(out) = write_meg_matrix(&file.matrix, &title) {
                let back = parse_meg_matrix(&out).expect("write_meg_matrix output must re-parse");
                assert_eq!(back.matrix, file.matrix);
            }
        }
    }
});
