#!/usr/bin/env python3
"""Build the NeoPhylo data library (v1.4b plan, task 8; spec §5.2).

Reads one committed accession list per dataset from
``scripts/data/accessions/<id>.txt``, fetches the sequences once from
NCBI E-utilities or the UniProt REST API, aligns them with the pinned
MAFFT build, trims to the size caps (30 taxa, 2,000 sites) and writes
``web/public/library/<id>.fasta``, ``<id>.json`` (provenance) and
``index.json``.

This script is run by a person — CI never runs it and the browser never
fetches sequence data (spec §5.2). It needs network access to NCBI and
UniProt, the pinned MAFFT on ``PATH``, and the eutils ``tool``/``email``
parameters from the ``NCBI_TOOL``/``NCBI_EMAIL`` environment variables
(never committed).

Accession-list format::

    # key: value            dataset metadata (see META below)
    # free comments         dataset-choice reasons live here
    <accession> <label> [slice]

``slice`` is optional:

* ``<start>-<end>``       1-based inclusive genomic range
                          (efetch seq_start/seq_stop)
* ``gene:<name>:<a>-<b>`` codons <a>..<b> of the CDS annotated
                          ``/gene="<name>"`` — robust to indels
                          upstream of the slice (used for the
                          SARS-CoV-2 spike RBD)

Labels must match ``^[^\\s"]+$`` and be unique per dataset: the
``.meg`` writer turns whitespace into ``_`` and ``parse_meg`` keeps
names literally, so anything else would not round-trip.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ACCESSIONS_DIR = REPO_ROOT / "scripts" / "data" / "accessions"
OUT_DIR = REPO_ROOT / "web" / "public" / "library"

PINNED_MAFFT = "7.525"
MAFFT_ARGS = "--auto"
MAX_TAXA = 30
MAX_SITES = 2000

LABEL_RE = re.compile(r'^[^\s"]+$')
NCBI_EFETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi"
UNIPROT_FASTA = "https://rest.uniprot.org/uniprotkb/{acc}.fasta"

SOURCES = {
    "uniprot": "UniProtKB",
    "ncbi-nucleotide": "NCBI Nucleotide",
    "ncbi-protein": "NCBI Protein",
}
NCBI_DBS = {"ncbi-nucleotide": "nuccore", "ncbi-protein": "protein"}

META_KEYS = ("id", "title", "alphabet", "source", "license", "citation", "good_for")


class BuildError(Exception):
    pass


def eutils_params() -> dict[str, str]:
    """efetch tool/email, read from the environment (never committed)."""
    tool = os.environ.get("NCBI_TOOL")
    email = os.environ.get("NCBI_EMAIL")
    if not tool or not email:
        raise BuildError(
            "NCBI fetch needs NCBI_TOOL and NCBI_EMAIL in the environment "
            "(efetch tool/email parameters; never committed)."
        )
    return {"tool": tool, "email": email}


def http_get(url: str) -> bytes:
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 — retry, then fail loudly
            if attempt == 3:
                raise BuildError(f"fetch failed after retries: {url}\n{e}")
            time.sleep(2 * (attempt + 1))
    raise AssertionError("unreachable")


def parse_fasta_bytes(data: bytes) -> str:
    seq = []
    for line in data.decode("utf-8").splitlines():
        if line.startswith(">") or not line.strip():
            continue
        seq.append(line.strip())
    return "".join(seq)


def parse_accession_file(path: Path) -> tuple[dict[str, str], list[tuple[str, str, str | None]]]:
    meta: dict[str, str] = {}
    entries: list[tuple[str, str, str | None]] = []
    labels: set[str] = set()
    for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            m = re.match(r"#\s*([a-z_]+)\s*:\s*(.+)$", line)
            if m and m.group(1) in META_KEYS:
                meta[m.group(1)] = m.group(2).strip()
            continue
        fields = line.split()
        if len(fields) not in (2, 3):
            raise BuildError(
                f"{path}:{lineno}: expected '<accession> <label> [slice]', "
                f"got {len(fields)} fields"
            )
        acc, label = fields[0], fields[1]
        slc = fields[2] if len(fields) == 3 else None
        if not LABEL_RE.match(label):
            raise BuildError(
                f"{path}:{lineno}: label {label!r} must match ^[^\\s\"]+$ "
                "(no whitespace, no double quote — .meg round-trip)"
            )
        if label in labels:
            raise BuildError(f"{path}:{lineno}: duplicate label {label!r}")
        labels.add(label)
        if slc is not None and not (
            re.fullmatch(r"\d+-\d+", slc)
            or re.fullmatch(r"gene:[A-Za-z0-9_.-]+:\d+-\d+", slc)
        ):
            raise BuildError(f"{path}:{lineno}: bad slice {slc!r}")
        entries.append((acc, label, slc))
    missing = [k for k in META_KEYS if k not in meta]
    if missing:
        raise BuildError(f"{path}: missing '# {missing[0]}:' header")
    if meta["id"] != path.stem:
        raise BuildError(f"{path}: '# id: {meta['id']}' does not match filename {path.stem}")
    if meta["alphabet"] not in ("dna", "protein"):
        raise BuildError(f"{path}: alphabet must be dna|protein")
    if meta["source"] not in SOURCES:
        raise BuildError(f"{path}: source must be one of {sorted(SOURCES)}")
    if not entries:
        raise BuildError(f"{path}: no accessions")
    return meta, entries


def mafft_version() -> str:
    proc = subprocess.run(
        ["mafft", "--version"], capture_output=True, text=True
    )
    out = proc.stdout + proc.stderr
    m = re.search(r"v(\d+\.\d+)", out)
    if not m:
        raise BuildError(f"cannot parse 'mafft --version' output:\n{out.strip()}")
    return m.group(1)


def fetch_uniprot(acc: str) -> str:
    data = http_get(UNIPROT_FASTA.format(acc=acc))
    seq = parse_fasta_bytes(data)
    if not seq:
        raise BuildError(f"UniProt fetch for {acc} returned no sequence")
    return seq


def cds_span(genbank: str, gene: str, acc: str) -> tuple[int, int]:
    """start..end (1-based inclusive) of the CDS annotated /gene="<gene>"."""
    for m in re.finditer(
        r"^     CDS\s+(<?)(\d+)\.\.(>?)(\d+)\n((?:                     .*\n?)*)",
        genbank,
        re.M,
    ):
        if f'/gene="{gene}"' in m.group(5):
            if m.group(1) or m.group(3):
                print(
                    f"  warning: {acc} {gene} CDS has a fuzzy boundary "
                    f"({m.group(1)}{m.group(2)}..{m.group(3)}{m.group(4)})",
                    file=sys.stderr,
                )
            return int(m.group(2)), int(m.group(4))
    raise BuildError(f"{acc}: no CDS with /gene=\"{gene}\" in the GenBank record")


def fetch_ncbi(acc: str, db: str, slc: str | None) -> str:
    params = eutils_params()
    base = f"{NCBI_EFETCH}?db={db}&id={acc}&tool={params['tool']}&email={params['email']}"
    if slc is None:
        data = http_get(f"{base}&rettype=fasta&retmode=text")
        seq = parse_fasta_bytes(data)
    elif re.fullmatch(r"\d+-\d+", slc):
        start, end = slc.split("-")
        data = http_get(
            f"{base}&rettype=fasta&retmode=text&seq_start={start}&seq_stop={end}"
        )
        seq = parse_fasta_bytes(data)
    else:
        gene, span = slc[5:].split(":")
        a, b = (int(x) for x in span.split("-"))
        time.sleep(0.4)  # ~3 req/s without an api_key
        gb = http_get(f"{base}&rettype=gb&retmode=text").decode("utf-8")
        start, end = cds_span(gb, gene, acc)
        data = http_get(
            f"{base}&rettype=fasta&retmode=text&seq_start={start}&seq_stop={end}"
        )
        cds = parse_fasta_bytes(data)
        seq = cds[(a - 1) * 3 : b * 3]
        if len(seq) != (b - a + 1) * 3:
            raise BuildError(
                f"{acc}: codon slice {gene}:{a}-{b} gave {len(seq)} nt "
                f"(CDS has {len(cds)} nt — fuzzy CDS boundary?)"
            )
    if not seq:
        raise BuildError(f"NCBI fetch for {acc} ({slc or 'full'}) returned no sequence")
    time.sleep(0.4)
    return seq


def write_fasta(aligned: list[tuple[str, str]], path: Path) -> None:
    lines = []
    for label, seq in aligned:
        lines.append(f">{label}")
        lines.extend(seq[i : i + 80] for i in range(0, len(seq), 80))
    path.write_text("\n".join(lines) + "\n")


def build_one(path: Path) -> dict:
    meta, entries = parse_accession_file(path)
    ds_id, source = meta["id"], meta["source"]
    print(f"== {ds_id}: {len(entries)} accessions from {source}")

    seqs: list[tuple[str, str, str]] = []  # (acc, label, seq)
    for acc, label, slc in entries:
        if source == "uniprot":
            seq = fetch_uniprot(acc)
            time.sleep(0.3)
        else:
            seq = fetch_ncbi(acc, NCBI_DBS[source], slc)
        print(f"   {acc} -> {label} ({len(seq)} residues)")
        seqs.append((acc, label, seq))

    if len(seqs) > MAX_TAXA:
        print(f"   warning: {len(seqs)} taxa > {MAX_TAXA}; trimming", file=sys.stderr)
        seqs = seqs[:MAX_TAXA]

    unaligned = OUT_DIR / ".scratch_unaligned.fasta"
    with unaligned.open("w") as fh:
        for _, label, seq in seqs:
            fh.write(f">{label}\n{seq}\n")
    # MAFFT writes nucleotides lowercase by default (no --preservecase),
    # which is why the DNA FASTAs are lowercase.
    proc = subprocess.run(
        ["mafft", "--auto", str(unaligned)],
        capture_output=True,
        text=True,
    )
    unaligned.unlink()
    if proc.returncode != 0:
        raise BuildError(f"mafft failed:\n{proc.stderr[-2000:]}")

    aligned: list[tuple[str, str]] = []
    cur_label, cur_seq = None, []
    for line in proc.stdout.splitlines():
        if line.startswith(">"):
            if cur_label is not None:
                aligned.append((cur_label, "".join(cur_seq)))
            cur_label, cur_seq = line[1:].strip(), []
        elif line.strip():
            cur_seq.append(line.strip())
    if cur_label is not None:
        aligned.append((cur_label, "".join(cur_seq)))
    if len(aligned) != len(seqs):
        raise BuildError(f"mafft output has {len(aligned)} seqs, expected {len(seqs)}")
    by_label = {label: seq for _, label, seq in seqs}
    for label, _ in aligned:
        if label not in by_label:
            raise BuildError(f"mafft returned an unexpected label {label!r}")
    # restore the accession-file order (mafft may reorder)
    aligned = [(label, dict(aligned)[label]) for _, label, _ in seqs]

    sites = len(aligned[0][1])
    if sites > MAX_SITES:
        print(f"   warning: {sites} sites > {MAX_SITES}; trimming", file=sys.stderr)
        aligned = [(l, s[:MAX_SITES]) for l, s in aligned]
        sites = MAX_SITES

    fasta_path = OUT_DIR / f"{ds_id}.fasta"
    write_fasta(aligned, fasta_path)
    sha = hashlib.sha256(fasta_path.read_bytes()).hexdigest()

    prov = {
        "id": ds_id,
        "title": meta["title"],
        "accessions": [
            {"accession": acc, "label": label} for acc, label, _ in seqs
        ],
        "source": SOURCES[source],
        "retrieved": time.strftime("%Y-%m-%d", time.gmtime()),
        "license": meta["license"],
        "citation": meta["citation"],
        "aligner": {"name": "MAFFT", "version": PINNED_MAFFT, "args": MAFFT_ARGS},
        "sha256": sha,
    }
    (OUT_DIR / f"{ds_id}.json").write_text(json.dumps(prov, indent=2) + "\n")
    print(f"   -> {len(aligned)} taxa x {sites} sites, sha256 {sha[:12]}…")
    return {
        "id": ds_id,
        "title": meta["title"],
        "alphabet": meta["alphabet"],
        "taxa": len(aligned),
        "sites": sites,
        "good_for": meta["good_for"],
        "license": meta["license"],
        "provenance": f"{ds_id}.json",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only", help="build just this dataset id")
    args = ap.parse_args()

    ver = mafft_version()
    if ver != PINNED_MAFFT:
        raise BuildError(
            f"pinned MAFFT is {PINNED_MAFFT}, PATH has {ver}; refusing to run"
        )
    print(f"mafft {ver} (pinned)")

    files = sorted(ACCESSIONS_DIR.glob("*.txt"))
    if args.only:
        files = [f for f in files if f.stem == args.only]
        if not files:
            raise BuildError(f"no accession file for id {args.only!r}")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index_path = OUT_DIR / "index.json"
    index: dict[str, dict] = {}
    if index_path.exists():
        index = {e["id"]: e for e in json.loads(index_path.read_text())}
    for f in files:
        entry = build_one(f)
        index[entry["id"]] = entry
    index_path.write_text(
        json.dumps([index[k] for k in sorted(index)], indent=2) + "\n"
    )
    print(f"wrote {index_path}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BuildError as e:
        print(f"error: {e}", file=sys.stderr)
        sys.exit(1)
