#![no_main]

//! Feeds arbitrary UTF-8 to `parse_newick`. On success the parsed tree is
//! serialised again, so `write_newick` is covered as well. The engine must
//! never panic; every failure must surface as a `NeoError`.

use libfuzzer_sys::fuzz_target;
use neophylo_core::{parse_newick, write_newick};

fuzz_target!(|data: &[u8]| {
    if let Ok(text) = std::str::from_utf8(data) {
        if let Ok(tree) = parse_newick(text) {
            let _ = write_newick(&tree);
        }
    }
});
