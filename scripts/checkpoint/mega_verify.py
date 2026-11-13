#!/usr/bin/env python3
"""Release checkpoint: run MEGA-CC on .meg files NeoPhylo exported from the
deploy preview and compare MEGA's output with the committed MEGA fixtures.

    python3 -I scripts/checkpoint/mega_verify.py --meg-dir <dir> [--boot] \
        [--report <file.md>]

<dir> holds <id>.meg for the handout datasets (primate-mtdna, globins,
16s-rrna) — scripts/checkpoint/browser.sh saves them to <out>/meg/. For
each file:

  1. the exported alignment equals web/public/library/<id>.fasta
     (names, order, every character);
  2. every distance run in fixtures/mega/library/<id>.json (all models x
     pairwise/complete/partial95) gives the same matrix, cell for cell at
     MEGA's printed 8 decimals, and MEGA's `No. of Sites` equals the kept
     count computed independently from the FASTA;
  3. every NJ and UPGMA tree has the same clades and the same branch
     lengths (within half a unit of each fixture value's printed last
     decimal). A UPGMA difference on globins is reported as a TIE warning
     (exact three-way HBA tie, docs/checkpoints/v1.4b-release.md §2);
  4. with --boot, the 1,000-replicate NJ bootstrap runs in
     fixtures/mega/library/boot1000/ recover the same split set and every
     support within 5 percentage points (owner ruling on #126, option A).
     This takes several minutes.

It also runs the same comparisons against a deliberately wrong fixture key
(negative controls) and fails if those do not fail.

MEGA-CC is closed-source and local only; this script never runs in CI.
Exit status: 0 all pass, 1 any failure, 2 setup problem.
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
MAO = os.path.join(REPO, "fixtures", "mega", "mao")
LIB_FIX = os.path.join(REPO, "fixtures", "mega", "library")
LIB_DATA = os.path.join(REPO, "web", "public", "library")

DATASETS = {"primate-mtdna": "dna", "globins": "protein", "16s-rrna": "dna"}
MODEL_ID = {"p": "p", "JC69": "jc69", "K80": "k2p", "Poisson": "poisson",
            "JTT": "jtt"}
DNA_OK = set("ACGT")
AA_OK = set("ARNDCQEGHILKMFPSTWYV")
EXPECTED_16S_SITES = {"pairwise": 1628, "complete": 1199, "partial95": 1294}

results = []  # (status, check, detail)


def record(status, check, detail=""):
    results.append((status, check, detail))
    mark = {"PASS": "ok  ", "FAIL": "FAIL", "WARN": "warn"}[status]
    print(f"[{mark}] {check}{(' — ' + detail) if detail else ''}", flush=True)


# ------------------------------------------------------------ inputs
def read_fasta(path):
    seqs = []
    for ln in open(path):
        ln = ln.strip()
        if not ln:
            continue
        if ln.startswith(">"):
            seqs.append([ln[1:], ""])
        else:
            seqs[-1][1] += ln.upper()
    return seqs


def read_meg_alignment(path):
    """Sequential or interleaved #name blocks after the header."""
    seqs, order = {}, []
    cur = None
    for ln in open(path, encoding="utf-8-sig"):
        ln = ln.strip()
        if not ln or ln.startswith("!") or ln.lower() == "#mega":
            continue
        if ln.startswith("#"):
            parts = ln[1:].split(None, 1)
            cur = parts[0]
            if cur not in seqs:
                seqs[cur] = ""
                order.append(cur)
            if len(parts) > 1:
                seqs[cur] += re.sub(r"\s+", "", parts[1]).upper()
        elif cur is not None:
            seqs[cur] += re.sub(r"\s+", "", ln).upper()
    return [[n, seqs[n]] for n in order]


def kept_sites(seqs, alphabet, filt):
    ok = DNA_OK if alphabet == "dna" else AA_OK
    n, length = len(seqs), len(seqs[0][1])
    if filt == "pairwise":
        return length
    kept = 0
    for k in range(length):
        present = sum(1 for _, s in seqs if s[k] in ok)
        kept += present == n if filt == "complete" else present * 100 >= 95 * n
    return kept


