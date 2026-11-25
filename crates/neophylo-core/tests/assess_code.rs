//! Completion codes (v1.5 spec §5.4, plan Task 5): the bit layout,
//! Crockford base32 text and CRC-16, the error reasons, the limits
//! (`MAX_ID_BYTES`, numeric range, attempts clamp), `pack_answer` /
//! `unpack_answer` index form, `name_table`, `fingerprint` and
//! `max_code_len`.

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::code::crc16;
use neophylo_core::assess::{
    decode_code, encode_code, fingerprint, grade, max_code_len, name_table, pack_answer, task_key,
    unpack_answer, AcceptedAnswer, Assignment, Attempt, CodePayload, Content, IdPrompt, IdRule,
    Mode, PackedAnswer, Rule, TaskAnswer, TaskRef, Variant, GENERATOR_VERSION, MAX_ID_BYTES,
};
use neophylo_core::assess::{PairRole, Quantity};
use neophylo_core::exercise::{load_exercise, Exercise};
use neophylo_core::reading::load_reading_set;
use neophylo_core::reading::{Closer, Response};
use neophylo_core::NeoError;

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn lesson(id: &str) -> Exercise {
    let text = fs::read_to_string(exercises_dir().join(format!("{id}.json"))).unwrap();
    load_exercise(&text).unwrap()
}

fn demo_variant() -> Variant {
    let text = fs::read_to_string(exercises_dir().join("reading/trees-demo.json")).unwrap();
    Variant {
        content: Content::Reading(load_reading_set(&text).unwrap()),
        seed: 1,
        retry: 0,
        fell_back: false,
    }
}

fn lesson_variant(id: &str) -> Variant {
    Variant {
        content: Content::Exercise(lesson(id)),
        seed: 1,
        retry: 0,
        fell_back: false,
    }
}

fn payload(attempts: Vec<Attempt>) -> CodePayload {
    CodePayload {
        format: 1,
        generator: GENERATOR_VERSION,
        fingerprint: 0x12345,
        student_id: "ada".to_string(),
        retry: 3,
        names: 8,
        attempts,
        finished_min: 123_456,
    }
}

fn attempt(first: PackedAnswer) -> Attempt {
    Attempt {
        first,
        last: None,
        attempts: 1,
    }
}

fn reason(r: Result<CodePayload, NeoError>) -> String {
    match r {
        Err(NeoError::InvalidCode { reason }) => reason,
        other => panic!("expected InvalidCode, got {other:?}"),
    }
}

// --- text and checksum ------------------------------------------------------------

#[test]
fn crc16_ccitt_false_known_answer() {
    assert_eq!(crc16(b"123456789"), 0x29B1);
    assert_eq!(crc16(b""), 0xFFFF);
}

#[test]
fn encode_decode_round_trip() {
    let p = payload(vec![
        attempt(PackedAnswer::Pair(0, 5)),
        Attempt {
            first: PackedAnswer::Numeric(-4096),
            last: Some(PackedAnswer::Numeric(4096)),
            attempts: 15,
        },
        attempt(PackedAnswer::Skipped),
        Attempt {
            first: PackedAnswer::TwoTier {
                first: Box::new(PackedAnswer::Tips(vec![0, 3, 7])),
                reason: 2,
            },
            last: None,
            attempts: 9,
        },
    ]);
    let code = encode_code(&p).unwrap();
    assert!(code.starts_with("NP1-"));
    assert_eq!(decode_code(&code).unwrap(), p);
}

#[test]
fn a_fixed_payload_encodes_to_a_fixed_code() {
    // Pins the bit layout, base32 grouping and CRC — a code written by
    // any other build must decode identically.
    let p = CodePayload {
        format: 1,
        generator: 1,
        fingerprint: 0x0A5A5,
        student_id: "s-001".to_string(),
        retry: 0,
        names: 8,
        attempts: vec![Attempt {
            first: PackedAnswer::Pair(2, 7),
            last: None,
            attempts: 1,
        }],
        finished_min: 1000,
    };
    let code = encode_code(&p).unwrap();
    assert_eq!(decode_code(&code).unwrap(), p);
    assert_eq!(code, "NP1-208AB-98AWS-D60R3-20220-NR800-FM39H-0");
}

