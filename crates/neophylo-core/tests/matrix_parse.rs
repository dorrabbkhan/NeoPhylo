//! Matrix parsers (v1.4c spec §5.1, plan Task 4): PHYLIP square and
//! lower-triangular files, MEGA `.meg` distance files, the tolerant
//! paste form, `detect_matrix_format` and `write_meg_matrix`.
//!
//! The PHYLIP/`.meg` matrix fixtures come from Task 2; the files in
//! `tests/matrix_inputs/` are hand-written cases (wrapped rows, bad
//! names, missing cells) and are also the fuzz seed corpus.

use std::fs;
use std::path::PathBuf;

use neophylo_core::error::{NeoError, PasteQuestion};
use neophylo_core::matrix_input::DistanceInput;
use neophylo_core::matrix_parse::{
    detect_matrix_format, parse_meg_matrix, parse_pasted_matrix, parse_phylip_matrix,
    write_meg_matrix, MatrixFormat, PasteOptions, PhylipMatrixOptions,
};
use neophylo_core::phylip::NameMode;

fn input(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/matrix_inputs")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn fixture(name: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/inputs/matrix")
        .join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn auto() -> PhylipMatrixOptions {
    PhylipMatrixOptions {
        names: NameMode::Auto,
        use_lower_if_asymmetric: false,
    }
}

fn paste_opts() -> PasteOptions {
    PasteOptions {
        first_column_names: None,
        header_row: None,
        decimal_comma: None,
    }
}

/// The wiki5 matrix as a `DistanceInput`: names a–e and the strict
/// lower triangle in row order.
fn wiki5() -> DistanceInput {
    DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into(), "d".into(), "e".into()],
        lower: vec![5.0, 9.0, 10.0, 9.0, 10.0, 8.0, 8.0, 9.0, 7.0, 3.0],
    }
}

// ---- PHYLIP --------------------------------------------------------

#[test]
fn wiki5_square_and_lower_agree() {
    let square = parse_phylip_matrix(&fixture("wiki5_square.phy"), auto())
        .expect("square wiki5")
        .matrix;
    let lower = parse_phylip_matrix(&fixture("wiki5_lower.phy"), auto())
        .expect("lower wiki5")
        .matrix;
    assert_eq!(square, wiki5());
    assert_eq!(lower, wiki5());
    // The .meg copy carries the same matrix (Task 2 fixtures).
    let meg = parse_meg_matrix(&fixture("wiki5_square.meg"))
        .expect("meg wiki5")
        .matrix;
    assert_eq!(meg, wiki5());
}

#[test]
fn wrapped_rows() {
    // A square row may wrap across lines: the row's first line carries
    // the name, later lines carry only values (PHYLIP list-directed
    // reads work this way; `real12.phy` is the real-world case).
    let f = parse_phylip_matrix(&input("phylip_wrapped.phy"), auto()).expect("wrapped");
    assert_eq!(f.matrix.names, ["alpha", "beta", "gamma", "delta"]);
    assert_eq!(
        f.matrix.lower,
        vec![1.0, 2.0, 4.0, 3.0, 5.0, 6.0],
        "lower triangle in row order"
    );
    let real = parse_phylip_matrix(&fixture("real12.phy"), auto()).expect("real12");
    let meg = parse_meg_matrix(&fixture("real12.meg")).expect("real12 meg");
    assert_eq!(real.matrix, meg.matrix);
}

#[test]
fn relaxed_names_with_spaces() {
    // Relaxed names run to the first whitespace and may be longer
    // than PHYLIP's 10-character strict limit, with any spacing.
    let text = input("phylip_relaxed.phy");
    let f = parse_phylip_matrix(
        &text,
        PhylipMatrixOptions {
            names: NameMode::Relaxed,
            ..auto()
        },
    )
    .expect("relaxed");
    assert_eq!(
        f.matrix.names,
        [
            "Homo_sapiens_x",
            "Pan_troglodytes",
            "Gorilla_gorilla",
            "Pongo_pygmaeus"
        ]
    );
    // Auto resolves the same file to Relaxed.
    let a = parse_phylip_matrix(&text, auto()).expect("auto");
    assert_eq!(a.matrix, f.matrix);
}