# ------------------------------------------------------------ megacc
def run_megacc(mao, data, outbase, tmp):
    for ext in (".meg", ".nwk", "_consensus.nwk", "_partitions.txt",
                "_summary.txt"):
        if os.path.exists(outbase + ext):
            os.remove(outbase + ext)
    subprocess.run(["megacc", "-a", mao, "-d", data, "-o", outbase],
                   cwd=tmp, check=False, capture_output=True, text=True)
    summary_path = outbase + "_summary.txt"
    if not os.path.exists(summary_path):
        return None, f"megacc wrote no summary ({os.path.basename(mao)})"
    summary = open(summary_path, errors="replace").read()
    for ln in summary.splitlines():
        if "Error:" in ln:
            return None, ln.strip()
    return summary, None


def sites_in(text):
    m = re.search(r"No\. of Sites\s*=\s*([\d,]+)", text)
    return int(m.group(1).replace(",", "")) if m else None


def parse_meg_matrix(path):
    txt = open(path, errors="replace").read()
    labels = re.findall(r"\[ *\d+\][ \t]+#(\S+)", txt)
    n = len(labels)
    mat = [[0.0 if i == j else None for j in range(n)] for i in range(n)]
    for row in re.finditer(r"^\[ *(\d+)\][ \t]+(.*?)[ \t]*$", txt, re.M):
        i = int(row.group(1)) - 1
        toks = row.group(2).split()
        if i == 0 or len(toks) >= n:
            continue
        for j, tok in enumerate(toks[:i]):
            if tok.lower() == "n/c":
                mat[i][j] = mat[j][i] = None
            else:
                try:
                    mat[i][j] = mat[j][i] = float(tok)
                except ValueError:
                    pass
    return labels, mat


# ------------------------------------------------------------ newick
def parse_newick(text):
    """Return (leaves, {clade key: length string}, {clade key: label}).
    Clade key = sorted leaf names joined by '|'; leaves are clades too."""
    s = text.strip()
    pos = 0
    lengths, labels = {}, {}

    def token(pattern):
        nonlocal pos
        m = re.match(pattern, s[pos:])
        if not m:
            return None
        pos += len(m.group(0))
        return m.group(0)

    def clade():
        nonlocal pos
        if s[pos] == "(":
            pos += 1
            leaves = set()
            while True:
                leaves |= clade()
                if s[pos] == ",":
                    pos += 1
                elif s[pos] == ")":
                    pos += 1
                    break
                else:
                    raise ValueError(f"unexpected {s[pos]!r} at {pos}")
            lab = token(r"[^:,();\s]+")
        else:
            name = token(r"[^:(),;\s]+")
            if name is None:
                raise ValueError(f"no leaf name at {pos}")
            leaves = {name}
            lab = None
        key = "|".join(sorted(leaves))
        if pos < len(s) and s[pos] == ":":
            pos += 1
            lengths[key] = token(r"[^,);\s]+")
        if lab is not None:
            labels[key] = lab
        return leaves

    leaves = clade()
    root = "|".join(sorted(leaves))
    lengths.pop(root, None)
    labels.pop(root, None)
    return leaves, lengths, labels


def half_ulp(tok):
    dec = len(tok.split(".")[1]) if "." in tok else 0
    return 0.5 * 10 ** -dec + 1e-15


def compare_trees(got_text, want_text):
    """None when equal, else a short reason."""
    if got_text.strip() == want_text.strip():
        return None
    g_leaves, g_len, _ = parse_newick(got_text)
    w_leaves, w_len, _ = parse_newick(want_text)
    if g_leaves != w_leaves:
        return "different leaf sets"
    if set(g_len) != set(w_len):
        miss = sorted(set(w_len) - set(g_len))
        return f"{len(miss)} fixture clade(s) missing, e.g. {miss[:1]}"
    worst = 0.0
    for k, w in w_len.items():
        d = abs(float(g_len[k]) - float(w))
        if d > half_ulp(w):
            return f"branch {k[:60]} length {g_len[k]} vs {w}"
        worst = max(worst, d)
    return None


