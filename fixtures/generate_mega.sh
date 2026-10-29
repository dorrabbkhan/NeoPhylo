#!/usr/bin/env bash
# generate_mega.sh — produce MEGA-CC reference fixtures for NeoPhylo.
#
# LOCAL ONLY. MEGA-CC (megacc) is closed-source, is never installed in CI,
# and this script is never called from scripts/ci/, generate.R or
# generate_phylip.sh. It runs megacc with the committed .mao files in
# fixtures/mega/mao/ on every DNA input in fixtures/inputs/*.fasta and
# every protein input in fixtures/inputs/protein/*.fasta, then parses
# MEGA's distance matrices (.meg) and Newick trees (.nwk) into
# fixtures/mega/<name>.json. The committed JSON is what CI reads.
#
# Task 9 additions (same local-only rule):
# - fixtures/mega/library/<id>.json: the Task 2 JSON shape for each
#   library dataset the handouts use (read from
#   ../web/public/library/<id>.fasta — never copied into fixtures/),
#   plus a "bootstrap" block: NJ bootstrap (100 replicates) on the
#   committed njboot_*.mao files. Support is read from MEGA's ORIGINAL
#   NJ tree (.nwk BCL labels), not the consensus tree, and each split is
#   canonicalized to the side not containing the dataset's first label
#   (same rule as fixtures/consensus/). Every tree split is cross-checked
#   against the -pfc 0.0 partition list (exact percent match required).
#   megacc has no seed option, so bootstrap blocks are NOT
#   byte-reproducible; rerunning produces fresh values (documented in
#   fixtures/mega/README.md).
# - fixtures/mega/roundtrip/<name>.{meg,json}: each inputs/*.fasta
#   exported through the engine's own write_meg (the standalone crate in
#   fixtures/tools/write_meg), then the DNA distance .mao set run on the
#   .meg. The generator asserts every matrix equals the matrix MEGA
#   produced from the FASTA in fixtures/mega/<name>.json, cell for cell
#   at the printed precision (success criterion 4).
# - fixtures/mega/library/boot1000/<id>.json: the same NJ bootstrap runs
#   as the library 100-replicate blocks but at 1,000 replicates
#   (njboot1000_*.mao — identical to njboot_* except `Bootstrap
#   Replicates = 1000`). Owner ruling on #126 (option A): the Step 3
#   parity test compares at 1,000 replicates under the unchanged
#   v1.2 §8.3 5-point rule; the 100-replicate blocks stay as the handout
#   values. These files carry only generator/input/alphabet/bootstrap.
#   Support keeps MEGA's printed precision: BCL proportions have 4
#   decimals, so percents have 0.1 granularity at 1,000 replicates
#   (e.g. 0.7810 -> 78.1). The -pfc partition list prints integer
#   percents plus `No_of_bootstrap_reps=1000`, both of which the
#   generator asserts; the split set must equal the 100-replicate
#   block's (the original NJ tree is deterministic).
#
# `--boot1000-only` runs ONLY the boot1000 phase: megacc's bootstrap is
# unseeded, so a full rerun would rewrite the 100-replicate blocks and
# the other fixtures. Everything else is skipped; nothing existing is
# touched.
#
# The .mao files use MEGA's GUI serialization (the `Gaps/Missing Data`
# key), so megacc 12.1.4 applies the declared gap treatment itself —
# hand-written .mao files using `Gaps/Missing Data Treatment` are echoed
# but silently ignored (fixtures/worked/mega-notes.md). The njboot files
# use the MEGA 12 bootstrap serialization (`Approach` +
# `Bootstrap Replicates`; the older `No. of Bootstrap Replications` key
# alone is echoed but ignored — same notes). Every run gets the
# unfiltered input; the generator independently computes the kept-site
# count each complete/partial-95 treatment should leave and fails if
# MEGA's reported "No. of Sites" differs.
#
# Usage: bash fixtures/generate_mega.sh [--boot1000-only]   (from anywhere)
# Requires: megacc on PATH, python3, cargo (for the write_meg helper).

set -euo pipefail

BOOT1000_ONLY=0
if [ "${1:-}" = "--boot1000-only" ]; then BOOT1000_ONLY=1; fi
export BOOT1000_ONLY

FIXDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v megacc >/dev/null 2>&1 || { echo "megacc not installed; see fixtures/mega/README.md" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 1; }
command -v cargo >/dev/null 2>&1 || { echo "cargo required for fixtures/tools/write_meg" >&2; exit 1; }

MEGACC_VERSION="$(megacc --version 2>/dev/null | sed -n 's/^Version: //p' | head -1)"
MEGACC_BUILD="$(megacc --version 2>/dev/null | sed -n 's/^Build: //p' | head -1)"
[ -n "$MEGACC_VERSION" ] || { echo "could not read megacc version" >&2; exit 1; }
export MEGACC_VERSION MEGACC_BUILD

TMPD="$(mktemp -d)"
export XDG_CONFIG_HOME="$TMPD/xdg"   # megacc writes $XDG_CONFIG_HOME/megacc; keep it off $HOME
trap 'rm -rf "$TMPD"' EXIT
export TMPD FIXDIR

python3 - <<'PYEOF'
import json, os, re, subprocess, sys, hashlib

FIXDIR = os.environ['FIXDIR']
TMPD = os.environ['TMPD']
MAO = os.path.join(FIXDIR, 'mega', 'mao')
OUT = os.path.join(FIXDIR, 'mega')
VER = os.environ['MEGACC_VERSION'].strip() + ' (build ' + os.environ['MEGACC_BUILD'].strip() + ')'
BOOT1000_ONLY = os.environ.get('BOOT1000_ONLY') == '1'

DNA_MISSING_OK = set('ACGT')
AA_STATES = set('ARNDCQEGHILKMFPSTWYV')

DNA_MODELS = [('p', 'p'), ('JC69', 'jc69'), ('K80', 'k2p')]
AA_MODELS = [('p', 'p'), ('Poisson', 'poisson'), ('JTT', 'jtt')]
FILTERS = ['pairwise', 'complete', 'partial95']
METHODS = ['dist', 'nj', 'upgma']

def read_fasta(path):
    seqs, name = [], None
    for ln in open(path):
        ln = ln.strip()
        if not ln:
            continue
        if ln.startswith('>'):
            name = ln[1:]
            seqs.append([name, ''])
        else:
            seqs[-1][1] += ln.upper()
    return seqs

def is_missing(ch, alphabet):
    return ch not in (DNA_MISSING_OK if alphabet == 'dna' else AA_STATES)

def kept_sites(seqs, alphabet, filt):
    """Independent oracle for MEGA's gap treatment: the column count that
    complete/partial-95 deletion should leave (missing = the characters
    the engine's pairwise deletion skips, spec v1.4b §3.1). Assert-only;
    never used to modify the input handed to megacc."""
    if filt == 'pairwise':
        return len(seqs[0][1])
    n, L = len(seqs), len(seqs[0][1])
    kept = 0
    for k in range(L):
        present = sum(1 for _, s in seqs if not is_missing(s[k], alphabet))
        if filt == 'complete':
            ok = present == n
        else:  # partial95: kept iff present*100 >= 95*n (integer math)
            ok = present * 100 >= 95 * n
        kept += ok
    return kept

def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def run_megacc(mao_path, data_path, outbase, extra=()):
    """Run megacc; die on missing outputs or any 'Error:' in the summary."""
    for ext in ('.meg', '.nwk', '_consensus.nwk', '_partitions.txt',
                '_summary.txt'):
        try:
            os.remove(outbase + ext)
        except OSError:
            pass
    r = subprocess.run(
        ['megacc', '-a', mao_path, '-d', data_path, '-o', outbase,
         *extra],
        cwd=TMPD, check=False, capture_output=True, text=True)
    summary_path = outbase + '_summary.txt'
    if not os.path.exists(summary_path):
        sys.exit(f'megacc wrote no summary for {outbase}')
    summary = open(summary_path, errors='replace').read()
    for ln in summary.splitlines():
        if 'Error:' in ln:
            sys.exit(f'megacc failed on {os.path.basename(mao_path)} '
                     f'{os.path.basename(data_path)}: {ln.strip()}')
    # megacc 12.1.4 sometimes prints EAccessViolation and exits 1 after a
    # distance matrix was fully written (seen on inputs/jc7_long.fasta).
    # The summary is clean and the output is verified below, so a nonzero
    # exit is tolerated with a warning; anything missing still fails.
    if r.returncode != 0:
        print(f'warning: megacc exited {r.returncode} on '
              f'{os.path.basename(mao_path)} {os.path.basename(data_path)}',
              file=sys.stderr)
    return summary

