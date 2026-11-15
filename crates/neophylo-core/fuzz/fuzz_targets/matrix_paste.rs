#![no_main]

//! Feeds arbitrary UTF-8 to `parse_pasted_matrix` under every
//! combination of `PasteOptions` (v1.4c spec §5.1). The parser must
//! never panic; ambiguity must surface as `MatrixAmbiguous`, not a
//! guess. On success, `write_meg_matrix` output must re-parse to the
//! same matrix.

use libfuzzer_sys::fuzz_target;
use neophylo_core::matrix_parse::{parse_pasted_matrix, write_meg_matrix, PasteOptions};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        for bits in 0..8u8 {
            let opts = PasteOptions {
                first_column_names: if bits & 1 == 0 { None } else { Some(bits & 4 != 0) },
                header_row: if bits & 2 == 0 { None } else { Some(bits & 4 == 0) },
                decimal_comma: if bits & 4 == 0 { None } else { Some(bits & 1 != 0) },
            };
            if let Ok(file) = parse_pasted_matrix(text, opts) {
                if let Ok(out) = write_meg_matrix(&file.matrix, "fuzz") {
                    let back = neophylo_core::matrix_parse::parse_meg_matrix(&out)
                        .expect("write_meg_matrix output must re-parse");
                    // The .meg writer maps whitespace in names to '_',
                    // and pasted names may contain spaces.
                    let mapped: Vec<String> = file
                        .matrix
                        .names
                        .iter()
                        .map(|n| {
                            n.chars()
                                .map(|c| if c.is_whitespace() { '_' } else { c })
                                .collect()
                        })
                        .collect();
                    assert_eq!(back.matrix.names, mapped);
                    assert_eq!(back.matrix.lower, file.matrix.lower);
                }
            }
        }
    }
});
