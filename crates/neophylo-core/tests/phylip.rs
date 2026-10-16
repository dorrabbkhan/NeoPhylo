//! PHYLIP sequential/interleaved parsing and matrix writing
//! (v1.1 spec §3.2, plan Task 4).

use neophylo_core::dist::{Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::phylip::{parse_phylip, write_phylip_matrix, NameMode};
use neophylo_core::seq::MAX_TAXA;

/// The protdist documentation alignment (plan Task 2), names padded to
/// the 10-column strict field.
const DOC_DATA: &str = "    5   13\n\
    Alpha     AACGTGGCCACAT\n\
    Beta      AAGGTCGCCACAC\n\
    Gamma     CAGTTCGCCACAA\n\
    Delta     GAGATTTCCGCCT\n\
    Epsilon   GAGATCTCCGCCC\n";

const DOC_LABELS: [&str; 5] = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
const DOC_SEQS: [&[u8]; 5] = [
    b"AACGTGGCCACAT",
    b"AAGGTCGCCACAC",
    b"CAGTTCGCCACAA",
    b"GAGATTTCCGCCT",
    b"GAGATCTCCGCCC",
];

fn assert_doc(aln: &neophylo_core::seq::Alignment) {
    assert_eq!(aln.labels, DOC_LABELS);
    assert_eq!(aln.seqs, DOC_SEQS);
}

#[test]
fn doc_data_sequential() {
    let (aln, used) = parse_phylip(DOC_DATA, NameMode::Auto).unwrap();
    // The padded-name layout also parses cleanly as Relaxed, which Auto
    // prefers; either way the result must be the doc alignment.
    assert_eq!(used, NameMode::Relaxed);
    assert_doc(&aln);
    for seq in &aln.seqs {
        assert_eq!(seq.len(), 13);
    }

    let (aln, used) = parse_phylip(DOC_DATA, NameMode::Strict).unwrap();
    assert_eq!(used, NameMode::Strict);
    assert_doc(&aln);
}

#[test]
fn strict_names_with_spaces() {
    // Exactly-10-character names containing spaces run straight into the
    // sequence: only the Strict read is consistent with the header.
    let text = "3 4\nHomo sapieACGT\nPan trogloACGA\nGorilla goACTT\n";
    let (aln, used) = parse_phylip(text, NameMode::Auto).unwrap();
    assert_eq!(used, NameMode::Strict);
    assert_eq!(aln.labels, ["Homo sapie", "Pan troglo", "Gorilla go"]);
    assert_eq!(aln.seqs[0], b"ACGT");
    assert_eq!(aln.seqs[1], b"ACGA");
    assert_eq!(aln.seqs[2], b"ACTT");
}

#[test]
fn messy_handout() {
    // Review Focus 1: every ugliness found in old handouts must parse
    // under Auto.

    // (a) A name that runs straight into its sequence (exactly 10
    // characters, no space).
    let (aln, used) = parse_phylip(
        "3 4\nAbcdefghijACGT\nBcefghijklACGA\nDcdefghijkACTT\n",
        NameMode::Auto,
    )
    .unwrap();
    assert_eq!(used, NameMode::Strict);
    assert_eq!(aln.labels, ["Abcdefghij", "Bcefghijkl", "Dcdefghijk"]);
    assert_eq!(aln.seqs[0], b"ACGT");

    // (b) A tab after a relaxed name.
    let (aln, used) = parse_phylip("3 4\na\tACGT\nb\tACGA\nc\tACTT\n", NameMode::Auto).unwrap();
    assert_eq!(used, NameMode::Relaxed);
    assert_eq!(aln.labels, ["a", "b", "c"]);
    assert_eq!(aln.seqs[1], b"ACGA");

    // (c) Trailing spaces at line ends.
    let (aln, _) =
        parse_phylip("  3 4  \na ACGT   \nb ACGA\t \nc ACTT  \n", NameMode::Auto).unwrap();
    assert_eq!(aln.labels, ["a", "b", "c"]);
    assert_eq!(aln.seqs[2], b"ACTT");

    // (d) CRLF line endings and a BOM.
    let (aln, _) = parse_phylip(
        "\u{feff}3 4\r\na ACGT\r\nb ACGA\r\nc ACTT\r\n",
        NameMode::Auto,
    )
    .unwrap();
    assert_eq!(aln.labels, ["a", "b", "c"]);
    assert_eq!(aln.seqs[0], b"ACGT");

    // (e) A blank line between interleaved blocks.
    let (aln, _) = parse_phylip(
        "3 8\na ACGT\nb ACGA\nc ACTT\n\nACGT\nACGA\nACTT\n",
        NameMode::Auto,
    )
    .unwrap();
    assert_eq!(aln.labels, ["a", "b", "c"]);
    assert_eq!(aln.seqs[0], b"ACGTACGT");
    assert_eq!(aln.seqs[1], b"ACGAACGA");
    assert_eq!(aln.seqs[2], b"ACTTACTT");
}

#[test]
fn interleaved() {
    let text = "3 8\na ACGT\nb ACGA\nc ACTT\n\nACGT\nACGA\nACTT\n";
    let (aln, _) = parse_phylip(text, NameMode::Auto).unwrap();
    for seq in &aln.seqs {
        assert_eq!(seq.len(), 8);
    }
    // Interleaved also works without the blank separator and in the
    // explicit name modes (Strict needs the 10-column name field).
    let (aln, _) = parse_phylip(
        "3 8\na ACGT\nb ACGA\nc ACTT\nACGT\nACGA\nACTT\n",
        NameMode::Auto,
    )
    .unwrap();
    assert_eq!(aln.seqs[0], b"ACGTACGT");
    let strict = "3 8\na         ACGT\nb         ACGA\nc         ACTT\n\nACGT\nACGA\nACTT\n";
    let (aln, _) = parse_phylip(strict, NameMode::Strict).unwrap();
    assert_eq!(aln.seqs[0], b"ACGTACGT");
}

#[test]
fn header_mismatch() {
    // Fewer sequences than the header announces.
    let err = parse_phylip("3 4\na ACGT\nb ACGA\n", NameMode::Auto).unwrap_err();
    match err {
        NeoError::Parse { msg, .. } => {
            assert!(msg.contains("expected 3 sequences"), "msg was: {msg}")
        }
        other => panic!("expected Parse, got {other:?}"),
    }

    // A sequence with the wrong site count, naming the taxon.
    for mode in [NameMode::Auto, NameMode::Relaxed] {
        let err = parse_phylip("3 4\na ACGT\nb ACGA\nc ACGTA\n", mode).unwrap_err();
        match err {
            NeoError::Parse { msg, .. } => {
                assert!(msg.contains('c'), "msg was: {msg}");
                assert!(msg.contains("expected 4 sites, got 5"), "msg was: {msg}");
            }
            other => panic!("expected Parse, got {other:?}"),
        }
    }
    let err = parse_phylip(
        "3 4\na         ACGT\nb         ACGA\nc         ACGTA\n",
        NameMode::Strict,
    )
    .unwrap_err();
    match err {
        NeoError::Parse { msg, .. } => {
            assert!(msg.contains('c'), "msg was: {msg}");
            assert!(msg.contains("expected 4 sites, got 5"), "msg was: {msg}");
        }
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn duplicate_names() {
    for mode in [NameMode::Strict, NameMode::Relaxed, NameMode::Auto] {
        let text = "2 4\na         ACGT\na         ACGA\n";
        match parse_phylip(text, mode) {
            Err(NeoError::Parse { .. }) => {}
            other => panic!("{mode:?}: expected Parse, got {other:?}"),
        }
    }
}

fn matrix(labels: &[&str], cells: Vec<Cell>) -> DistanceMatrix {
    DistanceMatrix {
        labels: labels.iter().map(|s| s.to_string()).collect(),
        model: DistModel::P,
        cells,
    }
}

#[test]
fn writer_strict() {
    let m = matrix(
        &["Alpha", "Beta", "Gamma"],
        vec![
            Cell::Value(0.0),
            Cell::Value(0.5),
            Cell::Saturated,
            Cell::Value(0.5),
            Cell::Value(0.0),
            Cell::Value(1.25),
            Cell::Saturated,
            Cell::Value(1.25),
            Cell::Value(0.0),
        ],
    );
    let out = write_phylip_matrix(&m, NameMode::Strict).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "3");
    assert_eq!(lines.len(), 4);
    assert!(
        lines[1].starts_with("Alpha     "),
        "row was: {:?}",
        lines[1]
    );
    assert!(lines[1].contains("0.000000"));
    assert!(lines[1].contains("0.500000"));
    // A Saturated cell uses PHYLIP's -1 convention.
    assert!(lines[1].contains("-1.000000"), "row was: {:?}", lines[1]);
    assert!(
        lines[3].starts_with("Gamma     "),
        "row was: {:?}",
        lines[3]
    );
}

#[test]
fn writer_long_name() {
    let m = matrix(
        &["VeryLongName1", "b"],
        vec![
            Cell::Value(0.0),
            Cell::Value(0.25),
            Cell::Value(0.25),
            Cell::Value(0.0),
        ],
    );
    let err = write_phylip_matrix(&m, NameMode::Strict).unwrap_err();
    match err {
        NeoError::InvalidExercise { field, .. } => assert_eq!(field, "names"),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
    // Auto falls back to Relaxed; the row is name, one space, values.
    let out = write_phylip_matrix(&m, NameMode::Auto).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert!(
        lines[1].starts_with("VeryLongName1 "),
        "row was: {:?}",
        lines[1]
    );
}

#[test]
fn writer_auto_picks_strict_when_names_fit() {
    let m = matrix(
        &["a", "b"],
        vec![
            Cell::Value(0.0),
            Cell::Value(0.25),
            Cell::Value(0.25),
            Cell::Value(0.0),
        ],
    );
    let out = write_phylip_matrix(&m, NameMode::Auto).unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "2");
    assert!(
        lines[1].starts_with("a         "),
        "row was: {:?}",
        lines[1]
    );
}

#[test]
fn too_many_taxa() {
    let text = format!("{} 4\n", MAX_TAXA + 1);
    assert_eq!(
        parse_phylip(&text, NameMode::Auto).unwrap_err(),
        NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: MAX_TAXA + 1,
        }
    );
}