def canon_support(nwk_text, first_label):
    """{canonical split key: percent} from a bootstrap .nwk (BCL labels as
    proportions). Canonical side = the side without the first label."""
    leaves, _, labels = parse_newick(nwk_text)
    out = {}
    for key, lab in labels.items():
        side = set(key.split("|"))
        canon = leaves - side if first_label in side else side
        try:
            out["|".join(sorted(canon))] = round(float(lab) * 100, 1)
        except ValueError:
            pass
    return out


# ------------------------------------------------------------ checks
def check_dataset(ds, alphabet, meg_path, tmp, boot):
    fx = json.load(open(os.path.join(LIB_FIX, f"{ds}.json")))
    fasta = read_fasta(os.path.join(LIB_DATA, f"{ds}.fasta"))
    alpha_dir = "dna" if alphabet == "dna" else "protein"

    # 1. the exported alignment is the library alignment
    meg = read_meg_alignment(meg_path)
    if [n for n, _ in meg] != [n for n, _ in fasta]:
        record("FAIL", f"{ds}: exported names/order", "differ from the FASTA")
    elif any(a[1] != b[1] for a, b in zip(meg, fasta)):
        bad = next(a[0] for a, b in zip(meg, fasta) if a[1] != b[1])
        record("FAIL", f"{ds}: exported sequences", f"{bad} differs")
    else:
        record("PASS", f"{ds}: exported .meg equals the library FASTA",
               f"{len(meg)} taxa × {len(meg[0][1])} sites")

    # 2. distances + site counts
    matrices = {}
    for key, want in fx["distances"].items():
        model, filt = key.split("/")
        mao = os.path.join(MAO, f"dist_{alpha_dir}_{MODEL_ID[model]}_{filt}.mao")
        out = os.path.join(tmp, f"{ds}_{model}_{filt}_d")
        summary, err = run_megacc(mao, meg_path, out, tmp)
        if err or not os.path.exists(out + ".meg"):
            record("FAIL", f"{ds} dist {key}", err or "no matrix written")
            continue
        text = open(out + ".meg", errors="replace").read()
        want_sites = kept_sites(fasta, alphabet, filt)
        got_sites = sites_in(text) or sites_in(summary)
        if got_sites != want_sites:
            record("FAIL", f"{ds} {key}: No. of Sites",
                   f"MEGA {got_sites}, FASTA oracle {want_sites}")
        if ds == "16s-rrna" and model == "K80" and \
                got_sites != EXPECTED_16S_SITES[filt]:
            record("FAIL", f"16s-rrna {filt}: No. of Sites",
                   f"{got_sites} != checkpoint value {EXPECTED_16S_SITES[filt]}")
        labels, mat = parse_meg_matrix(out + ".meg")
        matrices[key] = (labels, mat)
        n = len(want["labels"])
        cells = n * (n - 1) // 2
        if labels != want["labels"]:
            record("FAIL", f"{ds} dist {key}", "labels differ")
            continue
        bad = [(i, j) for i in range(n) for j in range(i)
               if not cell_equal(mat[i][j], want["matrix"][i][j])]
        if bad:
            i, j = bad[0]
            record("FAIL", f"{ds} dist {key}",
                   f"{cells - len(bad)}/{cells} cells equal; first "
                   f"{labels[i]}–{labels[j]}: {mat[i][j]} vs "
                   f"{want['matrix'][i][j]}")
        else:
            record("PASS", f"{ds} dist {key}",
                   f"{cells}/{cells} cells, No. of Sites {got_sites:,}")

    # negative control: a wrong key must not match
    keys = list(fx["distances"])
    if len(keys) >= 2 and keys[0] in matrices:
        labels, mat = matrices[keys[0]]
        other = fx["distances"][keys[1]]["matrix"]
        n = len(labels)
        same = all(cell_equal(mat[i][j], other[i][j])
                   for i in range(n) for j in range(i))
        record("FAIL" if same else "PASS",
               f"{ds} negative control ({keys[0]} vs fixture {keys[1]})",
               "matched — the comparison is not discriminating" if same
               else "differs, as it should")

    # 3. trees
    for key, want in fx["trees"].items():
        method, model, filt = key.split("/")
        mao = os.path.join(MAO, f"{method}_{alpha_dir}_{MODEL_ID[model]}_{filt}.mao")
        out = os.path.join(tmp, f"{ds}_{method}_{model}_{filt}")
        _, err = run_megacc(mao, meg_path, out, tmp)
        if err or not os.path.exists(out + ".nwk"):
            record("FAIL", f"{ds} {key}", err or "no tree written")
            continue
        try:
            why = compare_trees(open(out + ".nwk").read(), want)
        except ValueError as e:
            why = f"unparseable newick: {e}"
        if why is None:
            record("PASS", f"{ds} {key}", "same clades and branch lengths")
        elif ds == "globins" and method == "upgma":
            record("WARN", f"{ds} {key}",
                   f"TIE — {why}; acceptable only via the HBA three-way tie "
                   "(checkpoint §2); look at it")
        else:
            record("FAIL", f"{ds} {key}", why)

    # 4. bootstrap ×1000
    if not boot:
        return
    bfx_path = os.path.join(LIB_FIX, "boot1000", f"{ds}.json")
    if not os.path.exists(bfx_path):
        return
    bfx = json.load(open(bfx_path))
    first = fasta[0][0]
    for key, block in bfx["bootstrap"].items():
        _, model, filt = key.split("/")
        mao = os.path.join(MAO, f"njboot1000_{alpha_dir}_{MODEL_ID[model]}_{filt}.mao")
        out = os.path.join(tmp, f"{ds}_boot1000_{model}_{filt}")
        print(f"… {ds} bootstrap ×1000 {key} (slow)", flush=True)
        _, err = run_megacc(mao, meg_path, out, tmp)
        if err or not os.path.exists(out + ".nwk"):
            record("FAIL", f"{ds} boot1000 {key}", err or "no tree written")
            continue
        got = canon_support(open(out + ".nwk").read(), first)
        want = block["support"]
        if set(got) != set(want):
            record("FAIL", f"{ds} boot1000 {key}", "split set differs")
            continue
        worst = max(abs(got[k] - want[k]) for k in want)
        record("PASS" if worst <= 5 else "FAIL", f"{ds} boot1000 {key}",
               f"{len(want)} splits, largest support gap {worst:.1f} pp (≤ 5)")


