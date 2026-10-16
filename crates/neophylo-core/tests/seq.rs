use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, MAX_TAXA};

#[test]
fn parses_basic() {
    let aln = parse_fasta(">a\nACGT\n>b\nACGA\n").unwrap();
    assert_eq!(aln.labels, ["a", "b"]);
    assert_eq!(aln.seqs[1], b"ACGA");
}

#[test]
fn normalizes_case_and_u() {
    let aln = parse_fasta(">a\nacgu\n").unwrap();
    assert_eq!(aln.seqs[0], b"ACGT");
}

#[test]
fn messy_input() {
    let aln = parse_fasta("\u{feff}>a\r\nAC\r\nGT\r\n\r\n>b\r\nACGA  \r\n").unwrap();
    assert_eq!(aln.labels, ["a", "b"]);
    assert_eq!(aln.seqs[0], b"ACGT");
    assert_eq!(aln.seqs[1], b"ACGA");
}

#[test]
fn duplicate_label() {
    let err = parse_fasta(">a\nACGT\n>a\nACGA\n").unwrap_err();
    match err {
        NeoError::Parse { line, msg, .. } => {
            assert_eq!(line, 3);
            assert!(msg.contains("duplicate"), "msg was: {msg}");
        }
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn unequal_lengths() {
    let err = parse_fasta(">a\nACGT\n>b\nACG\n").unwrap_err();
    assert_eq!(
        err,
        NeoError::UnequalLengths {
            label: "b".to_string(),
            expected: 4,
            got: 3,
        }
    );
}

#[test]
fn unsupported_char() {
    // 'X' is a protein character since v1.1 (detected as protein rather
    // than rejected), so the offending input is now '#'.
    let err = parse_fasta(">a\nAC#T\n").unwrap_err();
    assert_eq!(
        err,
        NeoError::UnsupportedCharacter {
            label: "a".to_string(),
            position: 2,
            ch: '#',
        }
    );
}

#[test]
fn text_before_header() {
    let err = parse_fasta("ACGT\n>a\nACGT\n").unwrap_err();
    match err {
        NeoError::Parse { line, .. } => assert_eq!(line, 1),
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn too_many_taxa() {
    let mut text = String::new();
    for i in 0..=MAX_TAXA {
        text.push_str(&format!(">t{i}\nACGT\n"));
    }
    let err = parse_fasta(&text).unwrap_err();
    assert_eq!(
        err,
        NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: MAX_TAXA + 1,
        }
    );
}

#[test]
fn labels_keep_spaces() {
    let aln = parse_fasta(">Homo sapiens  \n").unwrap();
    assert_eq!(aln.labels, ["Homo sapiens"]);
}
