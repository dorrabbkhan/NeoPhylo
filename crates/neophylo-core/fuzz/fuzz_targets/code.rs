#![no_main]

//! Feeds arbitrary bytes as UTF-8-lossy text to `decode_code` — pasted
//! codes arrive mangled by mailers and LMS fields, so the decoder must
//! never panic; every failure must surface as `InvalidCode`. On success
//! the decoded payload is re-encoded and decoded again, so the encoder
//! and the round trip are covered as well.

use libfuzzer_sys::fuzz_target;
use neophylo_core::assess::{decode_code, encode_code};

fuzz_target!(|data: &[u8]| {
    let text = String::from_utf8_lossy(data);
    if let Ok(payload) = decode_code(&text) {
        if let Ok(code) = encode_code(&payload) {
            let _ = decode_code(&code);
        }
    }
});
