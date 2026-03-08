# Principles

## IAM as source of truth

Authorization is decided by storage IAM/S3, not by UI shadow rules.

## No hidden permission model

Changes should map to native storage/IAM constructs.

## Credential hygiene

UI identity and storage credentials are intentionally decoupled.

## Auditability by design

Sensitive operations must remain attributable (actor, executor, target, outcome).