#[test]
fn decoding_is_lenient_about_case_and_separators() {
    let p = payload(vec![attempt(PackedAnswer::Number(42))]);
    let code = encode_code(&p).unwrap();
    let lower = code.to_lowercase();
    assert_eq!(decode_code(&lower).unwrap(), p, "lower case decodes");
    let spaced = code.replace('-', " ");
    assert_eq!(decode_code(&spaced).unwrap(), p, "spaces are ignored");
    let with_breaks = format!("{}\n\t{}", &code[..8], &code[8..]);
    assert_eq!(decode_code(&with_breaks).unwrap(), p);
    let embedded = format!("submit: {code} (thanks)");
    // Trailing text is not a separator — a stray ')' is a bad symbol.
    assert_eq!(reason(decode_code(&embedded)), "malformed");
    let prefixed = format!("submit {code}");
    assert_eq!(
        decode_code(&prefixed).unwrap(),
        p,
        "the prefix is found in text"
    );
}

#[test]
fn ambiguous_symbols_decode_as_digits() {
    // o → 0, i/l → 1 — the encoder never emits I, L, O or U.
    let p = payload(vec![attempt(PackedAnswer::Choice(1))]);
    let code = encode_code(&p).unwrap();
    let swapped: String = code
        .chars()
        .enumerate()
        .map(|(i, c)| match c {
            '0' if i > 3 => 'o',
            '1' if i > 3 => 'i',
            other => other,
        })
        .collect();
    assert_eq!(decode_code(&swapped).unwrap(), p);
    let swapped_l = format!("NP1-{}", code[4..].replace('1', "l"));
    assert_eq!(decode_code(&swapped_l).unwrap(), p);
}

// --- the error reasons --------------------------------------------------------------

#[test]
fn decode_reports_the_spec_reasons() {
    let p = payload(vec![attempt(PackedAnswer::Pair(1, 2))]);
    let code = encode_code(&p).unwrap();
    // No NP1 at all.
    assert_eq!(reason(decode_code("hello world")), "prefix");
    assert_eq!(reason(decode_code("NP2-AAAAA")), "prefix");
    // A bad symbol (u is outside the alphabet; '!' too).
    assert_eq!(reason(decode_code(&format!("{code}u"))), "malformed");
    assert_eq!(reason(decode_code("NP1-!!!")), "malformed");
    // Wrong symbol count: a single symbol carries < 3 bytes, and 3
    // symbols leave a padding width that can't be byte-aligned.
    assert_eq!(reason(decode_code("NP1-A")), "length");
    assert_eq!(reason(decode_code("NP1-ABC")), "length");
    // Nonzero padding: this multi-task code pads its last symbol by
    // 4 bits — setting a low pad bit reads "length".
    let padded = encode_code(&payload(vec![
        attempt(PackedAnswer::Pair(0, 5)),
        Attempt {
            first: PackedAnswer::Numeric(-4),
            last: Some(PackedAnswer::Numeric(4)),
            attempts: 2,
        },
    ]))
    .unwrap();
    let alpha = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut chars: Vec<char> = padded.chars().collect();
    let last = chars.len() - 1;
    let v = alpha.iter().position(|&x| x == chars[last] as u8).unwrap();
    chars[last] = alpha[v | 1] as char;
    let flipped: String = chars.into_iter().collect();
    assert_eq!(reason(decode_code(&flipped)), "length");
    // Corrupt a payload symbol, keeping the count valid.
    let mut chars: Vec<char> = code.chars().collect();
    let mid = code.len() / 2;
    if chars[mid] != '-' {
        chars[mid] = if chars[mid] == '0' { '1' } else { '0' };
        let broken: String = chars.into_iter().collect();
        assert_eq!(reason(decode_code(&broken)), "checksum");
    }
}

/// A hand-built wire for cases `encode_code` refuses (bad id_len,
/// nested two-tier): `fields` are (value, width) pairs, the payload
/// pads to a byte, CRC-16 is appended, then base32 symbols.
fn wire(fields: &[(u64, usize)]) -> String {
    let mut bits: Vec<bool> = Vec::new();
    for &(v, n) in fields {
        for i in (0..n).rev() {
            // A field may exceed u64 for zero-padding runs.
            bits.push(i < 64 && (v >> i) & 1 == 1);
        }
    }
    while !bits.len().is_multiple_of(8) {
        bits.push(false);
    }
    let mut bytes = vec![0u8; bits.len().div_ceil(8)];
    for (i, &b) in bits.iter().enumerate() {
        if b {
            bytes[i / 8] |= 0x80 >> (i % 8);
        }
    }
    let crc = crc16(&bytes);
    for i in (0..16).rev() {
        bits.push((u64::from(crc) >> i) & 1 == 1);
    }
    while !bits.len().is_multiple_of(5) {
        bits.push(false);
    }
    let alpha = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    let mut text = String::from("NP1-");
    for (i, chunk) in bits.chunks(5).enumerate() {
        if i > 0 && i % 5 == 0 {
            text.push('-');
        }
        let v = chunk.iter().fold(0u8, |v, &b| (v << 1) | u8::from(b));
        text.push(alpha[v as usize] as char);
    }
    text
}

