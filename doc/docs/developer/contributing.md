# Contributing

## Expectations

- Keep IAM-aligned behavior.
- Avoid introducing hidden authorization layers.
- Update documentation when behavior changes.

## Pull request checklist

- clear intent
- tests or verification notes
- migration notes when schema changes
- doc updates for user-visible changes
- security findings reviewed when CI reports secret, dependency, or image vulnerabilities
- any temporary Trivy exception added to `.trivyignore` is justified, time-boxed, and tracked in the MR
