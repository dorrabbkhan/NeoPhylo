//! Engine-computed answers and `check` verdicts for reading items
//! (v1.4d spec §4.3, §5.3, plan Task 4). Every expected value was
//! hand-checked against the trees in `reading_inputs/`.

use neophylo_core::reading::{
    answer, check, load_reading_set, Accepted, AnswerKey, Closer, ReadingSet, Response,
};
use neophylo_core::NeoError;

macro_rules! input {
    ($f:literal) => {
        include_str!(concat!("reading_inputs/", $f))
    };
}

fn set(f: &str) -> ReadingSet {
    match f {
        "rel" => load_reading_set(input!("valid-rel.json")).unwrap(),
        "traits" => load_reading_set(input!("valid-traits.json")).unwrap(),
        "times" => load_reading_set(input!("valid-times.json")).unwrap(),
        "pool" => load_reading_set(input!("valid-pool.json")).unwrap(),
        "poly" => load_reading_set(input!("valid-polytomy.json")).unwrap(),
        "gained" => load_reading_set(input!("valid-gained-order.json")).unwrap(),
        _ => unreachable!(),
    }
}

fn idx(set: &ReadingSet, item_id: &str) -> usize {
    set.items
        .iter()
        .position(|i| i.id == item_id)
        .unwrap_or_else(|| panic!("no item {item_id}"))
}

fn key(set: &ReadingSet, item_id: &str) -> AnswerKey {
    answer(set, idx(set, item_id)).unwrap()
}

fn accepted(set: &ReadingSet, item_id: &str) -> Accepted {
    key(set, item_id).accepted
}

fn verdict(set: &ReadingSet, item_id: &str, r: Response) -> bool {
    check(set, idx(set, item_id), &r).unwrap().correct
}

fn key2(tips: &[&str]) -> Vec<String> {
    let mut k: Vec<String> = tips.iter().map(|s| s.to_string()).collect();
    k.sort();
    k
}

// --- which_differs / which_fits -----------------------------------------

#[test]
fn which_differs_picks_outlier() {
    assert_eq!(
        accepted(&set("rel"), "q-differs"),
        Accepted::Choices(vec![2])
    );
}

#[test]
fn which_differs_all_same_across_styles() {
    // Review Focus 2: identical relationships drawn rectangular/right and
    // circular/up must answer "all show the same" — index trees.len().
    assert_eq!(accepted(&set("rel"), "q-same"), Accepted::Choices(vec![2]));
    assert!(verdict(
        &set("rel"),
        "q-same",
        Response::Choice { index: 2 }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-same",
        Response::Choice { index: 0 }
    ));
}

#[test]
fn which_differs_reference_variant() {
    // cand2 ((a,c),b) conflicts with ref ((a,b),(c,(d,e))); cand1 matches.
    assert_eq!(
        accepted(&set("rel"), "q-differs-ref"),
        Accepted::Choices(vec![1])
    );
}

#[test]
fn which_fits_picks_agreeing_tree() {
    assert_eq!(accepted(&set("rel"), "q-fits"), Accepted::Choices(vec![0]));
    assert!(verdict(
        &set("rel"),
        "q-fits",
        Response::Choice { index: 0 }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-fits",
        Response::Choice { index: 1 }
    ));
}

#[test]
fn which_differs_polytomy_vs_resolved() {
    // Review Focus 1: a polytomy never equals a resolved tree — the
    // polytomy is the unique differing tree, not "all show the same".
    assert_eq!(
        accepted(&set("poly"), "q-differs-poly"),
        Accepted::Choices(vec![0])
    );
    assert!(verdict(
        &set("poly"),
        "q-differs-poly",
        Response::Choice { index: 0 }
    ));
    assert!(!verdict(
        &set("poly"),
        "q-differs-poly",
        Response::Choice { index: 3 }
    ));
}

// --- mrca / place_taxon ---------------------------------------------------