/// The shared head of a minimal valid wire: format, generator,
/// fingerprint, a one-byte id `'a'`, retry 0.
const HEAD: &[(u64, usize)] = &[
    (1, 4),
    (GENERATOR_VERSION as u64, 8),
    (0, 20),
    (1, 7),
    (b'a' as u64, 8),
    (0, 6),
];

#[test]
fn decode_rejects_unknown_versions() {
    // Same layout, format/generator fields nudged — the checksum is
    // over the payload, so craft the wire directly.
    let version_wire = |format: u64, generator: u64| {
        let mut f: Vec<(u64, usize)> = vec![(format, 4), (generator, 8)];
        f.extend_from_slice(&HEAD[2..]);
        f.extend_from_slice(&[
            (1, 4),  // one task
            (8, 8),  // names
            (0, 4),  // skipped tag
            (0, 1),  // has_last
            (1, 4),  // attempts
            (0, 24), // finished_min
        ]);
        wire(&f)
    };
    assert_eq!(reason(decode_code(&version_wire(2, 1))), "version");
    assert_eq!(reason(decode_code(&version_wire(1, 9))), "version");
    assert_eq!(reason(decode_code(&version_wire(0, 1))), "version");
    assert!(
        decode_code(&version_wire(1, u64::from(GENERATOR_VERSION))).is_ok(),
        "a format-1 wire decodes"
    );
}

#[test]
fn decode_refuses_impossible_id_lengths() {
    // A hand-built payload (valid CRC) whose id_len is 0 or above
    // MAX_ID_BYTES — a code no real finish flow could emit.
    let with_id_len = |id_len: u64| {
        let mut f: Vec<(u64, usize)> = vec![(1, 4), (GENERATOR_VERSION as u64, 8), (0, 20)];
        f.extend_from_slice(&[(id_len, 7), (0, 64)]);
        wire(&f)
    };
    assert_eq!(reason(decode_code(&with_id_len(0))), "length");
    assert_eq!(
        reason(decode_code(&with_id_len(MAX_ID_BYTES as u64 + 1))),
        "length"
    );
    // The cap itself still parses the length, then fails on the
    // missing id bytes — also "length", but further in.
    assert_eq!(
        reason(decode_code(&with_id_len(MAX_ID_BYTES as u64))),
        "length"
    );
}

#[test]
fn a_nested_two_tier_answer_is_malformed() {
    // A TwoTier whose inner answer is itself TwoTier (or Skipped) can
    // never come from validated content — the decoder refuses at the
    // inner tag instead of recursing (the unbounded recursion it
    // replaces could overflow a wasm-sized stack). Run on a 256 KiB
    // stack, smaller than the wasm one.
    let nested = |levels: usize, inner: u64| {
        let mut f = HEAD.to_vec();
        f.extend_from_slice(&[(1, 4), (8, 8), (9, 4)]);
        for _ in 0..levels {
            f.push((9, 4));
        }
        f.extend_from_slice(&[(inner, 4), (0, 80)]);
        wire(&f)
    };
    let deep = nested(400, 5);
    let two = nested(1, 5);
    let skip = nested(0, 0);
    let out = std::thread::Builder::new()
        .stack_size(256 * 1024)
        .spawn(move || {
            (
                reason(decode_code(&deep)),
                reason(decode_code(&two)),
                reason(decode_code(&skip)),
            )
        })
        .unwrap()
        .join()
        .unwrap();
    assert_eq!(out.0, "malformed", "400 nested two-tier tags");
    assert_eq!(out.1, "malformed", "a two-tier inner two-tier");
    assert_eq!(out.2, "malformed", "a two-tier inner skipped");
}

// --- limits --------------------------------------------------------------------------

#[test]
fn encode_refuses_an_overlong_id() {
    let long = "x".repeat(MAX_ID_BYTES + 1);
    let p = CodePayload {
        student_id: long,
        ..payload(vec![attempt(PackedAnswer::Skipped)])
    };
    match encode_code(&p) {
        Err(NeoError::InvalidCode { reason }) => assert_eq!(reason, "length"),
        other => panic!("expected length, got {other:?}"),
    }
    let at_cap = CodePayload {
        student_id: "x".repeat(MAX_ID_BYTES),
        ..payload(vec![attempt(PackedAnswer::Skipped)])
    };
    assert!(encode_code(&at_cap).is_ok());
}

