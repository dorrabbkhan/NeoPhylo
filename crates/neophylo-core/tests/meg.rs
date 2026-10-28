//! MEGA `.meg` sequence import and export (v1.4b spec §3.4, plan Task 5).
//! Every hostile case of Review Focus 3 is a named test asserting the
//! exact `NeoError::Parse` line: CRLF + BOM, interleaved blocks with
//! names in a different order, `.` identity in the first sequence, a
//! `!Format` missing `DataType`, an unterminated `"` comment, a
//! distance-matrix `.meg` and a missing `#mega`. The parser never
//! panics and respects `MAX_TAXA` / `MAX_SITES` like `phylip.rs`.
//!
//! `write_meg` maps each whitespace character in a label to `_` (MEGA
//! names cannot contain whitespace) and refuses when two labels collide
//! after the mapping; `parse_meg` keeps names literally (no `_`→space).

use neophylo_core::alphabet::Alphabet;
use neophylo_core::error::NeoError;
use neophylo_core::meg::{parse_meg, write_meg};
use neophylo_core::seq::{parse_fasta, Alignment, MAX_SITES, MAX_TAXA};
use std::fs;
use std::path::PathBuf;

fn input(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/meg_inputs")
        .join(name);
    fs::read_to_string(&path).unwrap()
}

fn aln(records: &[(&str, &str)]) -> Alignment {
    let text: String = records
        .iter()
        .map(|(name, seq)| format!(">{name}\n{seq}\n"))
        .collect();
    parse_fasta(&text).unwrap()
}

