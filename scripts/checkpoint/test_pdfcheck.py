#!/usr/bin/env python3
"""Unit tests for scripts/checkpoint/pdfcheck.py — the paper-text
port, the positional line parser, the lone-caption rule and the
per-PDF verdict. Drives check_pdf with synthetic text; no PDFs needed.

    python3 -I scripts/checkpoint/test_pdfcheck.py
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pdfcheck

TSV_HEAD = ("level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\t"
            "left\ttop\twidth\theight\tconf\ttext\n")


def tsv(lines, page=1):
    """[("Tree", "1"), ("A",)] → a -tsv document: one par/block, each
    inner list a line of words laid out left to right at line-height
    steps."""
    rows = [TSV_HEAD]
    for ln, words in enumerate(lines):
        left = 60.0
        for wn, word in enumerate(words):
            rows.append("5\t%d\t0\t0\t%d\t%d\t%.2f\t%.2f\t20\t14\t100\t%s\n"
                        % (page, ln, wn, left, 40 + 16 * ln, word))
            left += 30.0
    return "".join(rows)


class PaperTextTest(unittest.TestCase):
    def test_fill_placeholders(self):
        item = {"text": "Compare {a} and {b}. Tap every tip of {set}.",
                "a": "cat", "b": "dog",
                "tips": ["cat", "dog", "rat"]}
        self.assertEqual(
            pdfcheck.fill_placeholders(item["text"], item),
            "Compare cat and dog. Tap every tip of cat, dog and rat.")

    def test_reverb_sentence_initial(self):
        item = {"text": "Tap every tip that has hair.", "tips": []}
        self.assertEqual(pdfcheck.paper_text(item),
                         "Circle every tip that has hair.")

    def test_reverb_second_sentence(self):
        item = {"text": "Look at the tree. Select every true statement.",
                "tips": []}
        self.assertEqual(
            pdfcheck.paper_text(item),
            "Look at the tree. Tick every true statement.")

    def test_unmapped_verb_keeps_authored(self):
        item = {"text": "Click the node you trust.", "tips": []}
        self.assertEqual(pdfcheck.paper_text(item),
                         "Click the node you trust.")

    def test_arrange_clause_dropped(self):
        item = {"text": "Tap the lettered nodes in order, or arrange "
                        "the list on paper.", "tips": []}
        self.assertEqual(pdfcheck.paper_text(item),
                         "Write the letters of the nodes in order on "
                         "paper.")

    def test_table_matches_typescript_source(self):
        """The ported PAPER_VERBS stays in sync with the TS table."""
        with open(os.path.join(
                pdfcheck.REPO,
                "web/src/worksheets/reading.ts")) as fh:
            src = fh.read()
        for frm, to in pdfcheck.PAPER_VERBS:
            self.assertIn(f'"{frm}"', src, f"{frm!r} missing from TS")
            self.assertIn(f'"{to}"', src, f"{to!r} missing from TS")


class TsvTest(unittest.TestCase):
    def test_pages_split_on_formfeed(self):
        self.assertEqual(pdfcheck.pages_of("a\fb\n\fc"),
                         ["a", "b\n", "c"])

    def test_tsv_lines_group_words(self):
        pages = pdfcheck.tsv_lines(tsv([["Tree", "1"], ["A", "B"]]))
        self.assertEqual(pages[1][0][3], "Tree 1")
        self.assertEqual(pages[1][1][3], "A B")

    def test_normalize_folds_whitespace_and_ligatures(self):
        self.assertEqual(pdfcheck.normalize("  a\nb\tc  "), "a b c")
        self.assertEqual(pdfcheck.normalize("ﬁnd"), "find")


class LoneCaptionTest(unittest.TestCase):
    def test_orphan_flagged(self):
        # A tip label above, then the caption alone at the page bottom.
        pages = pdfcheck.tsv_lines(
            tsv([["A"], ["B"], ["Tree", "3"]]))
        self.assertEqual(pdfcheck.lone_captions(pages), [1])

    def test_options_run_not_flagged(self):
        # "Circle one." then consecutive same-indent "Tree 1"/"Tree 2"
        # — the bottom "Tree 2" is an option, not a caption.
        pages = pdfcheck.tsv_lines(
            tsv([["Circle", "one."], ["Tree", "1"], ["Tree", "2"]]))
        self.assertEqual(pdfcheck.lone_captions(pages), [])

    def test_caption_mid_page_not_flagged(self):
        pages = pdfcheck.tsv_lines(
            tsv([["Tree", "2"], ["A", "B", "C"], ["more", "text"]]))
        self.assertEqual(pdfcheck.lone_captions(pages), [])

    def test_non_caption_last_line_fine(self):
        pages = pdfcheck.tsv_lines(
            tsv([["Tree", "frogs"], ["an", "answer"]]))
        self.assertEqual(pdfcheck.lone_captions(pages), [])


class ReadSheetTest(unittest.TestCase):
    """check_pdf on a *-read-sheet.pdf name reads the committed set."""

    def test_item1_prompt_required_on_page1(self):
        ok, detail = pdfcheck.check_pdf(
            "trees-demo-read-sheet.pdf",
            ["NeoPhylo — worksheet\nTree reading\nnothing else"], {})
        self.assertFalse(ok)
        self.assertIn("page 1 missing item 1's prompt", detail)

    def test_clean_sheet_passes(self):
        # Rebuild what a perfect sheet's text would be: the masthead
        # plus every item's paper prompt, one item per page.
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        pages = ["masthead\n" + pdfcheck.normalize(
            pdfcheck.paper_text(sheet["items"][0]))]
        pages += [pdfcheck.normalize(pdfcheck.paper_text(it))
                  for it in sheet["items"][1:]]
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertTrue(ok, detail)

    def test_split_word_fails_rule_c(self):
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        p0 = pdfcheck.normalize(pdfcheck.paper_text(sheet["items"][0]))
        pages = ["masthead\n" + p0.replace(" ", "", 1)]
        pages += [pdfcheck.normalize(pdfcheck.paper_text(it))
                  for it in sheet["items"][1:]]
        # First prompt now has a glued word pair — the prompt-whole
        # rule must catch it.
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertFalse(ok)
        self.assertIn("prompts split or missing", detail)

    def test_unknown_set_flagged(self):
        ok, detail = pdfcheck.check_pdf("no-such-set-read-sheet.pdf",
                                        ["x"], {})
        self.assertFalse(ok)
        self.assertIn("no exercise file", detail)


if __name__ == "__main__":
    unittest.main()