#[test]
fn asymmetric_names_first_cell() {
    let err = parse_phylip_matrix(&input("phylip_asymmetric.phy"), auto()).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!((row.as_str(), col.as_str()), ("c", "a"), "err: {msg}");
            assert!(
                msg.contains("symmetric") || msg.contains("asymmetric"),
                "{msg}"
            );
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn asymmetric_with_use_lower_gives_notice() {
    let f = parse_phylip_matrix(
        &input("phylip_asymmetric.phy"),
        PhylipMatrixOptions {
            use_lower_if_asymmetric: true,
            ..auto()
        },
    )
    .expect("lower of asymmetric");
    assert_eq!(
        f.matrix.lower,
        vec![1.0, 9.0, 4.0, 3.0, 5.0, 6.0],
        "lower triangle of the asymmetric file"
    );
    assert_eq!(f.notices.len(), 1, "notices: {:?}", f.notices);
    assert!(f.notices[0].contains("asymmetric") || f.notices[0].contains("lower"));
}

#[test]
fn saturated_minus_one_refused() {
    // `dnadist`/`protdist` write -1 for an inestimable distance; the
    // cell is named so the UI can point at it.
    let err = parse_phylip_matrix(&input("phylip_saturated.phy"), auto()).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!((row.as_str(), col.as_str()), ("c", "d"), "err: {msg}");
            assert!(msg.contains("saturated"), "{msg}");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn nonzero_diagonal_refused() {
    let err = parse_phylip_matrix(&input("phylip_bad_diag.phy"), auto()).unwrap_err();
    match err {
        NeoError::InvalidMatrix { msg, .. } => assert!(msg.contains("diagonal"), "{msg}"),
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn truncation_collision_refused() {
    // Review Focus 2: 'Chimpanzee1' and 'Chimpanzee2' both truncate to
    // 'Chimpanzee' under PHYLIP's 10-character strict limit; the error
    // names both full names and the truncated one (conductor's call:
    // applies under Strict, or Auto resolving to Strict).
    let text = input("phylip_trunc_collision.phy");
    let err = parse_phylip_matrix(
        &text,
        PhylipMatrixOptions {
            names: NameMode::Strict,
            ..auto()
        },
    )
    .unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!(row, "Chimpanzee1");
            assert_eq!(col, "Chimpanzee2");
            assert!(msg.contains("Chimpanzee"), "{msg}");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
    // Under Relaxed the names are distinct and the file parses.
    let ok = parse_phylip_matrix(
        &text,
        PhylipMatrixOptions {
            names: NameMode::Relaxed,
            ..auto()
        },
    )
    .expect("relaxed keeps full names");
    assert_eq!(ok.matrix.names[0], "Chimpanzee1");
    assert_eq!(ok.matrix.names[1], "Chimpanzee2");
}

#[test]
fn strict_names_with_spaces_no_gap() {
    // Classic strict PHYLIP: the name is the first 10 characters of
    // the row's first line and a value may follow it with no space.
    let text = "3\nHomo sapie0.0 1.0 2.0\nPan troglo1.0 0.0 3.0\nGorilla go2.0 3.0 0.0\n";
    for names in [NameMode::Strict, NameMode::Auto] {
        let f = parse_phylip_matrix(text, PhylipMatrixOptions { names, ..auto() })
            .unwrap_or_else(|e| panic!("{names:?}: {e:?}"));
        assert_eq!(
            f.matrix.names,
            ["Homo sapie", "Pan troglo", "Gorilla go"],
            "{names:?}"
        );
        assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0], "{names:?}");
    }
}

#[test]
fn strict_names_with_spaces_and_gap() {
    // The same strict file with a space after the 10-character name.
    let text = "3\nHomo sapie 0.0 1.0 2.0\nPan troglo 1.0 0.0 3.0\nGorilla go 2.0 3.0 0.0\n";
    for names in [NameMode::Strict, NameMode::Auto] {
        let f = parse_phylip_matrix(text, PhylipMatrixOptions { names, ..auto() })
            .unwrap_or_else(|e| panic!("{names:?}: {e:?}"));
        assert_eq!(
            f.matrix.names,
            ["Homo sapie", "Pan troglo", "Gorilla go"],
            "{names:?}"
        );
        assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0], "{names:?}");
    }
}