#[test]
fn encode_clamps_attempts_and_normalises_last() {
    let p = payload(vec![Attempt {
        first: PackedAnswer::Pair(1, 2),
        last: Some(PackedAnswer::Pair(1, 2)), // == first → dropped
        attempts: 200,
    }]);
    let out = decode_code(&encode_code(&p).unwrap()).unwrap();
    assert_eq!(out.attempts[0].attempts, 15, "clamped to the 4-bit cap");
    assert_eq!(out.attempts[0].last, None);
}

#[test]
fn encode_refuses_noncanonical_attempts() {
    // last of a different kind than first.
    let p = payload(vec![Attempt {
        first: PackedAnswer::Pair(1, 2),
        last: Some(PackedAnswer::Number(3)),
        attempts: 1,
    }]);
    assert_eq!(
        match encode_code(&p) {
            Err(NeoError::InvalidCode { reason }) => reason,
            other => panic!("{other:?}"),
        },
        "malformed"
    );
    // Numeric outside the scaled range (|n| > 2^31 − 1 → i32::MIN).
    let p = payload(vec![attempt(PackedAnswer::Numeric(i32::MIN))]);
    assert_eq!(
        match encode_code(&p) {
            Err(NeoError::InvalidCode { reason }) => reason,
            other => panic!("{other:?}"),
        },
        "malformed"
    );
    // A packed index past the declared name table (names = 8).
    let p = payload(vec![attempt(PackedAnswer::Tips(vec![0, 70]))]);
    assert_eq!(
        match encode_code(&p) {
            Err(NeoError::InvalidCode { reason }) => reason,
            other => panic!("{other:?}"),
        },
        "malformed"
    );
}

/// A minimal reading set whose `n` items are all single-choice
/// (`is_clade`) — the smallest kind a task can carry.
fn mini_choice_set(n: usize) -> Content {
    let items: String = (0..n)
        .map(|i| {
            format!(
                r#"{{"id":"q{i}","text":"t","trees":["t"],"tips":["a","b"],
                 "question":{{"type":"is_clade"}}}}"#
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let json = format!(
        r#"{{"schema_version":1,"kind":"reading","id":"mini","title":"m",
          "summary":"s","trees":{{"t":{{"newick":"((a,b),(c,d));"}}}},"items":[{items}]}}"#
    );
    Content::Reading(load_reading_set(&json).unwrap())
}

#[test]
fn a_15_task_code_stays_under_250_chars() {
    // Fifteen small tasks (reading single-choice) with a 64-byte id —
    // the plan's budget check (spec §5.4).
    let p = CodePayload {
        student_id: "x".repeat(MAX_ID_BYTES),
        attempts: (0..15).map(|_| attempt(PackedAnswer::Choice(7))).collect(),
        ..payload(vec![])
    };
    let code = encode_code(&p).unwrap();
    assert!(
        code.len() <= 250,
        "a 15-task code is {} chars, budget is 250",
        code.len()
    );
    // … and the assignment bound agrees.
    let a = assignment(
        mini_choice_set(15),
        (0..15)
            .map(|item| neophylo_core::assess::GradedTask {
                task: TaskRef::Reading { item },
                points: 1.0,
            })
            .collect(),
    );
    assert!(max_code_len(&a) <= 250, "bound {}", max_code_len(&a));
}

// --- the name table --------------------------------------------------------------------

#[test]
fn name_table_orders_exercise_and_reading_tips() {
    // An exercise's table is its distance-matrix label order.
    let ex = lesson("upgma-vs-nj-matrix");
    let neophylo_core::exercise::ExerciseData::Matrix { names, .. } = &ex.data else {
        panic!("matrix exercise")
    };
    let want = names.clone();
    let v = Variant {
        content: Content::Exercise(ex),
        seed: 1,
        retry: 0,
        fell_back: false,
    };
    assert_eq!(name_table(&v).unwrap(), want, "matrix label order");
    // A reading set's table is the sorted union of all its trees.
    let v = demo_variant();
    let table = name_table(&v).unwrap();
    let mut sorted = table.clone();
    sorted.sort();
    sorted.dedup();
    assert_eq!(table, sorted, "sorted, unique");
    assert!(table.contains(&"human".to_string()));
    assert!(table.contains(&"bat".to_string()));
    assert!(table.contains(&"Watson's leaf-nosed bat".to_string()));
}

// --- pack / unpack ------------------------------------------------------------------------

