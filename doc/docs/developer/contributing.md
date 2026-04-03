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

## CI test reports

GitLab pipelines publish JUnit XML test reports for:

- `backend-tests`
- `frontend-tests`
- `ceph-functional-tests` when that job is enabled by CI variables

These reports feed the pipeline **Tests** tab and merge request **Test summary** panel.
They do not make jobs fail by themselves; the test command exit code remains the blocking signal.

Useful local commands:

- backend: `cd backend && PYTHONPATH=. ./.venv/bin/pytest tests -q`
- frontend: `cd frontend && npm test`