#[test]
fn strict_glued_ten_char_names() {
    // dnadist/protdist glue the first value straight onto a name that
    // fills its 10 columns; the first token then exceeds 10
    // characters but is name+value, not an overflowed name (review
    // fix round 2).
    for text in [
        "3\nGorilla_go0.0 1.0 2.0\nPan_troglo1.0 0.0 3.0\nHomo_sapie2.0 3.0 0.0\n",
        "3\nGorilla_go0.000000  1.000000  2.000000\nPan_troglo1.000000  0.000000  3.000000\nHomo_sapie2.000000  3.000000  0.000000\n",
    ] {
        for names in [NameMode::Strict, NameMode::Auto] {
            let f = parse_phylip_matrix(text, PhylipMatrixOptions { names, ..auto() })
                .unwrap_or_else(|e| panic!("{names:?} {text:?}: {e:?}"));
            assert_eq!(
                f.matrix.names,
                ["Gorilla_go", "Pan_troglo", "Homo_sapie"],
                "{names:?} {text:?}"
            );
            assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0], "{names:?} {text:?}");
        }
    }
}

#[test]
fn strict_glued_lower_triangle() {
    // The same glued 10-character names on a lower-triangular file.
    let text = "3\nAlphaAlpha\nBetaBetaBe1.0\nGammaGamma2.0 3.0\n";
    for names in [NameMode::Strict, NameMode::Auto] {
        let f = parse_phylip_matrix(text, PhylipMatrixOptions { names, ..auto() })
            .unwrap_or_else(|e| panic!("{names:?}: {e:?}"));
        assert_eq!(
            f.matrix.names,
            ["AlphaAlpha", "BetaBetaBe", "GammaGamma"],
            "{names:?}"
        );
        assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0], "{names:?}");
    }
}

#[test]
fn strict_name_multibyte_no_panic() {
    // A 10-character name holding multi-byte characters parses with
    // glued values (chars, not bytes, bound the name field).
    let text = "3\nMüller abc0.0 1.0 2.0\nPan troglo1.0 0.0 3.0\nGorilla go2.0 3.0 0.0\n";
    let f = parse_phylip_matrix(
        text,
        PhylipMatrixOptions {
            names: NameMode::Strict,
            ..auto()
        },
    )
    .expect("multibyte strict names");
    assert_eq!(f.matrix.names[0], "Müller abc");
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0]);
    // Multi-byte characters straddling byte 10 never panic — the
    // field boundary is counted in characters.
    for text in [
        "2\n12345678éé0.5\nb 1.0\n",
        "2\nabcdefghié0.5\nb 1.0\n",
        "2\nMüllerxy z0.5 1.0\nb 1.0\n",
        "2\néééééééééé 0.5 1.0\nb 1.0\n",
    ] {
        let _ = parse_phylip_matrix(
            text,
            PhylipMatrixOptions {
                names: NameMode::Strict,
                ..auto()
            },
        );
    }
}

#[test]
fn too_few_taxa_is_an_error_not_a_panic() {
    // Fuzz find: a header of 0 (or 1, 2) taxa must fail through
    // `validate_input`, never in the capacity arithmetic.
    for text in ["   0   \n", "1\n lone\n", "2\n a\n b 1.0\n"] {
        assert!(
            parse_phylip_matrix(text, auto()).is_err(),
            "input {text:?} should be refused"
        );
    }
}

