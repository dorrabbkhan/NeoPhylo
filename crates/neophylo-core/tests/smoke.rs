#[test]
fn workspace_builds() {
    assert_eq!(neophylo_core::VERSION, env!("CARGO_PKG_VERSION"));
}
