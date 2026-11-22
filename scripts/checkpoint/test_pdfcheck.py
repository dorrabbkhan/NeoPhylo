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


def fixture_pages(name):
    """testdata/<name>.txt — extracted `pdftotext` output of a real
    after-PDF — split into pages."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "testdata", name)
    with open(path) as fh:
        return pdfcheck.pages_of(fh.read())


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
        # plus every item's paper prompt, one item per page — the
        # figure text trailing each prompt stands in for its trees.
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        pages = ["masthead\n" + pdfcheck.normalize(
            pdfcheck.paper_text(sheet["items"][0])) + "\nfigure text"]
        pages += [pdfcheck.normalize(pdfcheck.paper_text(it))
                  + "\nfigure text" for it in sheet["items"][1:]]
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertTrue(ok, detail)

    def test_split_word_fails_rule_c(self):
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        p0 = pdfcheck.normalize(pdfcheck.paper_text(sheet["items"][0]))
        pages = ["masthead\n" + p0.replace(" ", "", 1)]
        pages += [pdfcheck.normalize(pdfcheck.paper_text(it))
                  + "\nfigure text" for it in sheet["items"][1:]]
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


class PromptPageTest(unittest.TestCase):
    """Rule (d): a prompt must lie wholly on one page and never be
    that page's last text — its first figure follows it."""

    def _pages(self):
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        return sheet, [
            "masthead\n" + pdfcheck.normalize(
                pdfcheck.paper_text(it)) + "\nfigure text"
            for it in sheet["items"]]

    def test_whole_prompt_with_figure_passes(self):
        _, pages = self._pages()
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertTrue(ok, detail)

    def test_split_prompt_fails(self):
        sheet, pages = self._pages()
        p1 = pdfcheck.normalize(pdfcheck.paper_text(sheet["items"][1]))
        cut = p1.rfind(" ")
        # Split item 2's prompt across pages 2 and 3 — it still
        # normalises whole across pages, so only (d) catches it.
        pages[1] = pages[1].replace(p1, p1[:cut])
        pages[2] = p1[cut + 1:] + "\nfigure text\n" + pages[2]
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertFalse(ok)
        self.assertIn("item 2 prompt split across pages", detail)

    def test_prompt_last_on_page_fails(self):
        sheet, pages = self._pages()
        p1 = pdfcheck.normalize(pdfcheck.paper_text(sheet["items"][1]))
        # Item 2's prompt ends its page; its figure text moved to the
        # next page — the stranded prompt must fail.
        pages[1] = pages[1].replace("\nfigure text", "")
        pages[2] = "figure text\n" + pages[2]
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-sheet.pdf", pages, {})
        self.assertFalse(ok)
        self.assertIn("item 2 prompt is last on page 2", detail)

    def test_key_items_get_rule_d(self):
        sheet = pdfcheck.load_set("trees-reading-a-tree")
        pages = [
            "masthead\n" + pdfcheck.normalize(
                pdfcheck.paper_text(it)) + "\nan answer"
            for it in sheet["items"]]
        ok, detail = pdfcheck.check_pdf(
            "trees-reading-a-tree-read-key.pdf", pages, {})
        self.assertTrue(ok, detail)

    def test_fixture_cov_styles_fails_d(self):
        """The 6189dae5 after-PDF: item 3's prompt ends page 3 split
        — extracted pdftotext, so this is the real finding."""
        ok, detail = pdfcheck.check_pdf(
            "cov-styles-read-sheet.pdf",
            fixture_pages("cov-styles-read-sheet.txt"), {})
        self.assertFalse(ok)
        self.assertIn("item 3 prompt", detail)

    def test_fixture_cov_statements_fails_d(self):
        """Item 3's prompt ends page 2, item 7's ends page 4."""
        ok, detail = pdfcheck.check_pdf(
            "cov-statements-read-sheet.pdf",
            fixture_pages("cov-statements-read-sheet.txt"), {})
        self.assertFalse(ok)
        self.assertIn("item 3 prompt", detail)
        self.assertIn("item 7 prompt", detail)


class LastPageTest(unittest.TestCase):
    """Rule (e): the last page must hold more than the footer line
    and the QR/hand-in block."""

    def test_footer_only_last_page_fails(self):
        pages = ["items and figures", "Printed from NeoPhylo — "
                 "worksheet for Tree reading — form B."]
        ok, detail = pdfcheck.check_pdf("any-sheet.pdf", pages, {})
        self.assertFalse(ok)
        self.assertIn("last page holds only", detail)

    def test_qr_block_plus_footer_only_fails(self):
        pages = ["items and figures",
                 "Open this set in NeoPhylo\n"
                 "Check your answers in the app — scan the code or "
                 "follow the link:\nhttps://example.org/?read=x\n"
                 "Printed from NeoPhylo — worksheet for Set."]
        ok, detail = pdfcheck.check_pdf("any-sheet.pdf", pages, {})
        self.assertFalse(ok)
        self.assertIn("last page holds only", detail)

    def test_content_plus_footer_passes(self):
        pages = ["items and figures",
                 "Answer (the taxa):\n"
                 "Printed from NeoPhylo — worksheet for Set."]
        ok, detail = pdfcheck.check_pdf("any-sheet.pdf", pages, {})
        self.assertTrue(ok, detail)

    def test_fixture_form_b_fails_e(self):
        """The 6189dae5 after-PDF: page 7 holds only the footer."""
        ok, detail = pdfcheck.check_pdf(
            "trees-form-b-read-sheet.pdf",
            fixture_pages("trees-form-b-read-sheet.txt"), {})
        self.assertFalse(ok)
        self.assertIn("last page holds only", detail)


if __name__ == "__main__":
    unittest.main()