// ---- .meg ----------------------------------------------------------

#[test]
fn meg_lower_left() {
    let f = parse_meg_matrix(&input("meg_lower_left.meg")).expect("lower-left");
    assert_eq!(f.title.as_deref(), Some("test lower"));
    assert_eq!(f.matrix.names, ["alpha", "beta", "gamma", "delta"]);
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 4.0, 3.0, 5.0, 6.0]);
}

#[test]
fn meg_upper_right() {
    // UpperRight is the mirror layout: the same matrix, rows above the
    // diagonal, must parse to the identical `DistanceInput`.
    let upper = parse_meg_matrix(&input("meg_upper_right.meg")).expect("upper-right");
    let lower = parse_meg_matrix(&input("meg_lower_left.meg")).expect("lower-left");
    assert_eq!(upper.matrix, lower.matrix);
}

#[test]
fn meg_missing_cell_refused() {
    // `?` (and `n/c`) mark cells MEGA could not compute; NJ needs a
    // complete matrix, so the cell is named and refused.
    let err = parse_meg_matrix(&input("meg_missing.meg")).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!((row.as_str(), col.as_str()), ("c", "b"), "err: {msg}");
            assert!(msg.contains('?') || msg.contains("missing"), "{msg}");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn meg_crlf_bom() {
    let f = parse_meg_matrix(&input("meg_crlf_bom.meg")).expect("crlf+bom");
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 4.0, 3.0, 5.0, 6.0]);
}

#[test]
fn write_meg_matrix_round_trips() {
    let m = wiki5();
    let text = write_meg_matrix(&m, "wiki5").expect("write");
    // Round-3 K4: the writer emits MEGA's own layout — `!Title:` with
    // a colon, a `!Description` block, `[i] #name` labels, the
    // bracketed column header and `[i]`-prefixed rows (row 1 empty).
    assert!(text.starts_with("#mega\n!Title: wiki5;\n"), "{text}");
    assert!(
        text.contains("!Format DataType=Distance DataFormat=LowerLeft NTaxa=5;\n"),
        "{text}"
    );
    assert!(
        text.contains("!Description\n  wiki5, distance matrix written by NeoPhylo;\n"),
        "{text}"
    );
    assert!(
        text.contains("[1] #a\n[2] #b\n[3] #c\n[4] #d\n[5] #e\n"),
        "{text}"
    );
    assert!(
        text.contains("[     1     2     3     4     5 ]\n"),
        "{text}"
    );
    assert!(
        text.contains("[1]\n[2] 5\n[3] 9 10\n[4] 9 10 8\n[5] 8 9 7 3\n"),
        "{text}"
    );
    let back = parse_meg_matrix(&text).expect("re-parse");
    assert_eq!(back.matrix, m);
    assert_eq!(back.title.as_deref(), Some("wiki5"));
}

// ---- MEGA's own layout (round-3 K5) ----------------------------------

/// The owner's MEGA-GUI control file A, verbatim: MEGA's built-in
/// distance example — `[i] #name` labels, a multi-line `!Description`
/// block (containing a `[…]` span), the `[ 1 … n ]` column header
/// and `[i]`-prefixed rows, `[1]` empty.
const MEGA_LAYOUT_A: &str = "#mega\n\
     !Title: Concatenated Files;\n\
     !Format DataType=Distance DataFormat=LowerLeft NTaxa=6;\n\
     !Description\n  \
     No. of Taxa : 20\n  \
     No. of Groups : 6\n  \
     Gaps/Missing data : Pairwise Deletion\n  \
     Codon Positions : 1st+2nd+3nd+Noncoding\n  \
     Distance method : Nucleotide: Tamura-Nei  [Pairwise distances]\n  \
     No. of Sites : 1369989\n  \
     d : Estimate;\n\
     [1] #Rodent\n\
     [2] #Primate\n\
     [3] #Lagomorpha\n\
     [4] #Artiodactyla\n\
     [5] #Carnivora\n\
     [6] #Perissodactyla\n\
     [       1     2     3     4     5     6 ]\n\
     [1]        \n\
     [2]  0.514       \n\
     [3]  0.535 0.436       \n\
     [4]  0.530 0.388 0.418       \n\
     [5]  0.521 0.353 0.417 0.345       \n\
     [6]  0.500 0.331 0.402 0.327 0.349       \n";