#[test]
fn pack_unpack_round_trip_exercise_answers() {
    let v = lesson_variant("nj-basics");
    let table = name_table(&v).unwrap();
    let pair = pack_answer(
        &v,
        &TaskRef::PredictPair { step: 1 },
        &TaskAnswer::Pair(2, 0),
    )
    .unwrap();
    assert_eq!(pair, PackedAnswer::Pair(0, 2), "canonical a<b");
    assert_eq!(
        unpack_answer(&v, &TaskRef::PredictPair { step: 1 }, &pair).unwrap(),
        TaskAnswer::Pair(0, 2)
    );
    let clade: Vec<String> = table[..2].to_vec();
    let packed = pack_answer(
        &v,
        &TaskRef::PredictBranch,
        &TaskAnswer::Branch(clade.clone()),
    )
    .unwrap();
    assert!(matches!(packed, PackedAnswer::Tips(_)));
    let mut back = match unpack_answer(&v, &TaskRef::PredictBranch, &packed).unwrap() {
        TaskAnswer::Branch(c) => c,
        other => panic!("{other:?}"),
    };
    back.sort();
    let mut want = clade;
    want.sort();
    assert_eq!(back, want);
    let n = pack_answer(
        &v,
        &TaskRef::Numeric {
            step: 1,
            quantity: Quantity::CorrectedDistance,
            role: PairRole::Chosen,
        },
        &TaskAnswer::Number(-2_000_000_000),
    )
    .unwrap();
    assert_eq!(n, PackedAnswer::Numeric(-2_000_000_000));
    // A scaled answer past the code's range refuses.
    assert!(pack_answer(
        &v,
        &TaskRef::Numeric {
            step: 1,
            quantity: Quantity::CorrectedDistance,
            role: PairRole::Chosen,
        },
        &TaskAnswer::Number(3_000_000_000),
    )
    .is_err());
    // A wrong kind refuses.
    assert!(pack_answer(
        &v,
        &TaskRef::PredictPair { step: 1 },
        &TaskAnswer::Branch(vec!["x".to_string()]),
    )
    .is_err());
}

#[test]
fn pack_unpack_round_trip_reading_answers() {
    let v = demo_variant();
    // Tips must come from the item's own tree — the name table is the
    // union over all trees.
    let item_tips = |item: usize| -> Vec<String> {
        let Content::Reading(set) = &v.content else {
            panic!()
        };
        let it = &set.items[item];
        let rt = &set.trees[&it.trees[0]];
        let tree = neophylo_core::newick::parse_newick(&rt.newick).unwrap();
        tree.leaf_labels()
    };
    let mammals = item_tips(3);
    let traits = item_tips(14);
    let relatives = item_tips(8);
    let round = |item: usize, r: Response| {
        let task = TaskRef::Reading { item };
        let packed = pack_answer(&v, &task, &TaskAnswer::Reading(r.clone()))
            .unwrap_or_else(|e| panic!("pack item {item}: {e}"));
        let back =
            unpack_answer(&v, &task, &packed).unwrap_or_else(|e| panic!("unpack item {item}: {e}"));
        let TaskAnswer::Reading(back) = back else {
            panic!("item {item}: not a reading answer")
        };
        (packed, back)
    };
    // Node answers (mrca, smallest_clade) pack as tip indices and
    // come back as Node.
    let (p, back) = round(
        3,
        Response::Node {
            clade: mammals[..2].to_vec(),
        },
    );
    assert!(matches!(p, PackedAnswer::Tips(_)));
    assert!(matches!(back, Response::Node { .. }));
    let (_, back) = round(4, Response::Point { letter: "W".into() });
    assert_eq!(back, Response::Point { letter: "W".into() });
    let (p, back) = round(6, Response::Choice { index: 1 });
    assert_eq!(p, PackedAnswer::Choice(1));
    assert_eq!(back, Response::Choice { index: 1 });
    let (_, back) = round(
        7,
        Response::Node {
            clade: mammals[4..6].to_vec(),
        },
    );
    assert!(matches!(back, Response::Node { .. }));
    let (p, back) = round(10, Response::Pairwise { answer: Closer::C });
    assert_eq!(p, PackedAnswer::Pairwise(1));
    assert_eq!(back, Response::Pairwise { answer: Closer::C });
    let (p, back) = round(11, Response::Number { value: 4 });
    assert_eq!(p, PackedAnswer::Number(4));
    assert_eq!(back, Response::Number { value: 4 });
    let (p, back) = round(
        12,
        Response::Order {
            letters: vec!["Q".into(), "P".into(), "R".into()],
        },
    );
    assert!(matches!(p, PackedAnswer::Order(_)));
    assert_eq!(
        back,
        Response::Order {
            letters: vec!["Q".into(), "P".into(), "R".into()]
        }
    );
    let (_, back) = round(
        13,
        Response::Choices {
            indices: vec![2, 0],
        },
    );
    assert_eq!(
        back,
        Response::Choices {
            indices: vec![0, 2]
        },
        "choices come back sorted"
    );
    let (_, back) = round(
        14,
        Response::Tips {
            tips: traits[..2].to_vec(),
        },
    );
    let Response::Tips { tips } = back else {
        panic!()
    };
    let mut tips = tips;
    tips.sort();
    let mut want = traits[..2].to_vec();
    want.sort();
    assert_eq!(tips, want);
    let (_, back) = round(20, Response::Choice { index: 0 });
    assert_eq!(back, Response::Choice { index: 0 });
    let (_, back) = round(
        23,
        Response::TwoTier {
            first: Box::new(Response::Choice { index: 1 }),
            reason: 0,
        },
    );
    assert_eq!(
        back,
        Response::TwoTier {
            first: Box::new(Response::Choice { index: 1 }),
            reason: 0
        }
    );
    // The closest_relative select-all form packs tips.
    let (p, _) = round(
        8,
        Response::Tips {
            tips: relatives[..1].to_vec(),
        },
    );
    assert!(matches!(p, PackedAnswer::Tips(_)));
    // A mismatched kind refuses to pack.
    assert!(pack_answer(
        &v,
        &TaskRef::Reading { item: 6 },
        &TaskAnswer::Reading(Response::Number { value: 1 }),
    )
    .is_err());
    // An unknown tip refuses to pack.
    assert!(pack_answer(
        &v,
        &TaskRef::Reading { item: 14 },
        &TaskAnswer::Reading(Response::Tips {
            tips: vec!["no-such-tip".to_string()],
        }),
    )
    .is_err());
}

