# CI image for the r-and-fixtures job: pinned R + PHYLIP toolchain so the
# job does not reinstall the whole stack every run (~100–160 s saved).
#
# ape/phangorn are pinned to the versions recorded in the committed
# fixtures' "generator" field (ape 5.8.1 / phangorn 2.12.1 / phylip
# 3.697 — Ubuntu noble's `phylip` package), so FIXTURES=1 regeneration
# stays byte-stable. PHYLIP binaries land in /usr/lib/phylip/bin, which
# fixtures/generate_phylip.sh and scripts/ci/r-parity.sh already check.
#
# Published to ghcr.io/<owner>/neophylo-ci-r by
# .github/workflows/publish-ci-r.yml (monthly + when this file changes on
# main). ci.yml pins the moving `1` tag — bump it in both places for a
# breaking toolchain change.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# git: actions/checkout inside a container job; curl/ca-certificates:
# setup-node and other downloads; phylip: reference binaries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git \
      phylip \
      r-base r-base-dev gfortran \
      libblas-dev liblapack-dev \
      libcurl4-openssl-dev libssl-dev libxml2-dev \
 && rm -rf /var/lib/apt/lists/*

# Pinned reference packages (source builds — needs the -dev packages above).
# The stopifnot check makes a silent version drift fail the image build
# instead of producing subtly different fixtures in CI.
RUN Rscript -e 'install.packages("remotes", repos = "https://cloud.r-project.org")' \
 && Rscript -e 'remotes::install_version("ape", "5.8-1")' \
 && Rscript -e 'remotes::install_version("phangorn", "2.12.1")' \
 && Rscript -e 'remotes::install_version("jsonlite", "1.9.1")' \
 && Rscript -e 'stopifnot(as.character(packageVersion("ape")) == "5.8.1", as.character(packageVersion("phangorn")) == "2.12.1")' \
 && for b in neighbor protdist consense dnadist; do test -x "/usr/lib/phylip/bin/$b" || { echo "missing $b" >&2; exit 1; }; done