/// The owner's control file B, verbatim: wiki5 in the same layout.
const MEGA_LAYOUT_B: &str = "#mega\n\
     !Title: wiki5_lower;\n\
     !Format DataType=Distance DataFormat=LowerLeft NTaxa=5;\n\
     !Description\n  \
     wiki5_lower, MEGA layout control;\n\
     [1] #a\n\
     [2] #b\n\
     [3] #c\n\
     [4] #d\n\
     [5] #e\n\
     [     1     2     3     4     5 ]\n\
     [1]\n\
     [2]     5\n\
     [3]     9    10\n\
     [4]     9    10     8\n\
     [5]     8     9     7     3\n";

#[test]
fn meg_mega_layout_parses() {
    let a = parse_meg_matrix(MEGA_LAYOUT_A).expect("MEGA layout A");
    assert_eq!(a.title.as_deref(), Some("Concatenated Files"));
    assert_eq!(
        a.matrix.names,
        [
            "Rodent",
            "Primate",
            "Lagomorpha",
            "Artiodactyla",
            "Carnivora",
            "Perissodactyla"
        ]
    );
    assert_eq!(
        a.matrix.lower,
        vec![
            0.514, 0.535, 0.436, 0.530, 0.388, 0.418, 0.521, 0.353, 0.417, 0.345, 0.500, 0.331,
            0.402, 0.327, 0.349
        ]
    );
    let b = parse_meg_matrix(MEGA_LAYOUT_B).expect("MEGA layout B");
    assert_eq!(b.title.as_deref(), Some("wiki5_lower"));
    assert_eq!(b.matrix, wiki5());
}

#[test]
fn meg_unterminated_bracket_comment() {
    // `[` opens a comment that never closes — a Parse error at the
    // bracket, not silently swallowed rows.
    let err = parse_meg_matrix(
        "#mega\n!Title: t;\n!Format DataType=Distance;\n[1] #a\n[2] #b\n[3] #c\n[never closed\n",
    )
    .unwrap_err();
    match err {
        NeoError::Parse { msg, .. } => assert!(msg.contains("'['"), "{msg}"),
        other => panic!("expected Parse, got {other:?}"),
    }
}

#[test]
fn meg_write_round_trip_every_oracle() {
    // Write → parse on every matrix oracle's .meg copy (round-3 K5).
    for name in [
        "additive8",
        "nj_by_hand",
        "nonadditive6",
        "real12",
        "upgma_vs_nj",
        "wiki5_lower",
        "wiki5_square",
    ] {
        let file = parse_meg_matrix(&fixture(&format!("{name}.meg")))
            .unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let title = file.title.clone().unwrap_or_else(|| name.to_string());
        let written = write_meg_matrix(&file.matrix, &title)
            .unwrap_or_else(|e| panic!("{name} write: {e:?}"));
        let back = parse_meg_matrix(&written)
            .unwrap_or_else(|e| panic!("{name} re-parse: {e:?}\n{written}"));
        assert_eq!(back.matrix, file.matrix, "{name}");
    }
}

// ---- detection ------------------------------------------------------

#[test]
fn detects_phylip_matrix() {
    assert_eq!(
        detect_matrix_format(&fixture("wiki5_square.phy")),
        Some(MatrixFormat::Phylip)
    );
    assert_eq!(
        detect_matrix_format(&fixture("wiki5_lower.phy")),
        Some(MatrixFormat::Phylip)
    );
    assert_eq!(
        detect_matrix_format("3\na 0 1\nb 1 0\nc 2 3 0\n"),
        Some(MatrixFormat::Phylip)
    );
}

