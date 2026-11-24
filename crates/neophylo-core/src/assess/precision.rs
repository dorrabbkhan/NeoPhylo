//! Display precision for numeric tasks (v1.5 spec §5.3, plan Task 4):
//! every quantity is graded at **3 decimals** — what the app already
//! shows for trace numbers (`web/src/explain/math.ts:16`,
//! `toFixed(3)`) and corrected distances
//! (`web/src/views/PairPanel.tsx:76`). Student numbers travel as
//! scaled integers (`TaskAnswer::Number`), so a task is correct
//! exactly when the student's value, scaled here, equals the key.
//!
//! Rounding is **half away from zero on the exact decimal value of
//! the f64** — the same rule JavaScript's `toFixed` applies — NOT
//! `(x * 10^d).round()`, which double-rounds through the scaled
//! binary value (e.g. `1.005` is `1.00499…` in binary, so it rounds
//! down, while `0.125` is exact and rounds up).

use crate::assess::task::Quantity;
use crate::error::NeoError;

/// Decimal places per quantity — a table so the TS export in Task 6
/// can name quantities, not just the single number they all share.
/// Keep every entry at 3: that is what the app displays everywhere a
/// trace number appears (see the module docs).
pub const PRECISION: &[(Quantity, u8)] = &[
    (Quantity::QValue, 3),
    (Quantity::BranchLength, 3),
    (Quantity::NewDistance, 3),
    (Quantity::CorrectedDistance, 3),
];

/// `PRECISION` as a lookup — 3 for every quantity today.
pub fn decimals(q: Quantity) -> u8 {
    PRECISION
        .iter()
        .find(|(k, _)| *k == q)
        .map(|(_, d)| *d)
        .unwrap_or(3)
}

/// `x` scaled to `d` decimals as an integer, rounding half away from
/// zero on the exact decimal expansion of `x` (the `toFixed` rule).
/// Non-finite values (saturated distances) and magnitudes that cannot
/// fit an `i64` are `InvalidAssignment`, never a panic.
///
/// Implemented on the decimal text because the f64's exact expansion
/// is what decides a tie — `format!("{:.1100}", x.abs())` prints every
/// significant digit the binary value expands to (the fraction part of
/// a finite f64 never exceeds ~1,074 digits).
pub fn scaled(x: f64, d: u8) -> Result<i64, NeoError> {
    if !x.is_finite() {
        return Err(NeoError::InvalidAssignment {
            field: "value".to_string(),
            msg: "quantity is not finite".to_string(),
        });
    }
    let d = d as usize;
    let text = format!("{:.1100}", x.abs());
    let (int, frac) = text.split_once('.').unwrap_or((text.as_str(), ""));
    let int = int.trim_start_matches('+');
    // The scaled digit string must fit an i128 before the i64 check.
    if int.len() + d > 38 {
        return Err(NeoError::InvalidAssignment {
            field: "value".to_string(),
            msg: "scaled value overflows i64".to_string(),
        });
    }
    let mut digits = String::with_capacity(int.len() + d);
    digits.push_str(int);
    digits.extend(frac.chars().take(d));
    let mut v: i128 = digits.parse().map_err(|_| NeoError::InvalidAssignment {
        field: "value".to_string(),
        msg: "scaled value overflows i64".to_string(),
    })?;
    if frac.chars().nth(d).is_some_and(|c| c >= '5') {
        v += 1;
    }
    let v = if x.is_sign_negative() { -v } else { v };
    i64::try_from(v).map_err(|_| NeoError::InvalidAssignment {
        field: "value".to_string(),
        msg: "scaled value overflows i64".to_string(),
    })
}

/// `scaled` at the quantity's display precision — the numeric task key.
pub fn scaled_quantity(q: Quantity, x: f64) -> Result<i64, NeoError> {
    scaled(x, decimals(q))
}
