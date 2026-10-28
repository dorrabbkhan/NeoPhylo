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
# IMPORTANT — gap treatment workaround (full story in
# fixtures/worked/mega-notes.md): MEGA-CC 12.1.4 echoes but does NOT apply
# "Gaps/Missing Data Treatment" for distance estimation or distance-based
# tree inference — an all-gap control input still produces a distance
# matrix instead of the documented "All Sites were removed" error, and
# pairwise/complete/partial runs are byte-identical. To obtain the numbers
# MEGA's own documentation defines, the script pre-filters the columns
# itself (removing exactly the sites complete or partial-95 deletion
# removes) and hands the filtered alignment to the matching .mao, which
# still declares the intended treatment so its echo can be checked.
#
# Usage: bash fixtures/generate_mega.sh   (from anywhere)
# Requires: megacc on PATH, python3.

set -euo pipefail

FIXDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v megacc >/dev/null 2>&1 || { echo "megacc not installed; see fixtures/mega/README.md" >&2; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "python3 required" >&2; exit 1; }

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

def filter_sites(seqs, alphabet, filt):
    """Return a copy of seqs with the columns removed that MEGA's
    complete/partial deletion removes (missing = the characters the
    engine's pairwise deletion skips, spec v1.4b §3.1)."""
    if filt == 'pairwise':
        return seqs
    n, L = len(seqs), len(seqs[0][1])
    keep = []
    for k in range(L):
        present = sum(1 for _, s in seqs if not is_missing(s[k], alphabet))
        if filt == 'complete':
            ok = present == n
        else:  # partial95: kept iff present*100 >= 95*n (integer math)
            ok = present * 100 >= 95 * n
        if ok:
            keep.append(k)
    return [[nm, ''.join(s[k] for k in keep)] for nm, s in seqs]

def write_fasta(seqs, path):
    with open(path, 'w') as f:
        for nm, s in seqs:
            f.write(f'>{nm}\n{s}\n')

