//! Export a FASTA alignment as MEGA `.meg`, using only
//! `neophylo_core::{parse_fasta, write_meg}`. Used by
//! `fixtures/generate_mega.sh` to produce the round-trip `.meg` inputs;
//! it does no science itself.

use std::env;
use std::fs;
use std::process::ExitCode;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: write_meg <in.fasta> <out.meg> <title>");
        return ExitCode::FAILURE;
    }
    let text = match fs::read_to_string(&args[1]) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("{}: {e}", args[1]);
            return ExitCode::FAILURE;
        }
    };
    let aln = match neophylo_core::parse_fasta(&text) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("{}: {e:?}", args[1]);
            return ExitCode::FAILURE;
        }
    };
    let meg = match neophylo_core::write_meg(&aln, &args[3]) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("write_meg: {e:?}");
            return ExitCode::FAILURE;
        }
    };
    match fs::write(&args[2], meg) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{}: {e}", args[2]);
            ExitCode::FAILURE
        }
    }
}