#[test]
fn unpack_of_a_skipped_or_mismatched_answer_errors() {
    let v = demo_variant();
    assert!(unpack_answer(&v, &TaskRef::Reading { item: 6 }, &PackedAnswer::Skipped).is_err());
    // A tip index past the reading name table.
    assert!(unpack_answer(
        &v,
        &TaskRef::Reading { item: 14 },
        &PackedAnswer::Tips(vec![200]),
    )
    .is_err());
    // An order answer without an order_nodes item.
    assert!(unpack_answer(
        &v,
        &TaskRef::Reading { item: 6 },
        &PackedAnswer::Order(vec![0]),
    )
    .is_err());
}

// --- fingerprint & bounds ------------------------------------------------------------------

fn assignment(content: Content, tasks: Vec<neophylo_core::assess::GradedTask>) -> Assignment {
    Assignment {
        id: "asst-1".to_string(),
        title: "t".to_string(),
        instructions: None,
        content,
        content_hash: None,
        served_content_hash: None,
        id_prompt: IdPrompt {
            label: "Student ID".to_string(),
            rule: IdRule::TrimLower,
        },
        mode: Mode::Practice,
        variation: true,
        tasks,
    }
}

#[test]
fn fingerprint_is_20_bits_and_tracks_the_assignment() {
    let a = assignment(
        Content::Exercise(lesson("nj-basics")),
        vec![neophylo_core::assess::GradedTask {
            task: TaskRef::PredictPair { step: 1 },
            points: 1.0,
        }],
    );
    let fp = fingerprint(&a);
    assert!(fp <= 0x000F_FFFF);
    // The same assignment fingerprints identically …
    assert_eq!(fingerprint(&a), fp);
    // … and a different one differs (within the 20-bit space).
    let mut b = a.clone();
    b.title = "u".to_string();
    assert_ne!(fingerprint(&b), fp);
    // A recorded content hash covers it instead of the content: the
    // fingerprint no longer tracks content edits.
    let mut c = a.clone();
    c.content_hash = Some("0123456789abcdef".to_string());
    let fp_hash = fingerprint(&c);
    let mut d = c.clone();
    if let Content::Exercise(ex) = &mut d.content {
        ex.title = "edited".to_string();
    }
    assert_eq!(fingerprint(&d), fp_hash, "hash mode ignores content edits");
}

