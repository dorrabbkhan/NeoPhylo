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
/// `support` gets `Math.round(100·s)` as its label, the convention
/// `ape::read.tree`'s `node.label`, FigTree and iTOL read. The label
/// replaces any the node already had — a node can carry only one — and
/// `parse_newick` re-reads the values as ordinary internal labels.
pub fn write_newick_with_support(tree: &Tree) -> String {
    write(tree, true)
}

fn write(tree: &Tree, support: bool) -> String {
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
            emit_close(tree, NodeId(u as u32), support, &mut out);
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
fn emit_close(tree: &Tree, id: NodeId, support: bool, out: &mut String) {
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
        None => {
            if let Some(label) = &node.label {
                write_label(label, out);
            }
        }
    }
    if id != tree.root {
        if let Some(len) = tree.branch_length(id) {
            out.push(':');
            out.push_str(&len.to_string());
        }
    }
}

/// Write `label` bare, or single-quoted with `'` doubled when it contains
/// whitespace, a delimiter, `<`, `>` or is empty. `<`/`>` are quoted so
/// markup-looking labels stay visibly literal (Review Focus 2).
fn write_label(label: &str, out: &mut String) {
    let bare = !label.is_empty()
        && !label
            .chars()
            .any(|c| c.is_whitespace() || is_delim(c) || c == '<' || c == '>');
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
