# Security Policy

## Supported versions

Harapter is pre-alpha and has no supported runtime packages yet. Security fixes
apply to the default branch until the first supported release line is declared.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use the repository's
private vulnerability reporting form under **Security → Advisories → Report a
vulnerability**.

Include the affected component, impact, reproduction steps, and any suggested
mitigation. Do not include live credentials, private prompts, customer data, or
unredacted provider traffic.

Maintainers will acknowledge a complete report as soon as practical, coordinate
validation and remediation privately, and publish an advisory when a fix or
mitigation is available.

## Security boundaries

Harapter normalizes calls and events; it is not a sandbox or a policy engine.
Host applications and harness runtimes remain responsible for tool permissions,
process isolation, network policy, credential storage, and user approval.
