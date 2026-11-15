#![no_main]

//! Feeds arbitrary UTF-8 to `parse_phylip_matrix` under every
//! `NameMode` and both `use_lower_if_asymmetric` settings (v1.4c spec
//! §5.1). The parser must never panic; every failure must surface as a
//! `NeoError`. On success, `write_phylip_matrix` output must re-parse
//! to the same names and to values within the writer's printed
//! precision (0.5e-6).

use libfuzzer_sys::fuzz_target;
use neophylo_core::matrix_parse::{parse_phylip_matrix, PhylipMatrixOptions};
use neophylo_core::phylip::{write_phylip_matrix, NameMode};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        for mode in [NameMode::Strict, NameMode::Relaxed, NameMode::Auto] {
            for use_lower in [false, true] {
                let parsed = parse_phylip_matrix(
                    text,
                    PhylipMatrixOptions {
                        names: mode,
                        use_lower_if_asymmetric: use_lower,
                    },
                );
                if mode != NameMode::Auto || use_lower {
                    continue;
                }
                if let Ok(file) = parsed {
                    if let Ok(dm) = file.matrix.to_distance_matrix() {
                        if let Ok(out) = write_phylip_matrix(&dm, NameMode::Relaxed) {
                            let back = parse_phylip_matrix(
                                &out,
                                PhylipMatrixOptions {
                                    names: NameMode::Relaxed,
                                    use_lower_if_asymmetric: false,
                                },
                            )
                            .expect("write_phylip_matrix output must re-parse");
                            assert_eq!(back.matrix.names, file.matrix.names);
                            for (a, b) in
                                back.matrix.lower.iter().zip(&file.matrix.lower)
                            {
                                assert!((a - b).abs() <= 0.5e-6, "{a} vs {b}");
                            }
                        }
                    }
                }
            }
        }
    }
});