#[test]
fn mrca_answer_is_clade() {
    assert_eq!(
        accepted(&set("rel"), "q-mrca"),
        Accepted::Clade(key2(&["a", "b"]))
    );
    assert!(verdict(
        &set("rel"),
        "q-mrca",
        Response::Node {
            clade: key2(&["a", "b"])
        }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-mrca",
        Response::Node {
            clade: key2(&["c", "d"])
        }
    ));
}

#[test]
fn mrca_in_polytomy() {
    // Review Focus 1: the MRCA of a and c under ((a,b,c),d) is the
    // polytomy node itself.
    assert_eq!(
        accepted(&set("poly"), "q-mrca-poly"),
        Accepted::Clade(key2(&["a", "b", "c"]))
    );
}

#[test]
fn mrca_with_point_options() {
    // X sits on the [b,c] node; Y is on the branch above it, W is higher.
    assert_eq!(
        accepted(&set("times"), "q-mrca-opts"),
        Accepted::Point("X".into())
    );
    assert!(verdict(
        &set("times"),
        "q-mrca-opts",
        Response::Point { letter: "X".into() }
    ));
    assert!(!verdict(
        &set("times"),
        "q-mrca-opts",
        Response::Point { letter: "Y".into() }
    ));
}

#[test]
fn place_taxon_finds_stem_branch() {
    assert_eq!(
        accepted(&set("times"), "q-place"),
        Accepted::Point("Y".into())
    );
    assert!(verdict(
        &set("times"),
        "q-place",
        Response::Point { letter: "Y".into() }
    ));
    assert!(!verdict(
        &set("times"),
        "q-place",
        Response::Point { letter: "X".into() }
    ));
}

// --- is_clade --------------------------------------------------------------

#[test]
fn is_clade_yes_and_no() {
    assert_eq!(
        accepted(&set("rel"), "q-clade-yes"),
        Accepted::Choices(vec![0])
    );
    assert_eq!(
        accepted(&set("rel"), "q-clade-no"),
        Accepted::Choices(vec![1])
    );
    assert!(verdict(
        &set("rel"),
        "q-clade-no",
        Response::Choice { index: 1 }
    ));
}

#[test]
fn mono_para_poly_by_trait() {
    // hair: group {bat,cat,dog} is exactly a clade → 0 (monophyletic).
    // fur: one gain, loss on cat → group {bat,dog} ⊂ clade → 1 (paraphyletic).
    // wings: two gains → {bat,fish} → 2 (polyphyletic).
    assert_eq!(
        accepted(&set("traits"), "q-tmono"),
        Accepted::Choices(vec![0])
    );
    assert_eq!(
        accepted(&set("traits"), "q-tpara"),
        Accepted::Choices(vec![1])
    );
    assert_eq!(
        accepted(&set("traits"), "q-tpoly"),
        Accepted::Choices(vec![2])
    );
}

// --- smallest_clade / closest_relative / count / order ---------------------

#[test]
fn smallest_clade_is_mrca_clade() {
    assert_eq!(
        accepted(&set("rel"), "q-smallest"),
        Accepted::Clade(key2(&["a", "b"]))
    );
    assert!(verdict(
        &set("rel"),
        "q-smallest",
        Response::Node {
            clade: key2(&["a", "b"])
        }
    ));
}

#[test]
fn closest_single_accepts_any_sister_tip() {
    assert_eq!(
        accepted(&set("rel"), "q-closest"),
        Accepted::AnyTipOf(key2(&["b"]))
    );
    // A single tip of the sister set is accepted.
    assert!(verdict(
        &set("rel"),
        "q-closest",
        Response::Tips {
            tips: vec!["b".into()]
        }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-closest",
        Response::Tips {
            tips: vec!["c".into()]
        }
    ));
}

