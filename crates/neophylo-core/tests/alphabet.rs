use neophylo_core::alphabet::{with_alphabet, Alphabet};
use neophylo_core::dist::{compute, Cell, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};

#[test]
fn detects_protein() {
    let aln = parse_fasta(">a\nMKV\n>b\nMKI\n>c\nMRV\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
}

#[test]
fn detects_dna() {
    let aln = parse_fasta(">a\nACGTN-\n>b\nACGTN-\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Dna);
}

#[test]
fn detection_threshold() {
    // Exactly 90% ACGTUN is DNA: 'W' is a protein state and an IUPAC
    // ambiguity code, but counts for neither in the 90% test.
    let aln = parse_fasta(">a\nACGTACGTAW\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Dna);
    // 80% is protein.
    let aln = parse_fasta(">a\nACGTACGTWS\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
}

#[test]
fn dna_looking_protein() {
    // The protdist documentation sequences happen to be DNA-lookalikes;
    // detection says Dna but the protein override must accept them.
    let fasta = ">Alpha\nAACGTGGCCACAT\n\
                 >Beta\nAAGGTCGCCACAC\n\
                 >Gamma\nCAGTTCGCCACAA\n\
                 >Delta\nGAGATTTCCGCCT\n\
                 >Epsilon\nGAGATCTCCGCCC\n";
    let aln = parse_fasta(fasta).unwrap();
    assert_eq!(aln.alphabet, Alphabet::Dna);
    let aln = with_alphabet(aln, Alphabet::Protein).unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    assert_eq!(aln.seqs[0], b"AACGTGGCCACAT");
}

#[test]
fn translated_with_stops() {
    // Review Focus 4: lowercase proteins with a trailing stop codon parse
    // as protein, and '*' is missing data under pairwise deletion.
    let aln = parse_fasta(">a\nmkvl*\n>b\nmkil*\n>c\nmrvl*\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    assert_eq!(aln.seqs[0], b"MKVL*");
    let dm = compute(&aln, DistModel::P).unwrap();
    // 4 comparable sites per pair: a–b differ in 1 (K/I), a–c in 1 (K/R),
    // b–c in 2 (K/R, I/V). '*' comparable would give 0.2/0.2/0.4.
    assert_eq!(dm.cells[1], Cell::Value(0.25));
    assert_eq!(dm.cells[2], Cell::Value(0.25));
    assert_eq!(dm.cells[5], Cell::Value(0.5));
}

#[test]
fn with_alphabet_rejects() {
    let aln = parse_fasta(">a\nMKV\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    let err = with_alphabet(aln, Alphabet::Dna).unwrap_err();
    assert_eq!(
        err,
        NeoError::UnsupportedCharacter {
            label: "a".to_string(),
            position: 0,
            ch: 'M',
        }
    );
}

#[test]
fn protein_p() {
    let aln = parse_fasta(">a\nMKVLA\n>b\nMKVLG\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    let dm = compute(&aln, DistModel::P).unwrap();
    assert_eq!(dm.cells[1], Cell::Value(0.2));

    // 'X' is missing: 4 comparable sites, p = 0.25.
    let aln = parse_fasta(">a\nXKVLA\n>b\nMKVLG\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    let dm = compute(&aln, DistModel::P).unwrap();
    assert_eq!(dm.cells[1], Cell::Value(0.25));
}

#[test]
fn mismatch() {
    let aln = parse_fasta(">a\nMKVL\n>b\nMKIL\n").unwrap();
    for model in [DistModel::Jc69, DistModel::K80] {
        let name = match model {
            DistModel::Jc69 => "JC69",
            _ => "K80",
        };
        assert_eq!(
            compute(&aln, model).unwrap_err(),
            NeoError::ModelAlphabetMismatch {
                model: name.to_string(),
                alphabet: Alphabet::Protein,
            }
        );
    }
}

#[test]
fn serde_default() {
    // v1 Alignment JSON has no `alphabet` field and must load as Dna.
    let aln: Alignment =
        serde_json::from_str(r#"{"labels":["a"],"seqs":[[65,67,71,84]]}"#).unwrap();
    assert_eq!(aln.alphabet, Alphabet::Dna);
}
