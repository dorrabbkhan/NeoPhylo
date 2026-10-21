//! Newick reading and writing (spec §4.4).
//!
//! Reading supports quoted labels (`'...'` with `''` for a literal quote),
//! branch lengths, internal labels and `[...]` comments (ignored). Malformed
//! input gives `NeoError::Parse { line, col, msg }` with 1-based positions.
//!
//! Writing is lossless for labels and lengths: labels containing whitespace,
//! any of `():;,'[]` or nothing at all are written single-quoted with `'`
//! doubled; lengths use Rust's `{}` shortest round-trip formatting.
//!
//! Node IDs follow the engine convention: leaves get `NodeId(0..n)` in
//! document (left-to-right) order and internal nodes are numbered in the
//! order their `(` is read (top-down, left-to-right). The parsed tree is
//! `rooted = true` when the root has exactly 2 children.
//!
//! A second writing mode emits "compatible" names for tools that
//! mishandle quoting (`ape::read.tree` keeps the quote characters and
//! coerces `'O''Brien'` to NA): every character outside
//! `[A-Za-z0-9._-]` becomes `_`, runs collapse, collisions get `_2`,
//! `_3`… and no quotes are written (checkpoint-15 owner finding).

use std::collections::HashSet;

use crate::error::NeoError;
use crate::tree::{NodeId, Tree};

/// Deepest accepted parenthesis nesting. A pectinate 200-taxon tree nests
/// about 198 deep, so this leaves ample headroom while keeping recursive
/// descent far from a stack overflow on adversarial input.
const MAX_DEPTH: usize = 1024;

/// Characters that may not appear in an unquoted label or length token.
/// `[` and `]` end tokens because they delimit comments.
fn is_delim(c: char) -> bool {
    matches!(c, '(' | ')' | ',' | ':' | ';' | '[' | ']' | '\'')
}

/// Parse a Newick string into a `Tree`. A branch length on the root is
/// accepted but dropped, because `branches[root]` is always `None`.
pub fn parse_newick(text: &str) -> Result<Tree, NeoError> {
    let mut p = Parser::new(text);
    p.skip_trivia()?;
    if p.eof() {
        return Err(p.err("expected a Newick tree"));
    }
    let raw = p.subtree(0)?;
    p.skip_trivia()?;
    p.expect(';')?;
    p.skip_trivia()?;
    if !p.eof() {
        return Err(p.err("unexpected characters after ';'"));
    }
    Ok(raw.into_tree())
}

/// Serialize `tree` as Newick. Iterative, so degenerate or cyclic inputs
/// cannot overflow the stack; unreachable or repeated nodes are skipped.
pub fn write_newick(tree: &Tree) -> String {
    write(tree, false)
}

/// Serialize `tree` as Newick with bootstrap support written as
/// internal node labels (v1.2 spec §6.8): a node whose branch carries
/// `Math.round(100·s)` as its label, the convention
/// `ape::read.tree`'s `node.label`, FigTree and iTOL read. The label
/// replaces any the node already had — a node can carry only one — and
/// `parse_newick` re-reads the values as ordinary internal labels.
pub fn write_newick_with_support(tree: &Tree) -> String {
    write(tree, true)
}

/// Serialize `tree` with tool-compatible names (no quotes): labels are
/// mapped per `compatible_names`. `support` selects integer-percent
/// internal labels exactly as `write_newick_with_support`.
pub fn write_newick_compatible(tree: &Tree, support: bool) -> String {
    write_mapped(tree, support, Some(&compat_label_map(tree)))
}

/// The `(original, exported)` renames a compatible write applies, in
/// node order (leaves are numbered in document order). Empty when every
/// label is already tool-safe.
pub fn compatible_names(tree: &Tree) -> Vec<(String, String)> {
    compat_label_map(tree)
        .iter()
        .enumerate()
        .filter_map(|(i, name)| {
            let name = name.as_ref()?;
            let orig = tree.nodes[i].label.as_deref()?;
            (orig != name).then(|| (orig.to_string(), name.clone()))
        })
        .collect()
}