fn parse_line(err: &NeoError) -> u32 {
    match err {
        NeoError::Parse { line, .. } => *line,
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn sequential_dna() {
    let meg = parse_meg(&input("sequential_dna.meg")).unwrap();
    assert_eq!(meg.title.as_deref(), Some("Sequential DNA example"));
    assert!(meg.notices.is_empty(), "notices: {:?}", meg.notices);
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta", "Gamma"]);
    assert_eq!(meg.alignment.seqs[0], b"AACGTGGCCA");
    assert_eq!(meg.alignment.seqs[1], b"AAGGTCGCCA");
    assert_eq!(meg.alignment.seqs[2], b"CAGTTCGCCA");
}

#[test]
fn interleaved_protein() {
    let meg = parse_meg(&input("interleaved_protein.meg")).unwrap();
    assert_eq!(meg.alignment.alphabet, Alphabet::Protein);
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta", "Gamma"]);
    assert_eq!(meg.alignment.seqs[0], b"ARNDCQEGHI");
    assert_eq!(meg.alignment.seqs[1], b"AKNDCQEGHI");
    assert_eq!(meg.alignment.seqs[2], b"ARNDQLEGHI");
}

#[test]
fn interleaved_names_reordered() {
    // Later interleaved blocks may name taxa in a different order;
    // sequence data is matched by name, not by position.
    let meg = parse_meg(&input("interleaved_reordered.meg")).unwrap();
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta", "Gamma"]);
    assert_eq!(meg.alignment.seqs[0], b"ACGTTTTT");
    assert_eq!(meg.alignment.seqs[1], b"AGGTCCCC");
    assert_eq!(meg.alignment.seqs[2], b"CGTTAAAA");
}

#[test]
fn identity_expanded_against_first_sequence() {
    // `.` in later sequences copies the first sequence's character at
    // that column; literal characters stand (Third keeps its own `T`
    // where First has `G`).
    let meg = parse_meg(&input("identity.meg")).unwrap();
    assert_eq!(meg.alignment.labels, ["First", "Second", "Third"]);
    assert_eq!(meg.alignment.seqs[0], b"ACGTTGCA");
    assert_eq!(meg.alignment.seqs[1], b"ACGTTGCA");
    assert_eq!(meg.alignment.seqs[2], b"ACGTTTCA");
}

#[test]
fn identity_dot_in_first_sequence_is_error_at_its_line() {
    // `.` has no referent in the first sequence: error at that line.
    let err = parse_meg(&input("identity_first_seq.meg")).unwrap_err();
    assert_eq!(parse_line(&err), 4, "err: {err:?}");
    match &err {
        NeoError::Parse { msg, .. } => assert!(msg.contains("identity"), "msg: {msg}"),
        _ => unreachable!(),
    }
}

#[test]
fn same_line_sequential() {
    // MEGA's own manual examples put the data on the `#name` line:
    // the name runs to the first whitespace, the rest is sequence.
    let meg = parse_meg(&input("same_line_sequential.meg")).unwrap();
    assert_eq!(meg.title.as_deref(), Some("Example"));
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert_eq!(meg.alignment.labels, ["Human", "Chimp"]);
    assert_eq!(meg.alignment.seqs[0], b"ACTGACTGAC");
    // `.` identity in same-line data expands against Human.
    assert_eq!(meg.alignment.seqs[1], b"ACAGACTGAC");
}

#[test]
fn same_line_interleaved() {
    // Same-line data in two interleaved blocks; the second block names
    // the taxa in a different order and continues each by name.
    let meg = parse_meg(&input("same_line_interleaved.meg")).unwrap();
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta", "Gamma"]);
    assert_eq!(meg.alignment.seqs[0], b"ACGTTTTT");
    assert_eq!(meg.alignment.seqs[1], b"AGGTCCCC");
    assert_eq!(meg.alignment.seqs[2], b"CGTTAAAA");
}

#[test]
fn same_line_data_error_points_at_its_column() {
    // `.` is the identity symbol — invalid in the FIRST sequence. It is
    // at column 11 of line 4, not column 4 of the data tail.
    let err = parse_meg("#mega\n!Format DataType=DNA;\n\n#First  AC.GT\n").unwrap_err();
    match &err {
        NeoError::Parse { line, col, msg } => {
            assert_eq!(*line, 4, "err: {err:?}");
            assert_eq!(*col, 11, "err: {err:?}");
            assert!(msg.contains("identity"), "msg: {msg}");
        }
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn crlf_and_bom() {
    let meg = parse_meg(&input("crlf_bom.meg")).unwrap();
    assert_eq!(meg.title.as_deref(), Some("CRLF and BOM"));
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta"]);
    assert_eq!(meg.alignment.seqs[0], b"ACGT");
    assert_eq!(meg.alignment.seqs[1], b"AGGT");
}

#[test]
fn comments_including_spanning() {
    let meg = parse_meg(&input("comments.meg")).unwrap();
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta"]);
    // The spanning comment is removed before the sequence is read:
    // "ACGT ... TGCA" is eight sites.
    assert_eq!(meg.alignment.seqs[0], b"ACGTTGCA");
    assert_eq!(meg.alignment.seqs[1], b"AGGTCCAA");
}

#[test]
fn unterminated_comment_is_error_at_opening_line() {
    // The `"` opens on line 4 of unterminated_comment.meg.
    let err = parse_meg(&input("unterminated_comment.meg")).unwrap_err();
    assert_eq!(parse_line(&err), 4, "err: {err:?}");
    match &err {
        NeoError::Parse { msg, .. } => assert!(msg.contains("comment"), "msg: {msg}"),
        _ => unreachable!(),
    }
}

#[test]
fn gene_domain_label_commands_give_one_notice_each() {
    let meg = parse_meg(&input("commands.meg")).unwrap();
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta", "Gamma"]);
    assert_eq!(meg.notices.len(), 3, "notices: {:?}", meg.notices);
    for (notice, cmd) in meg.notices.iter().zip(["Gene", "Domain", "Label"]) {
        assert!(notice.contains(cmd), "notice was: {notice}");
    }
}

#[test]
fn distance_matrix_is_refused() {
    let err = parse_meg(&input("matrix.meg")).unwrap_err();
    assert_eq!(parse_line(&err), 2, "err: {err:?}");
    match &err {
        NeoError::Parse { msg, .. } => assert_eq!(
            msg,
            "distance-matrix .meg files are not supported yet (planned for v1.4c)"
        ),
        _ => unreachable!(),
    }
}

#[test]
fn missing_mega_header_is_error_at_line_1() {
    let err = parse_meg(&input("no_mega_header.meg")).unwrap_err();
    assert_eq!(parse_line(&err), 1, "err: {err:?}");
    // A FASTA file is not a .meg file either: same line-1 error.
    let err = parse_meg(">a\nACGT\n>b\nAGGT\n").unwrap_err();
    assert_eq!(parse_line(&err), 1, "err: {err:?}");
    // And an empty input.
    let err = parse_meg("   \n\n").unwrap_err();
    assert_eq!(parse_line(&err), 1, "err: {err:?}");
}

#[test]
fn format_without_datatype_detects_alphabet() {
    let meg = parse_meg(&input("format_no_datatype.meg")).unwrap();
    assert_eq!(meg.alignment.alphabet, Alphabet::Protein);
    assert_eq!(meg.alignment.seqs[0], b"EANITW");
    assert!(
        meg.notices.iter().any(|n| n.contains("auto-detect")),
        "notices: {:?}",
        meg.notices
    );
}

#[test]
fn no_format_detects_alphabet() {
    let meg = parse_meg(&input("no_format.meg")).unwrap();
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert_eq!(meg.alignment.seqs[1], b"AGGT");
    assert!(
        meg.notices.iter().any(|n| n.contains("auto-detect")),
        "notices: {:?}",
        meg.notices
    );
}

#[test]
fn format_spaces_around_equals() {
    // `key = value` pairs tolerate whitespace on either side of `=`:
    // `DataType = DNA`, `Indel= -`, `Missing =?` all take effect, so
    // there is no auto-detect notice.
    let meg = parse_meg(&input("format_spaces.meg")).unwrap();
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert!(meg.notices.is_empty(), "notices: {:?}", meg.notices);
    assert_eq!(meg.alignment.labels, ["Alpha", "Beta"]);
    assert_eq!(meg.alignment.seqs[0], b"ACGT");
    assert_eq!(meg.alignment.seqs[1], b"A-G?");
}

#[test]
fn distance_matrix_spaced_is_refused() {
    // A spaced `DataType = Distance` is still a distance declaration:
    // the v1.4c refusal at the !Format line, not a character error in
    // the matrix rows.
    let err = parse_meg(&input("matrix_spaced.meg")).unwrap_err();
    assert_eq!(parse_line(&err), 2, "err: {err:?}");
    match &err {
        NeoError::Parse { msg, .. } => assert_eq!(
            msg,
            "distance-matrix .meg files are not supported yet (planned for v1.4c)"
        ),
        _ => unreachable!(),
    }
}

#[test]
fn format_keys_case_insensitive_any_order() {
    // Spec §3.4: `!Format` keys are case-insensitive and may appear in
    // any order.
    let meg =
        parse_meg("#mega\n!FORMAT missing=? DATATYPE=dna indel=-;\n#a\nACGT\n#b\nA-G?\n").unwrap();
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert!(meg.notices.is_empty(), "notices: {:?}", meg.notices);
    assert_eq!(meg.alignment.seqs[1], b"A-G?");
}

#[test]
fn command_spanning_lines() {
    // Commands run to `;` and may span lines (spec §3.4).
    let meg = parse_meg("#mega\n!Title a\n title;\n!Format DataType=\nDNA;\n#a\nACGT\n#b\nAGGT\n")
        .unwrap();
    assert_eq!(meg.title.as_deref(), Some("a title"));
    assert_eq!(meg.alignment.alphabet, Alphabet::Dna);
    assert_eq!(meg.alignment.seqs[0], b"ACGT");
    assert_eq!(meg.alignment.seqs[1], b"AGGT");
    // An error in a spanning command reports its opening line, not the
    // line the `;` lands on.
    let err = parse_meg("#mega\n!Format DataType=\nDistance;\n").unwrap_err();
    assert_eq!(parse_line(&err), 2, "err: {err:?}");
}

#[test]
fn custom_symbols() {
    // `Identical`, `Indel` and `Missing` may be redefined to symbols
    // that are not residues (spec §3.4): `*` copies the first
    // sequence, `~` maps to `-`, `X` maps to `?`.
    let meg = parse_meg(
        "#mega\n!Format DataType=DNA Identical=* Indel=~ Missing=X;\n#First\nACGT\n#Second\nA*~X\n",
    )
    .unwrap();
    assert_eq!(meg.alignment.seqs[0], b"ACGT");
    assert_eq!(meg.alignment.seqs[1], b"AC-?");
    // With `Identical=*`, `.` is an ordinary character again — and not
    // a DNA residue, so it is refused.
    let err =
        parse_meg("#mega\n!Format DataType=DNA Identical=*;\n#a\nACGT\n#b\nA.G.\n").unwrap_err();
    assert_eq!(
        err,
        NeoError::UnsupportedCharacter {
            label: "b".to_string(),
            position: 1,
            ch: '.',
        }
    );
}

#[test]
fn sequence_data_before_first_name() {
    let err = parse_meg("#mega\nACGT\n#b\nAGGT\n").unwrap_err();
    assert_eq!(parse_line(&err), 2, "err: {err:?}");
}

#[test]
fn unequal_lengths_is_parse_error_at_first_name_line() {
    let err = parse_meg("#mega\n#a\nACGT\n#b\nAGG\n").unwrap_err();
    match err {
        NeoError::Parse { line, msg, .. } => {
            assert_eq!(line, 4);
            assert!(msg.contains('b'), "msg: {msg}");
        }
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn empty_name_is_refused() {
    let err = parse_meg("#mega\n#\nACGT\n").unwrap_err();
    assert_eq!(parse_line(&err), 2, "err: {err:?}");
}

#[test]
fn no_records_is_refused() {
    let err = parse_meg("#mega\n!Title nothing;\n").unwrap_err();
    match err {
        NeoError::Parse { msg, .. } => assert!(msg.contains("#"), "msg: {msg}"),
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn unsupported_character_uses_seq_rules() {
    // Digits are not sequence characters: the existing seq.rs validation
    // reports UnsupportedCharacter after identity expansion.
    let err = parse_meg("#mega\n#a\nACGT\n#b\nACG5\n").unwrap_err();
    assert_eq!(
        err,
        NeoError::UnsupportedCharacter {
            label: "b".to_string(),
            position: 3,
            ch: '5',
        }
    );
}

#[test]
fn too_many_taxa() {
    let mut text = String::from("#mega\n!Format DataType=DNA;\n");
    for i in 0..=MAX_TAXA {
        text.push_str(&format!("#t{i}\nACGT\n"));
    }
    assert_eq!(
        parse_meg(&text).unwrap_err(),
        NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: MAX_TAXA + 1,
        }
    );
}

#[test]
fn too_many_sites() {
    let text = format!("#mega\n#a\n{}\n", "A".repeat(MAX_SITES + 1));
    match parse_meg(&text).unwrap_err() {
        NeoError::Parse { line, msg, .. } => {
            assert_eq!(line, 3);
            assert!(msg.contains("site"), "msg: {msg}");
        }
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn write_then_parse_is_identity() {
    // Every FASTA input the engine accepts survives write -> parse
    // unchanged (the fixtures have no whitespace in their labels).
    for rel in [
        "inputs/gaps_boundary.fasta",
        "inputs/jc12.fasta",
        "inputs/jc6.fasta",
        "inputs/jc7_long.fasta",
        "inputs/jc8_gaps.fasta",
        "inputs/k80_10.fasta",
        "inputs/protein/p10_400.fasta",
        "inputs/protein/p12_100.fasta",
        "inputs/protein/p6_150.fasta",
        "inputs/protein/p8_250.fasta",
    ] {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../fixtures")
            .join(rel);
        let aln = parse_fasta(&fs::read_to_string(&path).unwrap()).unwrap();
        let out = write_meg(&aln, rel).unwrap();
        let back = parse_meg(&out).unwrap();
        assert_eq!(back.alignment, aln, "{rel}");
    }
}

#[test]
fn writer_output_shape() {
    let dna = aln(&[("a", "ACGT"), ("b", "AGGT")]);
    let out = write_meg(&dna, "demo").unwrap();
    let lines: Vec<&str> = out.lines().collect();
    assert_eq!(lines[0], "#mega");
    assert_eq!(lines[1], "!Title demo;");
    assert_eq!(lines[2], "!Format DataType=DNA Indel=- Missing=?;");
    assert_eq!(lines[3], "");
    assert_eq!(lines[4], "#a");
    assert_eq!(lines[5], "ACGT");
    assert_eq!(lines[6], "#b");
    assert_eq!(lines[7], "AGGT");
    let prot = aln(&[("p", "ARNDCQEGHI")]);
    let out = write_meg(&prot, "prot").unwrap();
    assert!(out.contains("!Format DataType=Protein"), "out: {out}");
}

#[test]
fn write_maps_space_to_underscore() {
    let spaced = aln(&[("a b", "ACGT"), ("c", "AGGT")]);
    let out = write_meg(&spaced, "t").unwrap();
    assert!(out.contains("#a_b"), "out: {out}");
    let back = parse_meg(&out).unwrap();
    assert_eq!(back.alignment.labels, ["a_b", "c"]);
    // Tabs map the same way.
    let tabbed = aln(&[("x\ty", "ACGT")]);
    let out = write_meg(&tabbed, "t").unwrap();
    assert!(out.contains("#x_y"), "out: {out}");
}

#[test]
fn write_label_collision_is_error() {
    // "a b" and "a_b" both map to "a_b": the error names both labels.
    let aln = Alignment {
        labels: vec!["a b".to_string(), "a_b".to_string()],
        seqs: vec![b"ACGT".to_vec(), b"AGGT".to_vec()],
        alphabet: Alphabet::Dna,
    };
    let err = write_meg(&aln, "t").unwrap_err();
    match err {
        NeoError::InvalidExercise { field, msg } => {
            assert_eq!(field, "names");
            assert!(msg.contains("a b"), "msg: {msg}");
            assert!(msg.contains("a_b"), "msg: {msg}");
        }
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}
