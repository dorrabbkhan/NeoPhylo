#!/usr/bin/env python3
"""Release checkpoint, step 5: fold the browser pass, the MEGA-CC run and the
preflight into one report.md, and build gallery.html for the owner's visual
pass (every screenshot grouped by checkpoint section, every print PDF).

    python3 -I scripts/checkpoint/report.py <out-dir> --title "v1.4.1 RC"

Reads <out-dir>/playwright.json, preflight.md, mega.md, shots/, print/.
"""

import argparse
import html
import json
import os
import re
import sys
from collections import defaultdict

ANSI = re.compile(r"\x1b\[[0-9;]*m")


def browser_summary(out):
    path = os.path.join(out, "playwright.json")
    if not os.path.exists(path):
        return "## Browser pass\n\nNot run (no playwright.json).\n", 0
    data = json.load(open(path))
    rows, flaky_rows, fails, passes, skips, flaky = [], [], 0, 0, 0, 0

    def walk(suite):
        nonlocal fails, passes, skips, flaky
        for spec in suite.get("specs", []):
            for t in spec.get("tests", []):
                project = t.get("projectName", "")
                res = t.get("results", [])
                status = res[-1]["status"] if res else "skipped"
                if status == "skipped":
                    skips += 1
                    continue
                if status == "passed":
                    if len(res) > 1:
                        flaky += 1
                        first = ANSI.sub("", (res[0].get("errors") or [{}])[0]
                                         .get("message", "")).strip()
                        flaky_rows.append(
                            f"| ⚠️ | {project} | {spec['title']} | passed on "
                            f"retry; first try: {first.splitlines()[0][:200] if first else '?'} |")
                    else:
                        passes += 1
                    continue
                fails += 1
                msgs = []
                for r in res:
                    for e in r.get("errors", []):
                        first = ANSI.sub("", e.get("message", "")).strip()
                        msgs.append(first.splitlines()[0][:220] if first else "")
                detail = " / ".join(m for m in msgs if m)[:900]
                rows.append(f"| ❌ | {project} | {spec['title']} | "
                            f"{detail.replace('|', '¦')} |")
        for s in suite.get("suites", []):
            walk(s)

    for s in data.get("suites", []):
        walk(s)
    text = ["## Browser pass (Chromium, Firefox, WebKit on the deploy)", "",
            f"{passes} passed · {flaky} flaky (passed on retry) · {fails} failed · "
            f"{skips} skipped", ""]
    if rows or flaky_rows:
        text += ["| | Browser | Test | First error lines |",
                 "|---|---|---|---|", *rows, *flaky_rows, "",
                 "A flaky test is not a pass: rerun it alone "
                 "(`browser.sh <url> <out> --project=<browser> --grep \"<title>\"`); "
                 "if it fails again it is a finding.", "",
                 "Full detail: `playwright-report/index.html` "
                 "(`npx playwright show-report <out>/playwright-report`)."]
    return "\n".join(text) + "\n", fails


def gallery(out, title):
    shots = os.path.join(out, "shots")
    groups = defaultdict(list)
    if os.path.isdir(shots):
        for section in sorted(os.listdir(shots)):
            d = os.path.join(shots, section)
            for f in sorted(os.listdir(d)):
                if f.endswith(".png"):
                    groups[section].append(f"shots/{section}/{f}")
    pdfs = []
    pdir = os.path.join(out, "print")
    if os.path.isdir(pdir):
        pdfs = [f"print/{f}" for f in sorted(os.listdir(pdir))
                if f.endswith(".pdf")]

    parts = [f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Checkpoint gallery</title>
<style>
:root {{ --bg:#fff; --fg:#1d1d1f; --muted:#666; --line:#ddd; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg:#141416; --fg:#eee; --muted:#aaa; --line:#333; }} }}
body {{ font: 15px/1.5 system-ui, sans-serif; margin: 0 16px 48px; background: var(--bg); color: var(--fg); }}
h1 {{ font-size: 22px; }} h2 {{ font-size: 18px; margin-top: 32px; border-bottom: 1px solid var(--line); }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }}
figure {{ margin: 0; }} figcaption {{ font-size: 13px; color: var(--muted); word-break: break-all; }}
img {{ width: 100%; border: 1px solid var(--line); background: #fff; }}
label {{ font-size: 14px; }}
.done figure {{ opacity: .45; }}
</style></head><body>
<h1>{html.escape(title)} — visual pass</h1>
<p>Look at every image: nothing clipped or overlapping, every leaf visible,
text readable, counts match, dark theme legible, printed pages light.
Tick a section when it is clean (the ticks are only for you; they are not
saved). Report: <a href="report.md">report.md</a>.</p>"""]
    if pdfs:
        parts.append("<h2>Print PDFs (Chromium)</h2><ul>")
        parts += [f'<li><a href="{html.escape(p)}">{html.escape(os.path.basename(p))}</a></li>'
                  for p in pdfs]
        parts.append("</ul>")
    for section, files in groups.items():
        sid = html.escape(section)
        parts.append(f'<section id="{sid}"><h2>{sid} '
                     f'<label><input type="checkbox" onchange="this.closest(\'section\')'
                     f'.classList.toggle(\'done\', this.checked)"> clean</label></h2>'
                     '<div class="grid">')
        for f in files:
            name = os.path.basename(f)[:-4]
            parts.append(f'<figure><a href="{html.escape(f)}"><img loading="lazy" '
                         f'src="{html.escape(f)}" alt="{html.escape(name)}"></a>'
                         f'<figcaption>{html.escape(name)}</figcaption></figure>')
        parts.append("</div></section>")
    parts.append("</body></html>")
    with open(os.path.join(out, "gallery.html"), "w") as fh:
        fh.write("\n".join(parts))
    return sum(len(v) for v in groups.values()), len(pdfs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--title", default="Release checkpoint")
    args = ap.parse_args()
    out = os.path.abspath(args.out)

    browser, bfails = browser_summary(out)
    nshots, npdfs = gallery(out, args.title)
    sections = [f"# {args.title}", ""]
    for name in ("preflight.md", None, "mega.md"):
        if name is None:
            sections.append(browser)
            continue
        p = os.path.join(out, name)
        sections.append(open(p).read() if os.path.exists(p)
                        else f"## {name[:-3]}\n\nNot run.\n")
    sections.append(f"## Visual pass\n\nOpen `gallery.html`: {nshots} screenshots, "
                    f"{npdfs} print PDFs.\n")
    with open(os.path.join(out, "report.md"), "w") as fh:
        fh.write("\n".join(sections))
    print(f"report: {os.path.join(out, 'report.md')}")
    print(f"gallery: {os.path.join(out, 'gallery.html')} ({nshots} shots, {npdfs} PDFs)")
    return 1 if bfails else 0


if __name__ == "__main__":
    sys.exit(main())