/// True when a verbatim write would single-quote at least one label —
/// the condition under which compatible names become the better export
/// default, since quoted labels break ape/FigTree/iTOL.
pub fn labels_need_quotes(tree: &Tree) -> bool {
    tree.nodes
        .iter()
        .any(|n| n.label.as_deref().is_some_and(needs_quote))
}

/// Characters an unquoted compatible name may contain.
fn is_compat_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.')
}

/// Map a label to a tool-safe name: unsafe characters become `_`,
/// runs of `_` collapse to one, and the result is never empty.
fn sanitize_label(label: &str) -> String {
    let mut s = String::with_capacity(label.len());
    let mut pending_us = false;
    for c in label.chars() {
        if is_compat_char(c) {
            s.push(c);
            pending_us = false;
        } else if !pending_us {
            s.push('_');
            pending_us = true;
        }
    }
    if s.is_empty() {
        s.push('_');
    }
    s
}

/// The label every node gets in a compatible write: safe labels pass
/// through; unsafe ones are sanitized and made unique with `_2`,
/// `_3`… against each other and against names that were already safe
/// (which are reserved first so they keep their names).
fn compat_label_map(tree: &Tree) -> Vec<Option<String>> {
    let mut out: Vec<Option<String>> = vec![None; tree.nodes.len()];
    let mut used: HashSet<String> = tree
        .nodes
        .iter()
        .filter_map(|n| n.label.as_ref())
        .filter(|l| !l.is_empty() && l.chars().all(is_compat_char))
        .cloned()
        .collect();
    for (i, node) in tree.nodes.iter().enumerate() {
        let Some(label) = &node.label else { continue };
        if !label.is_empty() && label.chars().all(is_compat_char) {
            out[i] = Some(label.clone());
            continue;
        }
        let base = sanitize_label(label);
        let mut name = base.clone();
        let mut k = 2u32;
        while used.contains(&name) {
            name = format!("{base}_{k}");
            k += 1;
        }
        used.insert(name.clone());
        out[i] = Some(name);
    }
    out
}

fn write(tree: &Tree, support: bool) -> String {
    write_mapped(tree, support, None)
}

fn write_mapped(tree: &Tree, support: bool, names: Option<&[Option<String>]>) -> String {
    let mut out = String::new();
    let n = tree.nodes.len();
    if n == 0 || tree.root.0 as usize >= n {
        out.push(';');
        return out;
    }
    let mut seen = vec![false; n];
    seen[tree.root.0 as usize] = true;
    // Each entry is a node index plus the next child index to emit.
    let mut stack = vec![(tree.root.0 as usize, 0usize)];
    emit_open(tree, tree.root, &mut out);
    while let Some((u, ci)) = stack.pop() {
        if ci < tree.nodes[u].children.len() {
            stack.push((u, ci + 1));
            let c = tree.nodes[u].children[ci];
            if ci > 0 {
                out.push(',');
            }
            let i = c.0 as usize;
            if i < n && !seen[i] {
                seen[i] = true;
                stack.push((i, 0));
                emit_open(tree, c, &mut out);
            }
        } else {
            emit_close(tree, NodeId(u as u32), support, names, &mut out);
        }
    }
    out.push(';');
    out
}

/// Emit `(`, or nothing for a leaf.
fn emit_open(tree: &Tree, id: NodeId, out: &mut String) {
    if !tree.nodes[id.0 as usize].children.is_empty() {
        out.push('(');
    }
}

