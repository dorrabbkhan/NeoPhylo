#!/usr/bin/env python3
"""Print-PDF text checks for the release checkpoint (v1.4d §21(m)/(n)).

    python3 -I scripts/checkpoint/pdfcheck.py <out-dir>

Reads every PDF in <out-dir>/print/ through `pdftotext` (poppler-utils —
installed on the checkpoint host) and returns a report.md section with
one row per PDF. report.py folds it in; the CLI is for ad-hoc runs and
tests.

For every `<set-id>-read-sheet.pdf` — the reading paper sheets — five
rules from the v1.4.3 checkpoint findings:

  a. page 1 carries the first words of item 1's prompt — a whole-item
     `break-inside: avoid-page` pushed an over-tall item past the
     masthead onto page 2, leaving page 1 holding the header alone;
  b. no page's bottom-most text line is an orphaned figure caption
     `^Tree( \\d+)?$` — the same rule left a caption stranded at a
     page bottom with its drawing on the next page. Positions come
     from `pdftotext -tsv` (stream order lies: Chromium emits HTML
     captions after their figure's SVG text). The tail of an options
     run — "Circle one." over ○ Tree 1 / Tree 2 — is not an orphan:
     consecutive same-indent "Tree N" lines are options, and captions
     always have a whole drawing between them;
  c. every item prompt of the set appears in the page text with
     whitespace normalised — hinted whole-pixel glyph advances printed
     as uneven spacing, so words came out split ("minut es"). The
     prompt text is rebuilt from the committed exercise file the same
     way the sheet builds it: {a}/{b}/{c}/{set} placeholder fill, then
     the paper re-verbing of `paperText` in web/src/worksheets/
     reading.ts (the PAPER_VERBS table is ported below — keep it in
     sync; test_pdfcheck.py pins it against the TS source);
  d. every item prompt lies wholly on one page and is never the
     page's last text — a prompt could still split across the break
     or end a page while its first figure started the next
     (`break-after: avoid` on the question did not reach the flex
     row). (a) and (c) normalise across pages, so this needs a
     per-page check. Reading keys (`*-read-key.pdf`) get it too —
     their items print the same paperText prompts followed by the
     answer;
  e. the last page of a sheet/key holds more than the footer line
     and the QR/hand-in block — the closing matter used to spill
     onto a final page holding only "Printed from NeoPhylo — …".
     Applied to every PDF: the footer is shared.

Every other PDF (lab sheets, paper sheets and keys, guide, index)
gets rules (b) and (e) — a page ending on "Tree N" is a stranded
caption wherever it appears. A missing pdftotext is a warning row,
not a failure.
"""

import csv
import io
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

READ_SHEET = re.compile(r"^(.+)-read-sheet\.pdf$")
READ_KEY = re.compile(r"^(.+)-read-key\.pdf$")
LONE_CAPTION = re.compile(r"^Tree( \d+)?$")
SENTENCE_SPLIT = re.compile(r"([.!?]+\s+)")
SPACE_RUN = re.compile(r"\s+")
PAGE_BREAK = "\f"

# Rule (e): text the last page may hold besides real content — the
# print footer, the test-set hand-in line and the practice set's
# link/QR block (heading, hint, link-note and the URL itself).
FOOTER = re.compile(r"Printed from NeoPhylo.*")
URL = re.compile(r"https?://\S+")
ENDMATTER = [
    "Hand this sheet to your instructor.",
    "Open this set in NeoPhylo",
    "Check your answers in the app — scan the code or follow the link:",
    "This link is too long for a QR code — copy it from below.",
]

# web/src/worksheets/reading.ts PAPER_VERBS — first match wins.
PAPER_VERBS = [
    ("Tap the lettered nodes in order",
     "Write the letters of the nodes in order"),
    ("Tap every", "Circle every"),
    ("Tap one of", "Circle one of"),
    ("Tap the", "Circle the"),
    ("Tap", "Circle"),
    ("Select every true statement", "Tick every true statement"),
    ("Select all that apply", "Tick all that apply"),
    ("Select", "Tick"),
    ("Rotate nodes freely", "Rotating a node changes nothing"),
]

# How many leading words of item 1's prompt page 1 must show for rule
# (a): the whole prompt when it is short, its head when it is long.
FIRST_WORDS = 6


def join_and(tips):
    """reading/state.ts joinAnd: "a and b" / "a, b and c"."""
    if len(tips) <= 1:
        return "".join(tips)
    return ", ".join(tips[:-1]) + " and " + tips[-1]