#[test]
fn max_code_len_bounds_real_codes() {
    // The tightness property test lives in assess_code_props.rs; here:
    // the reported numbers the PR body quotes.
    let graded = |task| neophylo_core::assess::GradedTask { task, points: 1.0 };
    // 15 predict_pair on nj-by-hand (5 taxa) — item 1(a): the content-
    // sized tip index (3 bits here) keeps 15 pair tasks inside 250.
    let a = assignment(
        Content::Exercise(lesson("nj-by-hand")),
        (1..=15u32)
            .map(|step| graded(TaskRef::PredictPair { step }))
            .collect(),
    );
    let pair_len = max_code_len(&a);
    assert!(
        pair_len <= 250,
        "15 pair tasks on a 5-taxon table fit 250: {pair_len}"
    );
    // … and a worst payload encodes within it.
    let worst = CodePayload {
        student_id: "x".repeat(MAX_ID_BYTES),
        names: 5,
        attempts: (0..15)
            .map(|_| Attempt {
                first: PackedAnswer::Pair(0, 1),
                last: Some(PackedAnswer::Pair(3, 4)),
                attempts: 15,
            })
            .collect(),
        ..payload(vec![])
    };
    let code = encode_code(&worst).unwrap();
    assert!(
        pair_len - code.len() <= 6,
        "worst-case code {} vs bound {pair_len}",
        code.len()
    );
    // 15 numeric tasks.
    let a_num = assignment(
        Content::Exercise(lesson("nj-basics")),
        (1..=15u32)
            .map(|step| {
                graded(TaskRef::Numeric {
                    step,
                    quantity: Quantity::CorrectedDistance,
                    role: PairRole::Chosen,
                })
            })
            .collect(),
    );
    let num_len = max_code_len(&a_num);
    // 15 single-choice reading tasks — small kinds fit the budget.
    let a_read = assignment(
        mini_choice_set(15),
        (0..15)
            .map(|item| graded(TaskRef::Reading { item }))
            .collect(),
    );
    let read_len = max_code_len(&a_read);
    assert!(read_len <= 250, "small tasks fit the budget: {read_len}");
    // 15 pair tasks on a 27-taxon lab — may exceed 250; the number is
    // reported, the builder refuses what doesn't fit.
    let a_lab = assignment(
        Content::Exercise(lesson("labs/mega-bootstrap-100")),
        (1..=15u32)
            .map(|step| graded(TaskRef::PredictPair { step }))
            .collect(),
    );
    let lab_len = max_code_len(&a_lab);
    eprintln!(
        "max_code_len: 15×predict_pair(nj-by-hand,N=5)={pair_len} 15×numeric={num_len} 15×choice={read_len} 15×predict_pair(27-taxa lab)={lab_len}"
    );
}

/// Member sets of every internal clade of a balanced binary tree
/// over `idx` except the root — the splits a block alignment pins at
/// ~1.0 support (cherries are in-scope for NJ: split.rs counts k ≥ 2).
fn balanced_clades(idx: &[usize]) -> Vec<std::collections::BTreeSet<usize>> {
    fn go(idx: &[usize], top: bool, out: &mut Vec<std::collections::BTreeSet<usize>>) {
        if idx.len() <= 1 {
            return;
        }
        let mid = idx.len() / 2;
        go(&idx[..mid], false, out);
        go(&idx[mid..], false, out);
        if !top {
            out.push(idx.iter().copied().collect());
        }
    }
    let mut out = Vec::new();
    go(idx, true, &mut out);
    out
}