#[test]
fn most_distant_is_outside_group() {
    assert_eq!(
        accepted(&set("rel"), "q-distant"),
        Accepted::AnyTipOf(key2(&["c", "d"]))
    );
    assert!(verdict(
        &set("rel"),
        "q-distant",
        Response::Tips {
            tips: key2(&["c", "d"])
        }
    ));
    assert!(verdict(
        &set("rel"),
        "q-distant",
        Response::Tips {
            tips: vec!["d".into()]
        }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-distant",
        Response::Tips {
            tips: vec!["b".into()]
        }
    ));
}

#[test]
fn pairwise_closer() {
    assert_eq!(
        accepted(&set("rel"), "q-pair"),
        Accepted::Pairwise(Closer::B)
    );
    assert!(verdict(
        &set("rel"),
        "q-pair",
        Response::Pairwise { answer: Closer::B }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-pair",
        Response::Pairwise { answer: Closer::C }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-pair",
        Response::Pairwise {
            answer: Closer::Equal
        }
    ));
}

#[test]
fn closest_pairwise_equal_in_polytomy() {
    // Review Focus 1: under ((a,b,c),d), a meets b and c at the same
    // polytomy node → "equally close".
    assert_eq!(
        accepted(&set("poly"), "q-pair-poly"),
        Accepted::Pairwise(Closer::Equal)
    );
    assert!(verdict(
        &set("poly"),
        "q-pair-poly",
        Response::Pairwise {
            answer: Closer::Equal
        }
    ));
    assert!(!verdict(
        &set("poly"),
        "q-pair-poly",
        Response::Pairwise { answer: Closer::B }
    ));
}

#[test]
fn count_clades_counts_internal_nodes() {
    assert_eq!(accepted(&set("rel"), "q-count"), Accepted::Number(3));
    assert!(verdict(
        &set("rel"),
        "q-count",
        Response::Number { value: 3 }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-count",
        Response::Number { value: 4 }
    ));
}

#[test]
fn order_nodes_ancestry_accepts_linear_extensions() {
    // R (the root) is ancestor of P and Q; P and Q are on different
    // lineages, so both orders after R are accepted (Review Focus 3).
    assert_eq!(
        accepted(&set("rel"), "q-order"),
        Accepted::Orders {
            rule: "ancestry".into()
        }
    );
    let s = set("rel");
    let ok = |l: &[&str]| {
        verdict(
            &s,
            "q-order",
            Response::Order {
                letters: l.iter().map(|x| x.to_string()).collect(),
            },
        )
    };
    assert!(ok(&["R", "P", "Q"]));
    assert!(ok(&["R", "Q", "P"]));
    assert!(!ok(&["P", "Q", "R"])); // root is oldest, must come first
    assert!(!ok(&["R", "P"])); // not a permutation of the item's nodes
}

#[test]
fn order_nodes_with_ages_unique() {
    // Ages: Q = 8, R = 6, P = 5 → exactly one order (Review Focus 3).
    assert_eq!(
        accepted(&set("times"), "q-order-t"),
        Accepted::Orders {
            rule: "ages".into()
        }
    );
    let s = set("times");
    let ok = |l: &[&str]| {
        verdict(
            &s,
            "q-order-t",
            Response::Order {
                letters: l.iter().map(|x| x.to_string()).collect(),
            },
        )
    };
    assert!(ok(&["Q", "R", "P"]));
    assert!(!ok(&["Q", "P", "R"]));
    assert!(!ok(&["R", "Q", "P"]));
}

#[test]
fn order_nodes_with_polytomy() {
    // Review Focus 1: without times, every order consistent with
    // ancestry is accepted — R (root) before P, never P before R.
    assert_eq!(
        accepted(&set("poly"), "q-order-poly"),
        Accepted::Orders {
            rule: "ancestry".into()
        }
    );
    let s = set("poly");
    let ok = |l: &[&str]| {
        verdict(
            &s,
            "q-order-poly",
            Response::Order {
                letters: l.iter().map(|x| x.to_string()).collect(),
            },
        )
    };
    assert!(ok(&["R", "P"]));
    assert!(!ok(&["P", "R"]));
}

