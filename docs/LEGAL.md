# Legal notes (FasterTest)

This document is an **engineering compliance aid**. It is **not** formal legal advice. Have a
qualified lawyer review redistribution of Docker images that include third-party binaries before
commercial launch or wide distribution.

## Component licenses

| Component                         | License                           | Where                                                                                          |
| --------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| FasterTest application source     | ISC                               | [LICENSE](../LICENSE), [licenses/fastertest/ISC.txt](../licenses/fastertest/ISC.txt)           |
| Bundled k6 binary (Docker images) | AGPL-3.0 (upstream SPDX metadata) | Binary from GitHub Releases; full text [licenses/k6/AGPL-3.0.txt](../licenses/k6/AGPL-3.0.txt) |
| npm runtime dependencies          | Various (mostly MIT / BSD)        | [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)                                            |

The FasterTest Docker image contains **multiple** licensed works. OCI label
`org.opencontainers.image.licenses` uses an SPDX expression such as `ISC AND AGPL-3.0` to reflect
that fact. It must **not** be set to ISC alone when k6 is bundled.

## How FasterTest uses k6

- FasterTest executes k6 as a **separate child process** (`spawn`).
- FasterTest does **not** modify k6 source and does **not** link against k6 libraries.
- Docker builds download a **pinned** k6 release binary and verify it with **SHA256**.
- Application code (ISC) and the k6 binary (AGPL-3.0) are **separately licensed**.

Executing an unmodified binary does **not** mean AGPL obligations never apply. **Redistributing**
the k6 binary inside a container image creates notice and corresponding-source obligations for the
**image distributor**. Whether AGPL’s network provisions apply to a hosted service that shells out
to k6 requires **legal counsel**.

## Corresponding source

For the pinned Docker k6 version, corresponding source must remain available for as long as images
containing that binary are distributed. Prefer:

1. Immutable Git tag / source archive URLs listed in
   [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)
2. Optionally mirroring the exact `vX.Y.Z` source archive on FasterTest GitHub Release assets

Do not point only at a floating default branch.

## What this repository does not do

- Does not change the FasterTest main license without owner approval
- Does not claim the project is legally risk-free
- Does not claim trademark clearance for the name “FasterTest”

See also [TRADEMARKS.md](./TRADEMARKS.md) and [RELEASE_COMPLIANCE.md](./RELEASE_COMPLIANCE.md).
