#![cfg(target_arch = "wasm32")]

use wasm_bindgen_test::*;

#[wasm_bindgen_test]
fn wasm_loads() {
    assert_eq!(neophylo_core::VERSION, env!("CARGO_PKG_VERSION"));
}