/// Emit `)`, then the label, then `:length` (never on the root). With
/// `support` a branch fraction wins over the node's own label and is
/// written bare as an integer percent clamped to 0–100 (NaN-safe).
/// `names`, when given, replaces every emitted label with the mapped
/// compatible name, written bare — the map guarantees it needs none.
fn emit_close(
    tree: &Tree,
    id: NodeId,
    support: bool,
    names: Option<&[Option<String>]>,
    out: &mut String,
) {
    let node = &tree.nodes[id.0 as usize];
    if !node.children.is_empty() {
        out.push(')');
    }
    // Internal nodes only: support labels mark groupings, and a leaf
    // must never lose its taxon name to a stray branch fraction.
    let s = (support && !node.children.is_empty())
        .then(|| tree.branches[id.0 as usize].support)
        .flatten();
    match s {
        Some(s) => {
            let pct = (s * 100.0).round().clamp(0.0, 100.0) as u64;
            out.push_str(&pct.to_string());
        }
        None => match names {
            Some(ns) => {
                if let Some(Some(name)) = ns.get(id.0 as usize) {
                    out.push_str(name);
                }
            }
            None => {
                if let Some(label) = &node.label {
                    write_label(label, out);
                }
            }
        },
    }
    if id != tree.root {
        if let Some(len) = tree.branch_length(id) {
            out.push(':');
            out.push_str(&len.to_string());
        }
    }
}

/// True when `label` must be single-quoted in standard Newick:
/// whitespace, a delimiter, `<`, `>` or empty. `<`/`>` are quoted so
/// markup-looking labels stay visibly literal (Review Focus 2).
fn needs_quote(label: &str) -> bool {
    label.is_empty()
        || label
            .chars()
            .any(|c| c.is_whitespace() || is_delim(c) || c == '<' || c == '>')
}

/// Write `label` bare, or single-quoted with `'` doubled when
/// `needs_quote` says so.
fn write_label(label: &str, out: &mut String) {
    let bare = !needs_quote(label);
    if bare {
        out.push_str(label);
        return;
    }
    out.push('\'');
    for c in label.chars() {
        if c == '\'' {
            out.push('\'');
        }
        out.push(c);
    }
    out.push('\'');
}

/// Intermediate parsed subtree; converted to a `Tree` by `into_tree`.
struct Raw {
    label: Option<String>,
    length: Option<f64>,
    children: Vec<Raw>,
}

impl Raw {
    fn into_tree(self) -> Tree {
        // Flatten in preorder so flat[0] is the root.
        let mut flat: Vec<(Option<String>, Option<f64>, Vec<usize>)> = Vec::new();
        fn flatten(r: Raw, flat: &mut Vec<(Option<String>, Option<f64>, Vec<usize>)>) -> usize {
            let me = flat.len();
            flat.push((r.label, r.length, Vec::new()));
            for c in r.children {
                let ci = flatten(c, flat);
                flat[me].2.push(ci);
            }
            me
        }
        flatten(self, &mut flat);

        // Assign ids: leaves 0..n in document order (preorder visits leaves
        // left-to-right), then internal nodes in preorder — the order a
        // parser "creates" them when reading `(`.
        let mut t = Tree::new();
        let mut ids = vec![NodeId(u32::MAX); flat.len()];
        for (i, (_, _, children)) in flat.iter().enumerate() {
            if children.is_empty() {
                ids[i] = t.add_node(flat[i].0.clone());
            }
        }
        for (i, (_, _, children)) in flat.iter().enumerate() {
            if !children.is_empty() {
                ids[i] = t.add_node(flat[i].0.clone());
            }
        }
        for (i, (_, _, children)) in flat.iter().enumerate() {
            for &c in children {
                t.attach(ids[i], ids[c], flat[c].1);
            }
        }
        t.set_root(ids[0]);
        t.rooted = flat[0].2.len() == 2;
        t
    }
}

struct Parser {
    src: Vec<char>,
    pos: usize,
}

impl Parser {
    fn new(text: &str) -> Self {
        Self {
            src: text.chars().collect(),
            pos: 0,
        }
    }

    fn eof(&self) -> bool {
        self.pos >= self.src.len()
    }

    fn peek(&self) -> Option<char> {
        self.src.get(self.pos).copied()
    }

