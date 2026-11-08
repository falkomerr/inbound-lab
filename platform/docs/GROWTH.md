# How to get GitHub stars for FasterTest

Practical checklist after the code is public.

## 1. Create the public repo

```bash
# From this folder (after committing):
git remote add origin https://github.com/alirezaedalat/fastertest.git
git push -u origin main
```

On GitHub → **Settings → General**:

- Description: `Open-source k6 load testing platform with a secure web UI`
- Website: leave blank or your demo URL
- Topics: `k6` `load-testing` `performance` `nodejs` `mysql` `devops` `sre` `open-source` `web-ui`

Enable:

- Issues
- Discussions (optional but good for questions)
- **Sponsor** later if you want

## 2. First release

GitHub → **Releases → Draft a new release**

- Tag: `v1.0.0`
- Title: `FasterTest v1.0.0`
- Paste highlights from `CHANGELOG.md`

Releases drive discovery more than silent commits.

## 3. Social proof in the first 48 hours

Stars come from people _seeing_ the repo:

1. Post a short demo (30–60s screen recording) on X / LinkedIn / Reddit (`r/devops`, `r/selfhosted`,
   `r/qualityassurance`)
2. Share in k6 / Grafana community Slack/Discord if allowed
3. Answer 2–3 related Stack Overflow / Reddit questions and link the repo when relevant (don’t spam)

## 4. README keeps converting

Already improved in this repo:

- Logo hero
- Why table
- One-command quick start
- Badges (CI, license, stars)

Next upgrade when you can: add a **GIF/screenshot of the UI** under Features (`docs/images/ui.gif`).

## 5. Keep CI green

Every PR should keep `npm test` + `npm run lint` green — broken CI kills trust (and stars).

## 6. Good first issues

Label a few issues `good first issue` / `help wanted` so newcomers can land PRs.
