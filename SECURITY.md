# Security Policy

## Supported Version

Security fixes are applied to the current `main` branch and the latest published release.

## Reporting a Vulnerability

Use the repository's **Security** tab and select **Report a vulnerability** to open a private security advisory.

Do not disclose vulnerability details in a public issue, pull request, discussion, or commit.

Include:

- Affected version or commit
- Reproduction steps
- Expected impact
- Any suggested mitigation

Maintainers will acknowledge a valid report as soon as practical and coordinate disclosure after a fix is available.

## Deployment Security

Message Hub is self-hosted. Operators are responsible for:

- Protecting and rotating `API_KEYS` and webhook secrets
- TLS and reverse-proxy security
- Correct `TRUSTED_PROXIES` configuration
- Backups, retention, and access to the persistent volume
- Monitoring uploaded files and adding malware scanning where required
- Updating the application and dependencies

Never commit production environment files, databases, backups, API collections containing real keys, or deployment credentials.