def cell_equal(a, b):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= 0.5e-8 + 1e-12


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--meg-dir", required=True)
    ap.add_argument("--boot", action="store_true",
                    help="also run the 1,000-replicate bootstraps (slow)")
    ap.add_argument("--report", help="write a Markdown summary here")
    args = ap.parse_args()

    if shutil.which("megacc") is None:
        print("megacc is not on PATH (MEGA-CC 12.1.4)", file=sys.stderr)
        return 2
    ver = subprocess.run(["megacc", "-v"], capture_output=True, text=True)
    print((ver.stdout or ver.stderr).strip().splitlines()[0:1] or "megacc")

    found = 0
    with tempfile.TemporaryDirectory(prefix="mega-verify-") as tmp:
        for ds, alphabet in DATASETS.items():
            meg = os.path.join(args.meg_dir, f"{ds}.meg")
            if not os.path.exists(meg):
                record("FAIL", f"{ds}: {meg} missing")
                continue
            found += 1
            check_dataset(ds, alphabet, os.path.abspath(meg), tmp, args.boot)

    fails = sum(1 for r in results if r[0] == "FAIL")
    warns = sum(1 for r in results if r[0] == "WARN")
    passes = sum(1 for r in results if r[0] == "PASS")
    print(f"\nMEGA-CC verification: {passes} pass, {warns} warn, {fails} fail")
    if args.report:
        with open(args.report, "w") as f:
            f.write("## MEGA-CC on the exported .meg files\n\n")
            f.write(f"{passes} pass · {warns} warn · {fails} fail"
                    f"{' · bootstrap ×1000 included' if args.boot else ' · bootstrap skipped (run with --boot)'}\n\n")
            f.write("| | Check | Detail |\n|---|---|---|\n")
            for st, check, detail in results:
                icon = {"PASS": "✅", "WARN": "⚠️", "FAIL": "❌"}[st]
                f.write(f"| {icon} | {check} | {detail.replace('|', '¦')} |\n")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