// --- select_true ------------------------------------------------------------

#[test]
fn select_true_evaluates_relationship_statements() {
    assert_eq!(
        accepted(&set("rel"), "q-select"),
        Accepted::Statements(vec![true, true, true, true, false, false])
    );
    assert!(verdict(
        &set("rel"),
        "q-select",
        Response::Choices {
            indices: vec![0, 1, 2, 3]
        }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-select",
        Response::Choices {
            indices: vec![0, 1, 2]
        }
    ));
}

#[test]
fn select_true_evaluates_trait_statements() {
    assert_eq!(
        accepted(&set("traits"), "q-stmt"),
        Accepted::Statements(vec![true, false, true, false, true, false])
    );
}

#[test]
fn select_true_evaluates_time_statements() {
    assert_eq!(
        accepted(&set("times"), "q-stmt-t"),
        Accepted::Statements(vec![true, false, true, false, true, false])
    );
}

#[test]
fn gained_within_same_branch_outer_first_true() {
    // Both gains sit on the [a,b] branch; `outer` (hair) is listed
    // before `inner` (nails), so the lineage carried hair first.
    assert_eq!(
        accepted(&set("gained"), "q-outer-first"),
        Accepted::Statements(vec![true])
    );
}

#[test]
fn gained_within_same_branch_inner_first_false() {
    // Same branch, `inner` (nails) listed first: the lineage did not
    // yet carry hair when nails arose.
    assert_eq!(
        accepted(&set("gained"), "q-inner-first"),
        Accepted::Statements(vec![false])
    );
}

// --- trait asks ---------------------------------------------------------------

#[test]
fn trait_which_have_selects_derived_tips() {
    assert_eq!(
        accepted(&set("traits"), "q-who"),
        Accepted::TipSet(key2(&["bat", "cat", "dog"]))
    );
    assert!(verdict(
        &set("traits"),
        "q-who",
        Response::Tips {
            tips: vec!["bat".into(), "cat".into(), "dog".into()]
        }
    ));
    assert!(!verdict(
        &set("traits"),
        "q-who",
        Response::Tips {
            tips: vec!["bat".into(), "cat".into()]
        }
    ));
}

#[test]
fn trait_which_shared() {
    // Trait option order: authored traits first (hair, wings), then
    // mark-only names in mark order (fur, nails).
    assert_eq!(
        accepted(&set("traits"), "q-shared"),
        Accepted::Choices(vec![0])
    );
}

#[test]
fn trait_how_many_changes() {
    assert_eq!(accepted(&set("traits"), "q-changes"), Accepted::Number(2));
}

#[test]
fn trait_profile_lists_derived_states() {
    // cat: hair ✓, nails ✓; fur lost on its branch, wings absent.
    assert_eq!(
        accepted(&set("traits"), "q-profile"),
        Accepted::Choices(vec![0, 3])
    );
}

#[test]
fn trait_ancestral_or_derived() {
    assert_eq!(
        accepted(&set("traits"), "q-ancder"),
        Accepted::Choices(vec![0])
    );
    assert_eq!(
        accepted(&set("traits"), "q-ancder2"),
        Accepted::Choices(vec![1])
    );
}

#[test]
fn trait_has_not() {
    assert_eq!(
        accepted(&set("traits"), "q-hasnot"),
        Accepted::TipSet(key2(&["cat"]))
    );
}

#[test]
fn trait_homologous() {
    // wings: independent gains on bat and fish → index 1.
    // hair: one gain covers both → index 0.
    assert_eq!(
        accepted(&set("traits"), "q-homo"),
        Accepted::Choices(vec![1])
    );
    assert_eq!(
        accepted(&set("traits"), "q-homo2"),
        Accepted::Choices(vec![0])
    );
}

// --- concept / two_tier --------------------------------------------------------

