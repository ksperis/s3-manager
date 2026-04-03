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

## Container publishing

GitLab CI is the single source of truth for official container images.
It builds once, scans the immutable `$CI_COMMIT_SHA` image, then promotes that exact artifact to the public tags in both GitLab Container Registry and GHCR.

Current public tags:

- `dev` and `dev-<short-sha>` from branch `dev`
- `latest` from the default branch
- exact Git tags for releases

If a separate GitHub-side workflow still publishes images, disable it or restrict it to release metadata only. Do not rebuild official images in two CI systems.