def check_echo(text, expected):
    """Assert every `key=value` in `expected` appears verbatim in the
    !Description/summary echo, so a misspelled .mao value can never
    silently fall back to a default."""
    for k, v in expected.items():
        pat = re.compile(rf'^\s*{re.escape(k)}\s*=\s*{re.escape(v)}\s*$', re.M)
        if not pat.search(text):
            sys.exit(f'setting echo mismatch: wanted {k}={v} in\n{text[-2000:]}')

def check_sites(text, want, tag):
    """Assert MEGA's reported 'No. of Sites' equals the independently
    computed kept-site count (commas stripped)."""
    m = re.search(r'No\. of Sites\s*=\s*([\d,]+)', text)
    if not m:
        sys.exit(f'{tag}: no "No. of Sites" in output')
    got = int(m.group(1).replace(',', ''))
    if got != want:
        sys.exit(f'{tag}: No. of Sites {got} != expected {want}')

def decimals(tok):
    return len(tok.split('.')[1]) if '.' in tok else 0

def parse_meg_matrix(path):
    """Parse a LowerLeft distance .meg into (labels, symmetric matrix,
    distance decimals). 'n/c' cells become None."""
    txt = open(path, errors='replace').read()
    labels = re.findall(r'\[ *\d+\][ \t]+#(\S+)', txt)
    n = len(labels)
    if n == 0:
        sys.exit(f'no taxa found in {path}')
    mat = [[None] * n for _ in range(n)]
    for i in range(n):
        mat[i][i] = 0.0
    dec = set()
    written = 0
    for row in re.finditer(r'^\[ *(\d+)\][ \t]+(.*?)[ \t]*$', txt, re.M):
        i = int(row.group(1)) - 1
        if i == 0:
            continue  # row [1] is empty (lower-left has no column 1 value)
        toks = row.group(2).split()
        if len(toks) >= n:  # the header row "[ 1 2 3 ... ]" also matches
            continue
        for j, tok in enumerate(toks):
            if j >= i:
                break  # guard: a LowerLeft row i holds exactly i-1 values
            if tok.lower() == 'n/c':
                mat[i][j] = mat[j][i] = None
            else:
                try:
                    mat[i][j] = mat[j][i] = float(tok)
                except ValueError:
                    continue
                dec.add(decimals(tok))
            written += 1
    want = n * (n - 1) // 2
    if written != want:
        sys.exit(f'{path}: {written} distance cells written, expected {want}')
    if not dec:
        sys.exit(f'no distances found in {path}')
    return labels, mat, min(dec)

def nwk_decimals(path):
    """MEGA prints branch lengths with ~16 significant digits and strips
    trailing zeros, so the decimal count varies per value (0.01 and
    0.0197306397306397 can appear in the same tree). We record the largest
    count seen; the fixture README tells readers to compare each printed
    length within half an ulp of its own decimals."""
    txt = open(path, errors='replace').read()
    dec = [decimals(t) for t in re.findall(r':(\d+\.\d+)', txt)]
    if not dec:
        sys.exit(f'no branch lengths found in {path}')
    return txt.strip(), max(dec)

def canon_split(side, all_labels, first_label):
    """Canonical split key: the side NOT containing the dataset's first
    label (same rule as fixtures/consensus/), sorted, joined by '|'."""
    other = all_labels - side
    canon = other if first_label in side else side
    if not canon:
        sys.exit('bootstrap: a labelled node covers every taxon')
    return '|'.join(sorted(canon))