#[test]
fn concept_is_authored() {
    let k = key(&set("rel"), "q-concept");
    assert_eq!(k.accepted, Accepted::Choices(vec![1]));
    assert!(k.authored);
    assert!(verdict(
        &set("rel"),
        "q-concept",
        Response::Choices { indices: vec![1] }
    ));
}

#[test]
fn two_tier_computes_first_and_authors_reason() {
    let k = key(&set("rel"), "q-two");
    assert!(k.authored);
    assert_eq!(
        k.accepted,
        Accepted::TwoTier {
            first: Box::new(Accepted::Clade(key2(&["a", "b"]))),
            reason: 0
        }
    );
    assert!(verdict(
        &set("rel"),
        "q-two",
        Response::TwoTier {
            first: Box::new(Response::Node {
                clade: key2(&["a", "b"])
            }),
            reason: 0
        }
    ));
    assert!(!verdict(
        &set("rel"),
        "q-two",
        Response::TwoTier {
            first: Box::new(Response::Node {
                clade: key2(&["a", "b"])
            }),
            reason: 1
        }
    ));
}

// --- explanations ---------------------------------------------------------------

#[test]
fn explanation_mrca_names_the_node() {
    assert_eq!(
        key(&set("rel"), "q-mrca").explanation,
        "the most recent common ancestor of a and b is node P."
    );
}

#[test]
fn explanation_count_clades() {
    assert_eq!(
        key(&set("rel"), "q-count").explanation,
        "the tree has 3 clades (internal nodes including the root)."
    );
}

#[test]
fn explanation_pairwise_mentions_both_nodes() {
    assert_eq!(
        key(&set("rel"), "q-pair").explanation,
        "a and b meet at node P; a and c meet at node R, which is older."
    );
}

// --- check() robustness ------------------------------------------------------------

#[test]
fn check_rejects_wrong_response_kind() {
    let s = set("rel");
    let r = check(&s, idx(&s, "q-mrca"), &Response::Number { value: 2 });
    match r {
        Err(NeoError::InvalidReading { item, field, .. }) => {
            assert_eq!(item, "q-mrca");
            assert_eq!(field, "response");
        }
        other => panic!("expected InvalidReading, got {other:?}"),
    }
}

#[test]
fn check_rejects_unknown_point_letter() {
    let s = set("times");
    let r = check(
        &s,
        idx(&s, "q-place"),
        &Response::Point { letter: "Z".into() },
    );
    match r {
        Err(NeoError::InvalidReading { item, field, .. }) => {
            assert_eq!(item, "q-place");
            assert_eq!(field, "response");
        }
        other => panic!("expected InvalidReading, got {other:?}"),
    }
}

#[test]
fn answer_out_of_range_item() {
    let s = set("rel");
    match answer(&s, 999) {
        Err(NeoError::InvalidReading { item, field, .. }) => {
            assert_eq!(item, "");
            assert_eq!(field, "item");
        }
        other => panic!("expected InvalidReading, got {other:?}"),
    }
}

#[test]
fn answer_and_check_on_unloaded_set_never_panic() {
    // `answer`/`check` are public and may see a ReadingSet that never
    // went through load_reading_set: items with no trees or an unknown
    // tree must come back as InvalidReading, never a panic.
    let set: ReadingSet = serde_json::from_str(
        r#"{
            "schema_version": 1, "kind": "reading", "id": "raw", "title": "t", "summary": "t",
            "trees": {},
            "items": [
                { "id": "q-empty", "text": "t", "trees": [], "question": { "type": "count_clades" } },
                { "id": "q-missing", "text": "t", "trees": ["nope"], "question": { "type": "count_clades" } }
            ]
        }"#,
    )
    .unwrap();
    for i in 0..set.items.len() {
        match answer(&set, i) {
            Err(NeoError::InvalidReading { field, .. }) => assert_eq!(field, "trees"),
            other => panic!("expected InvalidReading, got {other:?}"),
        }
        assert!(check(&set, i, &Response::Number { value: 1 }).is_err());
    }
}