def sha256(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def run_megacc(mao_path, data_path, outbase):
    """Run megacc; die on missing outputs or any 'Error:' in the summary."""
    for ext in ('.meg', '.nwk', '_summary.txt'):
        try:
            os.remove(outbase + ext)
        except OSError:
            pass
    r = subprocess.run(
        ['megacc', '-a', mao_path, '-d', data_path, '-o', outbase],
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

def expected_echo(model_long, gap, cutoff, statmethod=None):
    e = {'Model/Method': model_long,
         'Gaps/Missing Data Treatment': gap,
         'Site Coverage Cutoff (%)': cutoff}
    if statmethod:
        e['Statistical Method'] = statmethod
        e['Test of Phylogeny'] = 'None'
    return e

MODEL_LONG = {'p': 'p-distance', 'jc69': 'Jukes-Cantor model',
              'k2p': 'Kimura 2-parameter model', 'poisson': 'Poisson model',
              'jtt': 'Jones-Taylor-Thornton (JTT) model'}
FILTER_LONG = {'pairwise': ('Pairwise deletion', 'Not Applicable'),
               'complete': ('Complete deletion', 'Not Applicable'),
               'partial95': ('Partial deletion', '95')}
STAT_LONG = {'nj': 'Neighbor-joining', 'upgma': 'UPGMA'}

def mao_file(analysis, alpha, model_id, filt):
    return f'{analysis}_{alpha}_{model_id}_{filt}.mao'

dna_inputs = sorted(
    f for f in os.listdir(os.path.join(FIXDIR, 'inputs'))
    if f.endswith('.fasta'))
prot_inputs = sorted(
    f for f in os.listdir(os.path.join(FIXDIR, 'inputs', 'protein'))
    if f.endswith('.fasta'))

def process(relpath, alphabet):
    name = os.path.splitext(os.path.basename(relpath))[0]
    src = os.path.join(FIXDIR, relpath)
    seqs = read_fasta(src)
    if len({len(s) for _, s in seqs}) != 1:
        sys.exit(f'{relpath} is not a rectangular alignment')
    models = DNA_MODELS if alphabet == 'dna' else AA_MODELS
    alpha_dir = 'dna' if alphabet == 'dna' else 'protein'
    used_maos, distances, trees = {}, {}, {}
    dist_dec = nwk_dec = None

    for filt in FILTERS:
        filt_seqs = filter_sites(seqs, alphabet, filt)
        if not filt_seqs[0][1]:
            sys.exit(f'{relpath}: {filt} removes every site')
        data_path = src if filt == 'pairwise' else os.path.join(
            TMPD, f'{name}_{filt}.fasta')
        if filt != 'pairwise':
            write_fasta(filt_seqs, data_path)
        gap, cutoff = FILTER_LONG[filt]
        for json_model, model_id in models:
            e = expected_echo(MODEL_LONG[model_id], gap, cutoff)
            # distance matrix
            maof = mao_file('dist', alpha_dir, model_id, filt)
            used_maos[maof] = sha256(os.path.join(MAO, maof))
            out = os.path.join(TMPD, f'{name}_{filt}_{model_id}_d')
            summary = run_megacc(os.path.join(MAO, maof), data_path, out)
            meg_path = out + '.meg'
            if not os.path.exists(meg_path):
                sys.exit(f'no distance matrix: {meg_path}')
            mtxt = open(meg_path, errors='replace').read()
            check_echo(mtxt, e)
            sites = int(re.search(r'No\. of Sites=([\d,]+)', mtxt)
                        .group(1).replace(',', ''))
            if sites != len(filt_seqs[0][1]):
                sys.exit(f'{name} {filt} {model_id}: No. of Sites {sites} '
                         f'!= filtered {len(filt_seqs[0][1])}')
            labels, mat, d = parse_meg_matrix(meg_path)
            if labels != [nm for nm, _ in seqs]:
                sys.exit(f'{name}: labels {labels} != input order')
            dist_dec = d if dist_dec is None else min(dist_dec, d)
            distances[f'{json_model}/{filt}'] = {'labels': labels, 'matrix': mat}
            # NJ + UPGMA trees
            for method in ('nj', 'upgma'):
                maof = mao_file(method, alpha_dir, model_id, filt)
                used_maos[maof] = sha256(os.path.join(MAO, maof))
                out = os.path.join(TMPD, f'{name}_{filt}_{model_id}_{method}')
                summary = run_megacc(os.path.join(MAO, maof), data_path, out)
                nwk_path = out + '.nwk'
                if not os.path.exists(nwk_path):
                    sys.exit(f'no newick: {nwk_path}')
                check_echo(summary, expected_echo(MODEL_LONG[model_id], gap,
                                                  cutoff, STAT_LONG[method]))
                nwk, dec = nwk_decimals(nwk_path)
                nwk_dec = dec if nwk_dec is None else max(nwk_dec, dec)
                trees[f'{method}/{json_model}/{filt}'] = nwk

    doc = {
        'generator': {
            'megacc': VER,
            'mao_sha256': dict(sorted(used_maos.items())),
            'note': 'megacc 12.1.4 echoes but does not apply '
                    'Gaps/Missing Data Treatment; complete/partial95 '
                    'inputs were pre-filtered by the generator to the '
                    'sites the option removes (fixtures/mega/README.md).',
        },
        'input': relpath.replace(os.sep, '/'),
        'alphabet': alphabet,
        'precision': {'distances': dist_dec, 'branch_lengths': nwk_dec},
        'distances': distances,
        'trees': trees,
    }
    out_path = os.path.join(OUT, name + '.json')
    with open(out_path, 'w') as f:
        json.dump(doc, f, indent=1)
        f.write('\n')
    print(f'wrote {out_path}  (dist {dist_dec} dp, nwk {nwk_dec} dp)')

for f in dna_inputs:
    process(f'inputs/{f}', 'dna')
for f in prot_inputs:
    process(f'inputs/protein/{f}', 'protein')
PYEOF
