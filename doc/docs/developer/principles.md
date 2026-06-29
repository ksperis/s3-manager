# Principles

## Authorization source of truth

Native storage workflows are decided by storage IAM/S3, not by UI shadow rules.
Portal Storage Space visibility and collaborator roles are decided by Portal
metadata and grants stored in the database, then projected to IAM for personal
S3 keys.

## No hidden permission model

Changes should map to native storage/IAM constructs, or to explicit Portal
Storage Space metadata and grant records when the workflow is Portal-specific.

## Credential hygiene

UI identity and storage credentials are intentionally decoupled.

## Auditability by design

Sensitive operations must remain attributable (actor, executor, target, outcome).