#[test]
fn detects_meg_matrix() {
    assert_eq!(
        detect_matrix_format(&input("meg_lower_left.meg")),
        Some(MatrixFormat::Meg)
    );
    // Any spacing or case around DataType=Distance.
    assert_eq!(
        detect_matrix_format("#mega\n!Format DataType = distance;\n#a\n#b\n#c\n\n1\n2 3\n"),
        Some(MatrixFormat::Meg)
    );
    // MEGA's own bracketed layout (round-3 K5): the owner's control
    // files and our new writer output are all distance .meg.
    assert_eq!(detect_matrix_format(MEGA_LAYOUT_A), Some(MatrixFormat::Meg));
    assert_eq!(detect_matrix_format(MEGA_LAYOUT_B), Some(MatrixFormat::Meg));
    let written = write_meg_matrix(&wiki5(), "wiki5").expect("write");
    assert_eq!(detect_matrix_format(&written), Some(MatrixFormat::Meg));
}

#[test]
fn alignment_and_fasta_not_detected() {
    // A PHYLIP alignment header has two integers, not one.
    assert_eq!(
        detect_matrix_format("    4 6\na  ACGTAA\nb  ACGTAC\nc  ACGTAT\nd  ACGTAG\n"),
        None
    );
    assert_eq!(detect_matrix_format(">a\nACGT\n>b\nAGGT\n"), None);
    assert_eq!(detect_matrix_format("(a:1,(b:2,c:3):4);"), None);
    // A sequence .meg is not a matrix.
    assert_eq!(
        detect_matrix_format("#mega\n!Format DataType=DNA;\n#a\nACGT\n#b\nAGGT\n"),
        None
    );
    assert_eq!(detect_matrix_format(""), None);
    assert_eq!(detect_matrix_format("hello world\n"), None);
}

// ---- paste (Review Focus 1) ----------------------------------------

#[test]
fn paste_decimal_comma_asks_then_parses() {
    // `0,25` could be a decimal comma or two comma-separated cells; the
    // parser asks rather than guessing, and a decimal comma never
    // silently becomes two cells.
    let text = "A 0\nB 0,25 0\nC 0,5 0,4 0\n";
    let err = parse_pasted_matrix(text, paste_opts()).unwrap_err();
    assert_eq!(
        err,
        NeoError::MatrixAmbiguous {
            question: PasteQuestion::DecimalComma
        }
    );
    let f = parse_pasted_matrix(
        text,
        PasteOptions {
            decimal_comma: Some(true),
            ..paste_opts()
        },
    )
    .expect("decimal comma");
    assert_eq!(f.matrix.lower, vec![0.25, 0.5, 0.4]);
    // Answering "comma = separator" fails instead of silently reading
    // `0,25` as two cells and producing a different matrix.
    assert!(parse_pasted_matrix(
        text,
        PasteOptions {
            decimal_comma: Some(false),
            ..paste_opts()
        },
    )
    .is_err());
}

