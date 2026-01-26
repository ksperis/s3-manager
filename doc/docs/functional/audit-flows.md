
# Audit flows

This page describes how functional actions map to audit events.

## Event structure

A typical audit event includes:

- timestamp
- UI user identity
- surface
- executor identity
- action type
- target resource
- outcome (success / failure)

## Examples

### Bucket deletion

- action: `bucket.delete`
- executor: IAM user `alice`
- target: `bucket:example-data`
- result: `AccessDenied`

### Policy update

- action: `iam.policy.update`
- executor: account-root
- target: `policy:readonly-buckets`
- result: `Success`

## Functional goal

Audits are not only for compliance:
- they are critical for debugging
- they explain *why* something failed
- they preserve operator confidence