def parse_nwk_support(nwk_path, first_label, replicates=100):
    """Parse MEGA's bootstrap .nwk — the ORIGINAL inferred tree with BCL
    support printed as internal node labels (proportions to 4 decimals,
    e.g. `0.9800`). Returns {canonical split key -> percent}. The percent
    must be a whole count out of `replicates`: integers at 100, one
    decimal at 1,000 (0.7810 -> 78.1)."""
    nwk = open(nwk_path, errors='replace').read().strip()
    pos = [0]

    def clade():
        if nwk[pos[0]] == '(':
            pos[0] += 1
            kids = []
            while True:
                kids.append(clade())
                if nwk[pos[0]] == ',':
                    pos[0] += 1
                elif nwk[pos[0]] == ')':
                    pos[0] += 1
                    break
            m = re.match(r'[^:,();\s]+', nwk[pos[0]:])
            label = m.group(0) if m else None
            if label is not None:
                pos[0] += len(label)
            if pos[0] < len(nwk) and nwk[pos[0]] == ':':
                pos[0] += 1
                pos[0] += len(re.match(r'[^,);\s;]+', nwk[pos[0]:]).group(0))
            return ('node', label, kids)
        m = re.match(r'[^:(),;\s]+', nwk[pos[0]:])
        name = m.group(0)
        pos[0] += len(name)
        if pos[0] < len(nwk) and nwk[pos[0]] == ':':
            pos[0] += 1
            pos[0] += len(re.match(r'[^,);\s;]+', nwk[pos[0]:]).group(0))
        return ('leaf', name)

    tree = clade()
    if pos[0] >= len(nwk) or nwk[pos[0]] != ';':
        sys.exit(f'{nwk_path}: unparseable newick at offset {pos[0]}')

    def leafset(n):
        if n[0] == 'leaf':
            return {n[1]}
        s = set()
        for k in n[2]:
            s |= leafset(k)
        return s

    all_labels = leafset(tree)
    support = {}

    def walk(n):
        if n[0] != 'node':
            return
        if n[1] is not None:
            side = leafset(n)
            key = canon_split(side, all_labels, first_label)
            try:
                pct = float(n[1]) * 100
            except ValueError:
                sys.exit(f'{nwk_path}: non-numeric node label {n[1]!r}')
            count = pct * replicates / 100
            if abs(count - round(count)) > 1e-3:
                sys.exit(f'{nwk_path}: support {n[1]} is not a whole '
                         f'count out of {replicates} replicates')
            v = round(count) * 100 / replicates
            if key in support:
                sys.exit(f'{nwk_path}: split {key} appears twice')
            support[key] = int(v) if v == int(v) else v
        for k in n[2]:
            walk(k)

    walk(tree)
    if not support:
        sys.exit(f'{nwk_path}: no support labels found')
    return support

def parse_partitions(path, labels, first_label, replicates=100):
    """Parse megacc's -pfc partition list (0/1 strings in input order,
    integer percents even at 1,000 replicates) into {canonical split key
    -> percent}; also asserts `No_of_bootstrap_reps=<replicates>`. Used
    only to cross-check the original tree's BCL values."""
    txt = open(path, errors='replace').read()
    m = re.search(r'No_of_bootstrap_reps=(\d+)', txt)
    if not m:
        sys.exit(f'{path}: no No_of_bootstrap_reps header')
    if int(m.group(1)) != replicates:
        sys.exit(f'{path}: No_of_bootstrap_reps={m.group(1)} != '
                 f'{replicates}')
    all_labels = set(labels)
    parts = {}
    for m in re.finditer(r'^([01]+)[ \t]+(\d+(?:\.\d+)?)%[ \t]*$', txt, re.M):
        bits, pct = m.group(1), float(m.group(2))
        if len(bits) != len(labels):
            sys.exit(f'{path}: partition string length {len(bits)} != '
                     f'{len(labels)} taxa')
        ones = {labels[i] for i, b in enumerate(bits) if b == '1'}
        canon = all_labels - ones if first_label in ones else ones
        if not canon:
            continue
        parts['|'.join(sorted(canon))] = pct
    return parts

def expected_echo(model_long, gap, cutoff, statmethod=None,
                  bootstrap=0):
    e = {'Model/Method': model_long,
         'Gaps/Missing Data': gap}
    if cutoff is not None:
        e['Site Coverage Cutoff (%)'] = cutoff
    if statmethod:
        e['Statistical Method'] = statmethod
        if bootstrap:
            e['Test of Phylogeny'] = 'Bootstrap method'
            e['Approach'] = 'Standard Bootstrap (slow)'
            e['Bootstrap Replicates'] = str(bootstrap)
        else:
            e['Test of Phylogeny'] = 'None'
    return e

