#![no_main]

//! Feeds arbitrary UTF-8 to `parse_phylip` under every `NameMode`. The
//! engine must never panic; every failure must surface as a `NeoError`.

use libfuzzer_sys::fuzz_target;
use neophylo_core::phylip::{parse_phylip, NameMode};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        for mode in [NameMode::Strict, NameMode::Relaxed, NameMode::Auto] {
            let _ = parse_phylip(text, mode);
        }
    }
});