    fn bump(&mut self) {
        self.pos += 1;
    }

    /// `line:col` is the 1-based position of the next unconsumed char.
    fn err(&self, msg: &str) -> NeoError {
        let (mut line, mut col) = (1u32, 1u32);
        for &c in &self.src[..self.pos.min(self.src.len())] {
            if c == '\n' {
                line += 1;
                col = 1;
            } else {
                col += 1;
            }
        }
        NeoError::Parse {
            line,
            col,
            msg: msg.to_string(),
        }
    }

    fn expect(&mut self, c: char) -> Result<(), NeoError> {
        if self.peek() == Some(c) {
            self.bump();
            Ok(())
        } else {
            Err(self.err(&format!("expected '{c}'")))
        }
    }

    /// Skip whitespace and `[...]` comments (possibly nested).
    fn skip_trivia(&mut self) -> Result<(), NeoError> {
        loop {
            match self.peek() {
                Some(c) if c.is_whitespace() => self.bump(),
                Some('[') => {
                    self.bump();
                    let mut depth = 1usize;
                    while depth > 0 {
                        match self.peek() {
                            None => return Err(self.err("unterminated comment")),
                            Some('[') => depth += 1,
                            Some(']') => depth -= 1,
                            Some(_) => {}
                        }
                        self.bump();
                    }
                }
                _ => return Ok(()),
            }
        }
    }

    fn subtree(&mut self, depth: usize) -> Result<Raw, NeoError> {
        if depth > MAX_DEPTH {
            return Err(self.err("tree is nested too deeply"));
        }
        self.skip_trivia()?;
        if self.peek() == Some('(') {
            self.bump();
            let mut children = vec![self.subtree(depth + 1)?];
            loop {
                self.skip_trivia()?;
                match self.peek() {
                    Some(',') => {
                        self.bump();
                        children.push(self.subtree(depth + 1)?);
                    }
                    Some(')') => {
                        self.bump();
                        break;
                    }
                    _ => return Err(self.err("expected ',' or ')'")),
                }
            }
            Ok(Raw {
                label: self.label()?,
                length: self.length()?,
                children,
            })
        } else {
            Ok(Raw {
                label: self.label()?,
                length: self.length()?,
                children: Vec::new(),
            })
        }
    }

    /// A quoted `'...'` label, an unquoted label, or `None` at a delimiter.
    fn label(&mut self) -> Result<Option<String>, NeoError> {
        self.skip_trivia()?;
        match self.peek() {
            Some('\'') => {
                self.bump();
                let mut s = String::new();
                loop {
                    match self.peek() {
                        None => return Err(self.err("unterminated quoted label")),
                        Some('\'') => {
                            self.bump();
                            if self.peek() == Some('\'') {
                                s.push('\'');
                                self.bump();
                            } else {
                                break;
                            }
                        }
                        Some(c) => {
                            s.push(c);
                            self.bump();
                        }
                    }
                }
                Ok(Some(s))
            }
            Some(c) if !is_delim(c) && !c.is_whitespace() => {
                let mut s = String::new();
                while let Some(c) = self.peek() {
                    if is_delim(c) || c.is_whitespace() {
                        break;
                    }
                    s.push(c);
                    self.bump();
                }
                Ok(Some(s))
            }
            _ => Ok(None),
        }
    }

    /// `:number` or `None`.
    fn length(&mut self) -> Result<Option<f64>, NeoError> {
        self.skip_trivia()?;
        if self.peek() != Some(':') {
            return Ok(None);
        }
        self.bump();
        self.skip_trivia()?;
        let mut s = String::new();
        while let Some(c) = self.peek() {
            if is_delim(c) || c.is_whitespace() {
                break;
            }
            s.push(c);
            self.bump();
        }
        if s.is_empty() {
            return Err(self.err("expected a branch length after ':'"));
        }
        s.parse::<f64>()
            .map(Some)
            .map_err(|_| self.err(&format!("invalid branch length '{s}'")))
    }
}
