
# IAM features

IAM management is a core capability of the Manager surface.

## IAM users

- created within an account
- associated with access keys
- policies define effective permissions

## IAM groups

- optional grouping mechanism
- used to attach policies at scale

## IAM roles

- define trust + permission policies
- enable STS-based workflows (when backend supports it)

## Policies

- always native IAM policies (JSON)
- no custom DSL or abstraction
- policy simulation is backend-dependent

## Safety notes

- s3-manager does not prevent dangerous policies
- guardrails should be implemented via process, not hidden logic
