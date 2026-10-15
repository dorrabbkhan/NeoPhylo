#!/usr/bin/env bash
# One-time NeoPhylo dev machine setup for Ubuntu 22.04 / 24.04.
# Run as your normal user (NOT with sudo): bash setup-ubuntu.sh
set -euo pipefail

echo "== System packages (build tools, R build deps, PHYLIP, GitHub CLI)"
sudo apt update
sudo apt install -y build-essential curl git pkg-config libssl-dev \
  r-base r-base-dev libcurl4-openssl-dev libxml2-dev libglpk-dev libgmp-dev \
  phylip gh

echo "== Rust (stable + wasm target + nightly for fuzzing)"
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
fi
source "$HOME/.cargo/env"
rustup toolchain install stable --component clippy,rustfmt
rustup target add wasm32-unknown-unknown
rustup toolchain install nightly --profile minimal
cargo install wasm-pack cargo-fuzz

echo "== Node.js LTS via nvm"
if [ ! -d "$HOME/.nvm" ]; then
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"
nvm install --lts
nvm alias default 'lts/*'

echo "== R packages (compiles from source; can take 10-20 minutes)"
mkdir -p "$HOME/R/library"
grep -q R_LIBS_USER "$HOME/.Renviron" 2>/dev/null || echo "R_LIBS_USER=$HOME/R/library" >> "$HOME/.Renviron"
Rscript -e 'install.packages(c("ape","phangorn","jsonlite"), repos="https://cloud.r-project.org", lib=Sys.getenv("R_LIBS_USER"))'

echo
echo "== Versions"
rustc --version; cargo --version; wasm-pack --version
cargo +nightly --version
node --version; npm --version
Rscript -e 'cat("ape", as.character(packageVersion("ape")), " phangorn", as.character(packageVersion("phangorn")), "\n")'
{ ls /usr/lib/phylip/bin 2>/dev/null | grep -qE "^dnadist$" && echo "PHYLIP ok (run as: phylip dnadist)"; } || echo "PHYLIP not found in /usr/lib/phylip/bin - run: dpkg -L phylip | grep dnadist"
echo
echo "Done. Open a NEW terminal so PATH changes (cargo, nvm) take effect."
