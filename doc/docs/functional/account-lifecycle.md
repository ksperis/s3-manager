
# S3 Account lifecycle

This page documents the functional lifecycle of an S3 Account as seen in s3-manager.

## Creation

Account creation typically involves:

- creating or importing an account on the backend (Ceph RGW)
- ensuring a **root user** exists
- storing references in the local database

Creation is performed from the **Admin** surface.

## Initialization

Optional initialization steps:

- default quotas
- baseline IAM policies
- naming conventions

These steps are intentionally explicit to avoid “magic defaults”.

## Operational phase

During normal operation:

- Manager users operate *within* an execution context (account or connection)
- buckets and IAM resources are scoped to the account
- usage and stats are collected

## Decommissioning

Account deletion is intentionally conservative:

- ensure no buckets remain
- ensure IAM resources are cleaned up
- revoke or archive credentials

s3-manager should prefer **explicit teardown workflows**
over one-click destructive actions.
