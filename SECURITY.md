# Security policy

## Supported versions

Security fixes are made on the latest release and the default branch. Older
releases may not receive backports while Engram is pre-1.0.

## Reporting a vulnerability

Please do not open a public issue containing exploit details, secrets, or
private memory data. Use GitHub's private vulnerability reporting flow for
this repository. If that option is unavailable, contact the maintainer through
their GitHub profile first and wait for a private reporting channel.

Include the affected version or commit, operating system, agent client, impact,
and minimal reproduction steps. Replace real credentials and memory contents
with synthetic examples.

## Security boundaries

Engram is local developer tooling. It does not encrypt its SQLite database and
is not designed to isolate mutually untrusted users on the same operating
system account. The HTTP service is intended for loopback use only. Secret
pattern detection reduces accidental storage but is not a security boundary.