MODEL_LONG = {'p': 'p-distance', 'jc69': 'Jukes-Cantor model',
              'k2p': 'Kimura 2-parameter model', 'poisson': 'Poisson model',
              'jtt': 'Jones-Taylor-Thornton (JTT) model'}
FILTER_LONG = {'pairwise': ('Pairwise deletion', None),
               'complete': ('Complete deletion', None),
               'partial95': ('Partial deletion', '95')}
STAT_LONG = {'nj': 'Neighbor-joining', 'upgma': 'UPGMA'}

# Task 9: library datasets (read from ../web/public/library/, never
# copied) and the NJ bootstrap runs on them (dataset -> [(mao model id,
# JSON model name)]). globins gets Poisson in addition to the plan's JTT:
# MEGA's JTT is not our Jtt (#117), so JTT support is not a parity target
# and Poisson is the protein bootstrap oracle (docs/decisions.md).
LIB_INPUTS = [
    ('../web/public/library/primate-mtdna.fasta', 'dna'),
    ('../web/public/library/16s-rrna.fasta', 'dna'),
    ('../web/public/library/globins.fasta', 'protein'),
]
BOOT_RUNS = {
    'primate-mtdna': [('k2p', 'K80')],
    '16s-rrna':      [('k2p', 'K80')],
    'globins':       [('jtt', 'JTT'), ('poisson', 'Poisson')],
}
BOOT_FILTERS = ['pairwise', 'complete']

def mao_file(analysis, alpha, model_id, filt):
    return f'{analysis}_{alpha}_{model_id}_{filt}.mao'

dna_inputs = sorted(
    f for f in os.listdir(os.path.join(FIXDIR, 'inputs'))
    if f.endswith('.fasta'))
prot_inputs = sorted(
    f for f in os.listdir(os.path.join(FIXDIR, 'inputs', 'protein'))
    if f.endswith('.fasta'))

