# Release compliance checklist

Use this before publishing a FasterTest **Docker image** or GitHub Release that redistributes k6.
This is **not** formal legal advice.

## Pinned k6

- [ ] `Dockerfile` `ARG K6_VERSION` matches the version documented in `THIRD_PARTY_NOTICES.md`
- [ ] `K6_SHA256_AMD64` / `K6_SHA256_ARM64` match the official checksums file for that version
- [ ] Build fails if checksum verification fails (`sha256sum -c`)
- [ ] Unsupported architectures are rejected

## License files

- [ ] `licenses/k6/AGPL-3.0.txt` is the full upstream license text for the pinned version
- [ ] `licenses/fastertest/ISC.txt` matches `LICENSE`
- [ ] Image contains:
  - `/usr/share/licenses/fastertest/ISC.txt`
  - `/usr/share/licenses/k6/AGPL-3.0.txt`
  - `/usr/share/licenses/THIRD_PARTY_NOTICES.md` (and/or `/app/THIRD_PARTY_NOTICES.md`)

## Metadata

- [ ] `org.opencontainers.image.licenses` is **not** ISC-only when k6 is bundled (e.g.
      `ISC AND AGPL-3.0`)
- [ ] Labels set: `io.fastertest.k6.version`, `io.fastertest.k6.license`, `io.fastertest.k6.source`
- [ ] `/api/health` and `/api/version` expose k6 version metadata
- [ ] README contains the independence / trademark disclaimer

## Corresponding source

- [ ] Notices link to the **exact** Git tag and source archive for the pinned k6 version
- [ ] Prefer attaching/mirroring that source archive on the FasterTest GitHub Release for the same
      image tag (stronger long-term availability)
- [ ] Plan to keep corresponding source available for as long as the image is distributed

## Automation

- [ ] `npm test` includes `tests/unit/complianceLicenses.test.js`
- [ ] CI “License compliance” step is green

## Owner gates (explicit approval required)

- [ ] Publishing a GitHub Release / container registry tag
- [ ] Changing the FasterTest main license
- [ ] Renaming the project
- [ ] Rewriting git history (e.g. after a leaked secret)

## Employment / IP (human + legal)

Before public release, the maintainer should confirm privately:

- Whether the work was created under employment or using employer resources
- Whether invention-assignment agreements apply
- Whether any confidential company data remains in the tree or history

Do not commit private company information into this checklist.