def fill_placeholders(text, item):
    """reading/state.ts fillPlaceholders: {a} {b} {c} {set}."""
    out = text
    for key in ("a", "b", "c"):
        if item.get(key) is not None:
            out = out.replace("{%s}" % key, item[key])
    # `tips` defaults to [] when absent (reading/load.rs
    # unwrap_or_default) — the engine type reports it as required.
    return out.replace("{set}", join_and(item.get("tips", [])))


def paper_text(item):
    """worksheets/reading.ts paperText: sentence-initial re-verb."""
    parts = SENTENCE_SPLIT.split(fill_placeholders(item["text"], item))
    out = []
    for idx, piece in enumerate(parts):
        if idx % 2 == 1 or piece == "":
            out.append(piece)
            continue
        hit = next((v for v in PAPER_VERBS if piece.startswith(v[0])),
                   None)
        out.append(hit[1] + piece[len(hit[0]):] if hit else piece)
    return "".join(out).replace(", or arrange the list", "")


def normalize(text):
    """Whitespace-normalised text for substring checks. NFKC folds
    ligature codepoints (e.g. U+FB01 "ﬁ" → "fi") that extraction can
    leave behind."""
    return SPACE_RUN.sub(" ", unicodedata.normalize("NFKC", text)).strip()


def pages_of(pdftotext_out):
    """pdftotext separates pages with a form feed."""
    return pdftotext_out.split(PAGE_BREAK)


def tsv_lines(tsv_text):
    """`pdftotext -tsv` rows → {page: [(top, left, height, text)]}
    sorted by top — the page's lines in visual order. Word rows carry
    level 5; a line groups words sharing page/par/block/line ids."""
    grouped = defaultdict(list)
    for row in csv.reader(io.StringIO(tsv_text), delimiter="\t"):
        if len(row) < 12 or row[0] != "5":
            continue
        key = (int(row[1]), int(row[2]), int(row[3]), int(row[4]))
        grouped[key].append(row)
    pages = defaultdict(list)
    for (page, _, _, _), ws in grouped.items():
        ws.sort(key=lambda w: int(w[5]))  # word_num
        top = min(float(w[7]) for w in ws)
        left = min(float(w[6]) for w in ws)
        bottom = max(float(w[7]) + float(w[9]) for w in ws)
        pages[page].append((top, left, bottom - top,
                            " ".join(w[11] for w in ws)))
    return {p: sorted(v) for p, v in pages.items()}


def lone_captions(pages):
    """Page numbers whose bottom-most line is an orphaned figure
    caption. The tail of an options run is not an orphan: when the
    line directly above is also "Tree N" at the same indent and an
    adjacent y, the bottom line is the run's last option — real
    captions always have a whole drawing between them."""
    out = []
    for pnum in sorted(pages):
        lines = pages[pnum]
        if not lines or not LONE_CAPTION.match(lines[-1][3]):
            continue
        last = lines[-1]
        if len(lines) > 1:
            prev = lines[-2]
            if (LONE_CAPTION.match(prev[3])
                    and abs(prev[1] - last[1]) < 2
                    and last[0] - prev[0] < 3 * last[2]):
                continue
        out.append(pnum)
    return out


def load_set(set_id, repo=REPO):
    """The committed exercise file for a read-sheet id: shipped sets in
    exercises/reading/, coverage sets in exercises/reading/coverage/."""
    for base in ("exercises/reading", "exercises/reading/coverage"):
        path = os.path.join(repo, base, f"{set_id}.json")
        if os.path.exists(path):
            with open(path) as fh:
                return json.load(fh)
    return None


def strip_endmatter(text):
    """The closing matter out of a normalised page text — the print
    footer (always the last text on its page), the hand-in line, the
    link/QR block and bare URLs."""
    out = URL.sub("", text)
    for s in ENDMATTER:
        out = out.replace(s, "")
    return FOOTER.sub("", out)


def prompt_stranded(prompt, pages_norm):
    """Rule (d) for one prompt → page number it fails on, or None.
    The prompt must lie wholly on one page and not be that page's
    last text — its first figure (or answer on a key) must follow on
    the same page."""
    for pnum, page in enumerate(pages_norm):
        pos = page.find(prompt)
        if pos == -1:
            continue
        tail = page[pos + len(prompt):]
        if strip_endmatter(tail).strip() == "":
            return pnum + 1
        return None
    return -1