def process(relpath, alphabet, out_dir=None, boot_runs=None):
    name = os.path.splitext(os.path.basename(relpath))[0]
    if out_dir is None:
        out_dir = OUT
    src = os.path.join(FIXDIR, relpath)
    seqs = read_fasta(src)
    if len({len(s) for _, s in seqs}) != 1:
        sys.exit(f'{relpath} is not a rectangular alignment')
    labels_in = [nm for nm, _ in seqs]
    models = DNA_MODELS if alphabet == 'dna' else AA_MODELS
    alpha_dir = 'dna' if alphabet == 'dna' else 'protein'
    used_maos, distances, trees = {}, {}, {}
    dist_dec = nwk_dec = None

    for filt in FILTERS:
        want_sites = kept_sites(seqs, alphabet, filt)
        if want_sites == 0:
            sys.exit(f'{relpath}: {filt} removes every site')
        gap, cutoff = FILTER_LONG[filt]
        for json_model, model_id in models:
            e = expected_echo(MODEL_LONG[model_id], gap, cutoff)
            # distance matrix — megacc applies the .mao gap treatment to
            # the unfiltered input
            maof = mao_file('dist', alpha_dir, model_id, filt)
            used_maos[maof] = sha256(os.path.join(MAO, maof))
            out = os.path.join(TMPD, f'{name}_{filt}_{model_id}_d')
            summary = run_megacc(os.path.join(MAO, maof), src, out)
            meg_path = out + '.meg'
            if not os.path.exists(meg_path):
                sys.exit(f'no distance matrix: {meg_path}')
            mtxt = open(meg_path, errors='replace').read()
            check_echo(mtxt, e)
            check_sites(mtxt, want_sites, f'{name} {filt} {model_id} dist')
            labels, mat, d = parse_meg_matrix(meg_path)
            if labels != labels_in:
                sys.exit(f'{name}: labels {labels} != input order')
            dist_dec = d if dist_dec is None else min(dist_dec, d)
            distances[f'{json_model}/{filt}'] = {'labels': labels, 'matrix': mat}
            # NJ + UPGMA trees
            for method in ('nj', 'upgma'):
                maof = mao_file(method, alpha_dir, model_id, filt)
                used_maos[maof] = sha256(os.path.join(MAO, maof))
                out = os.path.join(TMPD, f'{name}_{filt}_{model_id}_{method}')
                summary = run_megacc(os.path.join(MAO, maof), src, out)
                nwk_path = out + '.nwk'
                if not os.path.exists(nwk_path):
                    sys.exit(f'no newick: {nwk_path}')
                check_echo(summary, expected_echo(MODEL_LONG[model_id], gap,
                                                  cutoff, STAT_LONG[method]))
                check_sites(summary, want_sites,
                            f'{name} {filt} {model_id} {method}')
                nwk, dec = nwk_decimals(nwk_path)
                nwk_dec = dec if nwk_dec is None else max(nwk_dec, dec)
                trees[f'{method}/{json_model}/{filt}'] = nwk

    bootstrap = {}
    for model_id, json_model in (boot_runs or []):
        for filt in BOOT_FILTERS:
            want_sites = kept_sites(seqs, alphabet, filt)
            gap, cutoff = FILTER_LONG[filt]
            maof = mao_file('njboot', alpha_dir, model_id, filt)
            used_maos[maof] = sha256(os.path.join(MAO, maof))
            out = os.path.join(TMPD, f'{name}_boot_{filt}_{model_id}')
            summary = run_megacc(os.path.join(MAO, maof), src, out,
                                 extra=('-pfc', '0.0'))
            nwk_path = out + '.nwk'
            part_path = out + '_partitions.txt'
            if not os.path.exists(nwk_path):
                sys.exit(f'no bootstrap newick: {nwk_path}')
            if not os.path.exists(part_path):
                sys.exit(f'no partition list: {part_path}')
            check_echo(summary, expected_echo(MODEL_LONG[model_id], gap,
                                              cutoff, 'Neighbor-joining',
                                              bootstrap=100))
            check_sites(summary, want_sites,
                        f'{name} {filt} {model_id} njboot')
            support = parse_nwk_support(nwk_path, labels_in[0], 100)
            parts = parse_partitions(part_path, labels_in, labels_in[0],
                                     100)
            for key, pct in support.items():
                if key not in parts:
                    sys.exit(f'{name} {filt} {model_id}: split {key} on '
                             'the tree is missing from the partition list')
                if parts[key] != pct:
                    sys.exit(f'{name} {filt} {model_id}: tree BCL {pct} '
                             f'!= partition frequency {parts[key]} for '
                             f'{key}')
            bootstrap[f'nj/{json_model}/{filt}'] = {
                'replicates': 100, 'support': support}

    doc = {
        'generator': {
            'megacc': VER,
            'mao_sha256': dict(sorted(used_maos.items())),
            'note': 'GUI-serialized .mao (Gaps/Missing Data key); megacc '
                    'applies the declared gap treatment itself and the '
                    'generator asserts No. of Sites against an '
                    'independently computed kept-site count.',
        },
        'input': relpath.replace(os.sep, '/'),
        'alphabet': alphabet,
        'precision': {'distances': dist_dec, 'branch_lengths': nwk_dec},
        'distances': distances,
        'trees': trees,
    }
    if bootstrap:
        doc['bootstrap'] = bootstrap
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, name + '.json')
    with open(out_path, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print(f'wrote {out_path}  (dist {dist_dec} dp, nwk {nwk_dec} dp)')

if not BOOT1000_ONLY:
    for f in dna_inputs:
        process(f'inputs/{f}', 'dna')
    for f in prot_inputs:
        process(f'inputs/protein/{f}', 'protein')

# --- library datasets (v1.4b Task 9): the Task 2 shape plus a bootstrap
# block. Reads the FASTAs in web/public/library/ directly; the "input"
# path is fixtures-relative like the existing files. Bootstrap support
# comes from MEGA's ORIGINAL NJ tree (never the consensus tree) and is
# not byte-reproducible (megacc has no seed option), so these blocks are
# not compared on rerun.
LIB_DIR = os.path.join(OUT, 'library')

if not BOOT1000_ONLY:
    for relpath, alphabet in LIB_INPUTS:
        nm = os.path.splitext(os.path.basename(relpath))[0]
        process(relpath, alphabet, out_dir=LIB_DIR, boot_runs=BOOT_RUNS[nm])

# --- .meg round trip (v1.4b Task 9): export every inputs/*.fasta through
# the engine's write_meg (fixtures/tools/write_meg), run the DNA distance
# .mao set on the .meg, and assert each matrix equals the one MEGA
# produced from the FASTA, cell for cell (success criterion 4).
RT_DIR = os.path.join(OUT, 'roundtrip')
os.makedirs(RT_DIR, exist_ok=True)
WRITE_MEG = os.path.join(FIXDIR, 'tools', 'write_meg', 'Cargo.toml')

def export_meg(fasta_path, meg_path, title):
    r = subprocess.run(
        ['cargo', 'run', '--offline', '-q',
         '--manifest-path', WRITE_MEG, '--',
         fasta_path, meg_path, title],
        env={**os.environ,
             'CARGO_TARGET_DIR': os.path.join(os.path.dirname(FIXDIR),
                                              'target')},
        check=False, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f'write_meg failed on {fasta_path}:\n{r.stderr}')

def roundtrip(fasta_rel):
    name = os.path.splitext(os.path.basename(fasta_rel))[0]
    src = os.path.join(FIXDIR, fasta_rel)
    seqs = read_fasta(src)
    labels_in = [nm for nm, _ in seqs]
    meg_rel = f'mega/roundtrip/{name}.meg'
    meg_abs = os.path.join(FIXDIR, meg_rel)
    export_meg(src, meg_abs, name)
    ref = json.load(open(os.path.join(OUT, name + '.json')))

    used_maos, distances = {}, {}
    dist_dec = None
    for filt in FILTERS:
        want_sites = kept_sites(seqs, 'dna', filt)
        gap, cutoff = FILTER_LONG[filt]
        for json_model, model_id in DNA_MODELS:
            maof = mao_file('dist', 'dna', model_id, filt)
            used_maos[maof] = sha256(os.path.join(MAO, maof))
            out = os.path.join(TMPD, f'rt_{name}_{filt}_{model_id}')
            run_megacc(os.path.join(MAO, maof), meg_abs, out)
            meg_path = out + '.meg'
            if not os.path.exists(meg_path):
                sys.exit(f'no distance matrix: {meg_path}')
            mtxt = open(meg_path, errors='replace').read()
            check_echo(mtxt, expected_echo(MODEL_LONG[model_id], gap,
                                           cutoff))
            check_sites(mtxt, want_sites,
                        f'rt {name} {filt} {model_id} dist')
            labels, mat, d = parse_meg_matrix(meg_path)
            if labels != labels_in:
                sys.exit(f'{name}: .meg labels {labels} != input order')
            dist_dec = d if dist_dec is None else min(dist_dec, d)
            ref_mat = ref['distances'][f'{json_model}/{filt}']['matrix']
            if mat != ref_mat:
                for i in range(len(mat)):
                    for j in range(len(mat)):
                        if mat[i][j] != ref_mat[i][j]:
                            sys.exit(
                                f'{name} {json_model}/{filt} [{i}][{j}]: '
                                f'.meg {mat[i][j]} != fasta '
                                f'{ref_mat[i][j]}')
                sys.exit(f'{name} {json_model}/{filt}: matrix mismatch')
            distances[f'{json_model}/{filt}'] = {
                'labels': labels, 'matrix': mat}

    doc = {
        'generator': {
            'megacc': VER,
            'mao_sha256': dict(sorted(used_maos.items())),
            'note': 'MEGA-CC run on the .meg written by '
                    'neophylo_core::write_meg; every matrix verified '
                    'cell-for-cell against the matrix MEGA produced '
                    'from the FASTA (../<name>.json).',
        },
        'input': meg_rel,
        'alphabet': 'dna',
        'precision': {'distances': dist_dec},
        'distances': distances,
    }
    out_path = os.path.join(RT_DIR, name + '.json')
    with open(out_path, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print(f'wrote {out_path}  (round trip verified vs {name}.json)')

if not BOOT1000_ONLY:
    for f in dna_inputs:
        roundtrip(f'inputs/{f}')

# --- boot1000 phase (owner ruling on #126, option A): the same NJ
# bootstrap runs as the library 100-replicate blocks, at 1,000
# replicates via the njboot1000_*.mao files, written to
# library/boot1000/<id>.json. Runs on a full run and under
# --boot1000-only (the only phase that flag runs). Support keeps the
# 0.1-percent granularity 1,000 replicates give (BCL 0.7810 -> 78.1).
def process_boot1000(relpath, alphabet, boot_runs):
    name = os.path.splitext(os.path.basename(relpath))[0]
    src = os.path.join(FIXDIR, relpath)
    seqs = read_fasta(src)
    if len({len(s) for _, s in seqs}) != 1:
        sys.exit(f'{relpath} is not a rectangular alignment')
    labels_in = [nm for nm, _ in seqs]
    alpha_dir = 'dna' if alphabet == 'dna' else 'protein'
    ref = json.load(open(os.path.join(LIB_DIR, name + '.json')))
    used_maos, bootstrap = {}, {}

    for model_id, json_model in boot_runs:
        for filt in BOOT_FILTERS:
            want_sites = kept_sites(seqs, alphabet, filt)
            gap, cutoff = FILTER_LONG[filt]
            maof = mao_file('njboot1000', alpha_dir, model_id, filt)
            used_maos[maof] = sha256(os.path.join(MAO, maof))
            out = os.path.join(TMPD, f'{name}_boot1000_{filt}_{model_id}')
            summary = run_megacc(os.path.join(MAO, maof), src, out,
                                 extra=('-pfc', '0.0'))
            nwk_path = out + '.nwk'
            part_path = out + '_partitions.txt'
            if not os.path.exists(nwk_path):
                sys.exit(f'no bootstrap newick: {nwk_path}')
            if not os.path.exists(part_path):
                sys.exit(f'no partition list: {part_path}')
            check_echo(summary, expected_echo(MODEL_LONG[model_id], gap,
                                              cutoff, 'Neighbor-joining',
                                              bootstrap=1000))
            check_sites(summary, want_sites,
                        f'{name} {filt} {model_id} njboot1000')
            support = parse_nwk_support(nwk_path, labels_in[0], 1000)
            parts = parse_partitions(part_path, labels_in, labels_in[0],
                                     1000)
            # Partitions print integer percents even at 1,000
            # replicates, so the BCL is within 1 pp of them.
            for key, pct in support.items():
                if key not in parts:
                    sys.exit(f'{name} {filt} {model_id}: split {key} on '
                             'the tree is missing from the partition '
                             'list')
                if abs(parts[key] - pct) >= 1.0:
                    sys.exit(f'{name} {filt} {model_id}: tree BCL {pct} '
                             f'differs from partition frequency '
                             f'{parts[key]} for {key} by >= 1 pp')
            # The original NJ tree is deterministic, so its labelled
            # split set equals the 100-replicate block's.
            ref_key = f'nj/{json_model}/{filt}'
            if set(support) != set(ref['bootstrap'][ref_key]['support']):
                sys.exit(f'{name} {filt} {model_id}: 1,000-replicate '
                         'split set differs from the 100-replicate '
                         'block (the original NJ tree should be '
                         'identical)')
            # 1,000 replicates must show in the values: at least one
            # support finer than a whole percent.
            if all(v == int(v) for v in support.values()):
                sys.exit(f'{name} {filt} {model_id}: every support is '
                         'an integer percent — the 1,000-replicate '
                         'count did not take effect')
            bootstrap[ref_key] = {'replicates': 1000, 'support': support}

    doc = {
        'generator': {
            'megacc': VER,
            'mao_sha256': dict(sorted(used_maos.items())),
            'note': 'NJ bootstrap at 1,000 replicates (njboot1000_*.mao; '
                    'owner ruling on #126). Support is from MEGA\'s '
                    'original NJ tree at 0.1-percent granularity, '
                    'cross-checked against the -pfc 0.0 partitions '
                    '(integer percents, No_of_bootstrap_reps=1000); the '
                    'split set is asserted equal to the 100-replicate '
                    'block in ../<id>.json.',
        },
        'input': relpath.replace(os.sep, '/'),
        'alphabet': alphabet,
        'bootstrap': bootstrap,
    }
    out_dir = os.path.join(LIB_DIR, 'boot1000')
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, name + '.json')
    with open(out_path, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print(f'wrote {out_path}  (1,000-replicate bootstrap)')

for relpath, alphabet in LIB_INPUTS:
    nm = os.path.splitext(os.path.basename(relpath))[0]
    process_boot1000(relpath, alphabet, BOOT_RUNS[nm])
PYEOF