#[test]
fn a_100_taxon_branch_answer_packs_encodes_decodes_and_grades() {
    // Item 1(b): a tip set over a >64-taxon table must encode at all —
    // the old fixed 64-bit mask could not carry it, so a student could
    // never finish a big editor exercise. An embedded 100-taxon
    // alignment where every internal branch of a balanced tree is
    // pinned by 40 consistent two-state columns — except the BIG|SMALL
    // split, which a single column leaves near 0.75 support: the
    // unique weakest branch. Its canonical side is the 70 names not
    // containing taxon 0 (splits canonicalize to the side without
    // index 0, bootstrap/split.rs).
    let names: Vec<String> = (1..=100).map(|i| format!("t{i:03}")).collect();
    let (small, big): (Vec<usize>, Vec<usize>) = ((0..30).collect(), (30..100).collect());
    let mut rows = vec![String::new(); names.len()];
    let mut cols = |members: &std::collections::BTreeSet<usize>, count: usize| {
        for _ in 0..count {
            for (i, r) in rows.iter_mut().enumerate() {
                r.push(if members.contains(&i) { 'G' } else { 'A' });
            }
        }
    };
    for m in balanced_clades(&small)
        .into_iter()
        .chain(balanced_clades(&big))
    {
        cols(&m, 40);
    }
    cols(&big.iter().copied().collect(), 1);
    let fasta: String = names
        .iter()
        .zip(&rows)
        .map(|(n, s)| format!(">{n}\n{s}\n"))
        .collect();
    let ex = Exercise {
        schema_version: 5,
        id: "hundred".to_string(),
        title: "hundred".to_string(),
        alphabet: neophylo_core::Alphabet::Dna,
        data: neophylo_core::exercise::ExerciseData::Embedded {
            fasta,
            source: neophylo_core::exercise::Source {
                citation: "test".to_string(),
                license: "test".to_string(),
                accessions: vec![],
            },
        },
        reference: None,
        analysis: neophylo_core::exercise::Analysis {
            correction: neophylo_core::dist::DistModel::P,
            method: neophylo_core::algos::Method::Nj,
            kappa: None,
            site_filter: None,
        },
        locked: vec![],
        prompts: vec![],
        bootstrap: Some(neophylo_core::exercise::ExerciseBootstrap {
            replicates: 50,
            seed: 7,
        }),
        meta: None,
        premises: vec![],
    };
    let a = assignment(
        Content::Exercise(ex),
        vec![neophylo_core::assess::GradedTask {
            task: TaskRef::PredictBranch,
            points: 1.0,
        }],
    );
    let v = a.variant_for("ada").unwrap();
    let table = name_table(&v).unwrap();
    assert_eq!(table.len(), 100);
    // The engine's weakest grouping is the designed 70-side — at
    // least 65 names whatever the relabel transform does to them.
    let AcceptedAnswer::Branch(clade) = task_key(&v, &TaskRef::PredictBranch).unwrap() else {
        panic!("a branch key")
    };
    assert!(clade.len() >= 65, "the weakest key is the big side");
    let packed = pack_answer(
        &v,
        &TaskRef::PredictBranch,
        &TaskAnswer::Branch(clade.clone()),
    )
    .expect("a 70-tip clade packs");
    let PackedAnswer::Tips(ix) = &packed else {
        panic!("a clade packs to tips")
    };
    assert!(ix.iter().any(|&i| i >= 64), "index range past 64");
    // Encode/decode round trip in a real code, then grade correct.
    let p = CodePayload {
        format: 1,
        generator: GENERATOR_VERSION,
        fingerprint: fingerprint(&a),
        student_id: "ada".to_string(),
        retry: v.retry,
        names: table.len() as u8,
        attempts: vec![attempt(packed)],
        finished_min: 1000,
    };
    let code = encode_code(&p).unwrap();
    assert_eq!(decode_code(&code).unwrap(), p);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert!(
        out.tasks[0].first_ok,
        "the weakest-grouping pick grades correct: {out:?}"
    );
    assert_eq!(out.score, out.max);
}

// --- the serde gap pins (item 6) --------------------------------------------------

/// The assignment JSON with one extra top-level key injected — a
/// serialized real assignment, so the pin tests serde's handling of
/// exactly the key under test.
fn assignment_json(key: &str, value: serde_json::Value) -> serde_json::Value {
    let a = assignment(
        Content::Exercise(lesson("nj-basics")),
        vec![neophylo_core::assess::GradedTask {
            task: TaskRef::PredictPair { step: 1 },
            points: 1.0,
        }],
    );
    let mut v = serde_json::to_value(&a).unwrap();
    v.as_object_mut().unwrap().insert(key.to_string(), value);
    v
}

#[test]
fn content_hash_serde_gap_pins() {
    // `content_hash` is `Option<String>` — serde's Option rules make
    // JSON `null` the same as an absent key (the builder never writes
    // it; `skip_serializing_if` keeps it out of the wire shape), so a
    // recorded null is simply "no hash recorded".
    let a: Assignment =
        serde_json::from_value(assignment_json("content_hash", serde_json::Value::Null)).unwrap();
    assert_eq!(a.content_hash, None);
    // A non-string value is refused at parse — the key is typed.
    for bad in [serde_json::json!([]), serde_json::json!(["x"])] {
        assert!(
            serde_json::from_value::<Assignment>(assignment_json("content_hash", bad.clone()))
                .is_err(),
            "{bad} refuses"
        );
    }
    // A recorded string parses.
    let a: Assignment = serde_json::from_value(assignment_json(
        "content_hash",
        serde_json::json!("0123456789abcdef"),
    ))
    .unwrap();
    assert_eq!(a.content_hash.as_deref(), Some("0123456789abcdef"));
    // `served_content_hash` is `#[serde(skip)]` — input JSON carrying
    // it is ignored; the loader sets it from file bytes, never wire.
    let a: Assignment = serde_json::from_value(assignment_json(
        "served_content_hash",
        serde_json::json!("fedcba"),
    ))
    .unwrap();
    assert_eq!(a.served_content_hash, None);
}
