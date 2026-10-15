#![no_main]

//! Feeds arbitrary UTF-8 to `parse_fasta`. The engine must never panic;
//! every failure must surface as a `NeoError`.

use libfuzzer_sys::fuzz_target;
use neophylo_core::parse_fasta;

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = parse_fasta(text);
    }
});
