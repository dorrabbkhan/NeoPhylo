//! Generated JTT constants and `RateModel::transition_probs` (v1.1 spec §3.3).
//!
//! The tests rebuild `Q = U·diag(λ)·U⁻¹` from the committed constants and
//! check the rate-matrix identities a reversible model must satisfy.

use neophylo_core::model::{jtt_constants as jtt, JTT};

const N: usize = 20;
const TOL: f64 = 1e-12;

fn mat_mul(a: &[[f64; N]; N], b: &[[f64; N]; N]) -> [[f64; N]; N] {
    let mut out = [[0.0; N]; N];
    for (i, row) in out.iter_mut().enumerate() {
        for (j, cell) in row.iter_mut().enumerate() {
            *cell = (0..N).map(|k| a[i][k] * b[k][j]).sum();
        }
    }
    out
}

fn diag(d: &[f64; N]) -> [[f64; N]; N] {
    let mut out = [[0.0; N]; N];
    for (i, (row, &d_i)) in out.iter_mut().zip(d.iter()).enumerate() {
        row[i] = d_i;
    }
    out
}

/// Q rebuilt from the stored eigendecomposition.
fn rate_matrix() -> [[f64; N]; N] {
    mat_mul(&mat_mul(&jtt::U, &diag(&jtt::EIGVALS)), &jtt::U_INV)
}

#[test]
fn normalized() {
    // Q is scaled so -Σ πᵢ qᵢᵢ = 1: distances are expected substitutions
    // per site (protdist units, 1.0 = 100 PAM).
    let q = rate_matrix();
    let rate: f64 = (0..N).map(|i| jtt::FREQS[i] * q[i][i]).sum();
    assert!((-rate - 1.0).abs() < TOL, "-Σ πᵢ qᵢᵢ = {}", -rate);
}

#[test]
fn rows_sum_zero() {
    let q = rate_matrix();
    for (i, row) in q.iter().enumerate() {
        let sum: f64 = row.iter().sum();
        assert!(sum.abs() < TOL, "Q row {i} sums to {sum}");
    }
}

#[test]
fn reversible() {
    let q = rate_matrix();
    for (i, row) in q.iter().enumerate() {
        for (j, &q_ij) in row.iter().enumerate() {
            let fwd = jtt::FREQS[i] * q_ij;
            let rev = jtt::FREQS[j] * q[j][i];
            assert!(
                (fwd - rev).abs() < TOL,
                "π{i}·q({i},{j}) = {fwd} but π{j}·q({j},{i}) = {rev}"
            );
        }
    }
}

#[test]
fn p_zero_identity() {
    let p = JTT.transition_probs(0.0);
    for (i, row) in p.iter().enumerate() {
        for (j, &p_ij) in row.iter().enumerate() {
            let want = if i == j { 1.0 } else { 0.0 };
            assert!((p_ij - want).abs() < TOL, "P(0)[{i}][{j}] = {p_ij}");
        }
    }
}

#[test]
fn rows_sum_one() {
    for t in [0.01, 0.1, 1.0, 5.0] {
        let p = JTT.transition_probs(t);
        for (i, row) in p.iter().enumerate() {
            let sum: f64 = row.iter().sum();
            assert!((sum - 1.0).abs() < TOL, "P({t}) row {i} sums to {sum}");
        }
    }
}

#[test]
fn eigvals() {
    // Exactly one eigenvalue ~0 (the stationary direction); the rest are
    // strictly negative for a reversible rate matrix.
    let near_zero = jtt::EIGVALS.iter().filter(|&&l| l.abs() < TOL).count();
    assert_eq!(near_zero, 1, "eigenvalues: {:?}", jtt::EIGVALS);
    for &l in &jtt::EIGVALS {
        assert!(l < TOL, "eigenvalue {l} is not < 0 or ~0");
    }
}

#[test]
fn freqs_sum_one() {
    let sum: f64 = jtt::FREQS.iter().sum();
    assert!((sum - 1.0).abs() < TOL, "Σ πᵢ = {sum}");
}