def check_pdf(name, pages, tsv_pages, repo=REPO):
    """One PDF → (ok, detail). `pages` is the plain pdftotext output
    split into pages, `tsv_pages` the positional lines from
    tsv_lines() — tests drive both with synthetic data, no PDF."""
    problems = []
    pages_norm = [normalize(p) for p in pages]
    match = READ_SHEET.match(name) or READ_KEY.match(name)
    if match is not None:
        set_id = match.group(1)
        sheet = load_set(set_id, repo)
        if sheet is None:
            problems.append(f"no exercise file for {set_id}")
        else:
            prompts = [normalize(paper_text(item))
                       for item in sheet["items"]]
            if READ_SHEET.match(name):
                # (a) page 1 carries item 1's first words.
                head = " ".join(prompts[0].split(" ")[:FIRST_WORDS])
                if head not in (pages_norm[0] if pages_norm else ""):
                    problems.append("page 1 missing item 1's prompt")
                # (c) every prompt whole in the sheet text.
                body = normalize(" ".join(pages))
                missing = sum(1 for p in prompts if p not in body)
                if missing:
                    problems.append(
                        f"{missing}/{len(prompts)} prompts split or "
                        "missing")
            # (d) every prompt whole on one page, never its last text.
            for idx, prompt in enumerate(prompts):
                where = prompt_stranded(prompt, pages_norm)
                if where == -1:
                    problems.append(
                        f"item {idx + 1} prompt split across pages")
                elif where is not None:
                    problems.append(
                        f"item {idx + 1} prompt is last on page {where}")
    # (b) no page ends on a lone figure caption.
    orphans = lone_captions(tsv_pages)
    if orphans:
        problems.append(
            "lone caption last on page " + ", ".join(map(str, orphans)))
    # (e) the last page holds more than the footer and the QR/hand-in
    # block — a footer-only final page is a straggler.
    last = next((p for p in reversed(pages_norm) if p), "")
    if last and strip_endmatter(last).strip() == "":
        problems.append("last page holds only the footer/closing block")
    return not problems, ("; ".join(problems) if problems else "clean")


def run_pdftotext(path, flag=None):
    """The PDF's text (plain or -tsv), None when pdftotext is absent,
    "" when it errors — an unreadable PDF is a finding, not a skip."""
    if shutil.which("pdftotext") is None:
        return None
    cmd = ["pdftotext"] + ([flag] if flag else []) + [path, "-"]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True,
                             timeout=60)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return ""
    return out.stdout.decode("utf-8", "replace")


def section(out, repo=REPO):
    """The report.md section and its failure count for <out>/print/."""
    head = "## Print PDFs — text check (pdftotext)"
    pdir = os.path.join(out, "print")
    pdfs = sorted(f for f in os.listdir(pdir) if f.endswith(".pdf")) \
        if os.path.isdir(pdir) else []
    if not pdfs:
        return f"{head}\n\nNot run (no print/ PDFs).\n", 0
    if shutil.which("pdftotext") is None:
        return (f"{head}\n\n| | PDF | Result |\n|---|---|---|\n"
                f"| ⚠️ | all | skipped — pdftotext not found "
                f"(poppler-utils) |\n"), 0
    rows, fails = [], 0
    for name in pdfs:
        path = os.path.join(pdir, name)
        text = run_pdftotext(path)
        tsv = run_pdftotext(path, "-tsv")
        if text is None or tsv is None:
            continue  # unreachable — the binary check above passed
        ok, detail = check_pdf(
            name, pages_of(text), tsv_lines(tsv), repo)
        rows.append(f"| {'✅' if ok else '❌'} | {name} | {detail} |")
        fails += 0 if ok else 1
    note = ("Reading sheets and keys (`*-read-sheet.pdf`, "
            "`*-read-key.pdf`) are checked for the item-1 prompt on "
            "page 1, every prompt whole, every prompt on one page and "
            "never its last text, and no page ending on a lone "
            "`Tree N` caption; every PDF gets the lone-caption rule "
            "and a last page holding more than the footer/closing "
            "block (checkpoint §21(m)/(n)).")
    table = "\n".join(["| | PDF | Result |", "|---|---|---|", *rows])
    return f"{head}\n\n{note}\n\n{table}\n", fails


def main():
    if len(sys.argv) != 2:
        print("usage: pdfcheck.py <out-dir>", file=sys.stderr)
        return 2
    text, fails = section(os.path.abspath(sys.argv[1]))
    print(text)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
