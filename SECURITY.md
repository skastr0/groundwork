# Security Policy

## Supported Status

Groundwork is preview-stage and solo-maintained. Security reports are reviewed on a best-effort basis, without a formal response SLA.

## Reporting A Vulnerability

Please do not open a public issue for suspected vulnerabilities. Report privately through GitHub's private vulnerability reporting for this repository, or contact the maintainer directly if that is not yet enabled.

Include:

- affected version or commit
- reproduction steps
- impact
- relevant logs or proof of concept with private project data removed

## Scope

Groundwork CLI behavior, Codex hook installation, OpenCode plugin integration, policy evaluation, provenance reads, context discovery, risk checks, package contents, and documented workflows are in scope.

Third-party harnesses, user projects, local machine configuration, shell profiles, package manager accounts, and unrelated plugins are out of scope unless Groundwork directly mishandles them.

## Data Handling

Groundwork can inspect local repository state, inherited guidance files, commands, hook payloads, and configured policy files. Do not publish logs, reports, screenshots, or issue payloads that contain secrets, private project data, credentials, or private policy rules.
