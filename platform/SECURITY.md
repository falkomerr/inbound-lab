# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Please report privately so we can fix and disclose responsibly:

Use the private reporting channel of the Inbound Lab repository, when enabled.
See [the Inbound Lab security policy](../SECURITY.md). Do not send reports about
Inbound Lab to the upstream FasterTest maintainers or expose secrets in public issues.

Include:

- Affected version or commit
- Steps to reproduce
- Impact (auth bypass, data exposure, RCE, etc.)
- Any suggested fix

We aim to acknowledge reports within **7 days** and ship a fix or mitigation as soon as practical.

## Security notes for operators

- Never commit `.env`, database dumps, or `data/*.json` (passwords/tokens).
- Generate a unique `JWT_SECRET` per deployment.
- Prefer MySQL for shared / production installs.
- Restrict network access to the UI port; put TLS termination in front (nginx/caddy).
- Point `BASE_URL` only at systems you are authorized to load-test.