#[test]
fn paste_unicode_minus_refused_as_negative() {
    // PDFs emit U+2212; it is read as '-' and then refused as a
    // negative distance naming the cell.
    let err = parse_pasted_matrix("A\nB \u{2212}0.1\nC 0.2 0.3\n", paste_opts()).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!((row.as_str(), col.as_str()), ("B", "A"), "err: {msg}");
            assert!(
                msg.contains("non-negative") || msg.contains("-0.1"),
                "{msg}"
            );
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn paste_tabs_and_spaces() {
    let f = parse_pasted_matrix("A\t0  1 4\nB 1\t0\t2\nC 4  2   0\n", paste_opts())
        .expect("tabs and spaces");
    assert_eq!(f.matrix.lower, vec![1.0, 4.0, 2.0]);
    // A pasted PHYLIP file takes the PHYLIP path and asks nothing.
    let phy =
        parse_pasted_matrix("3\nA 0 1 4\nB 1 0 2\nC 4 2 0\n", paste_opts()).expect("phylip paste");
    assert_eq!(phy.matrix.lower, vec![1.0, 4.0, 2.0]);
}

#[test]
fn paste_trailing_blank_line() {
    let f = parse_pasted_matrix("A 0 1 4\nB 1 0 2\nC 4 2 0\n\n \n", paste_opts())
        .expect("trailing blanks");
    assert_eq!(f.matrix.lower, vec![1.0, 4.0, 2.0]);
}

#[test]
fn paste_header_row() {
    // A spreadsheet square with a header row of names: the header's
    // tokens equal the first column, settling both questions.
    let f = parse_pasted_matrix(" A B C\nA 0 1 4\nB 1 0 2\nC 4 2 0\n", paste_opts())
        .expect("header row");
    assert_eq!(f.matrix.names, ["A", "B", "C"]);
    assert_eq!(f.matrix.lower, vec![1.0, 4.0, 2.0]);
}

#[test]
fn paste_square_blank_upper() {
    // A square layout with the upper triangle left blank: name column
    // plus diagonal.
    let f = parse_pasted_matrix("A B C\nA 0\nB 1 0\nC 2 3 0\n", paste_opts()).expect("blank upper");
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0]);
}

#[test]
fn paste_no_names_asks() {
    // All-numeric rows genuinely admit two readings: a first column of
    // (numeric) names over a strict lower triangle, or no names over a
    // lower+diagonal block.
    let text = "0\n1 0\n2 3 0\n";
    let err = parse_pasted_matrix(text, paste_opts()).unwrap_err();
    assert_eq!(
        err,
        NeoError::MatrixAmbiguous {
            question: PasteQuestion::FirstColumnNames
        }
    );
    let no_names = parse_pasted_matrix(
        text,
        PasteOptions {
            first_column_names: Some(false),
            ..paste_opts()
        },
    )
    .expect("no name column");
    assert_eq!(no_names.matrix.names, ["A", "B", "C"], "generated names");
    assert_eq!(no_names.matrix.lower, vec![1.0, 2.0, 3.0]);
    let names = parse_pasted_matrix(
        text,
        PasteOptions {
            first_column_names: Some(true),
            ..paste_opts()
        },
    )
    .expect("name column");
    assert_eq!(names.matrix.names, ["0", "1", "2"]);
    // With a name column the rows are strict-lower: taxon "1" sits 0
    // from "0", taxon "2" sits 3 from "0" and 0 from "1".
    assert_eq!(names.matrix.lower, vec![0.0, 3.0, 0.0]);
}

#[test]
fn paste_tab_names_with_spaces() {
    // A spreadsheet copy is tab-separated in every line, so cells
    // split on tabs only and names may contain spaces (Review Focus
    // 1).
    let text = "Homo sapiens\t0\nPan troglodytes\t1\t0\nGorilla gorilla\t2\t3\t0\n";
    let f = parse_pasted_matrix(text, paste_opts()).expect("tab-separated names");
    assert_eq!(
        f.matrix.names,
        ["Homo sapiens", "Pan troglodytes", "Gorilla gorilla"]
    );
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0]);
}

#[test]
fn paste_tab_header_names_with_spaces() {
    // A tab-separated square table with a header row whose names
    // contain spaces: the header's cells equal the first column.
    let text = "\tHomo sapiens\tPan troglodytes\tGorilla gorilla\n\
                Homo sapiens\t0\t1\t2\n\
                Pan troglodytes\t1\t0\t3\n\
                Gorilla gorilla\t2\t3\t0\n";
    let f = parse_pasted_matrix(text, paste_opts()).expect("tab header row");
    assert_eq!(
        f.matrix.names,
        ["Homo sapiens", "Pan troglodytes", "Gorilla gorilla"]
    );
    assert_eq!(f.matrix.lower, vec![1.0, 2.0, 3.0]);
}
