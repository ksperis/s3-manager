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
- `frontend-browser-e2e`
- `ceph-functional-tests` when that job is enabled by CI variables

These reports feed the pipeline **Tests** tab and merge request **Test summary** panel.
They do not make jobs fail by themselves; the test command exit code remains the blocking signal.

Useful local commands:

- backend: `cd backend && PYTHONPATH=. ./.venv/bin/pytest tests -q`
- frontend: `cd frontend && npm test`
- browser e2e: `docker run --rm -p 5000:5000 -e S3_IGNORE_SUBDOMAIN_BUCKETNAME=true ghcr.io/getmoto/motoserver:5.1.18` then `cd frontend && npm run test:e2e`

Playwright browser E2E notes:

- The suite targets `/browser` only and uses a local FastAPI runner plus a Moto S3 service.
- If local port `5000` is already used, publish Moto on another port and override `E2E_S3_ENDPOINT`, for example `docker run --rm -p 5001:5000 ...` with `E2E_S3_ENDPOINT=http://localhost:5001`.
- Outside CI, the Playwright config reuses an existing Vite or backend server if one is already listening on the expected ports. Otherwise it starts both automatically.
- GitLab stores the JUnit report at `gl-test-reports/frontend-browser-e2e-junit.xml` and keeps the HTML report plus Playwright artifacts under `frontend/playwright-report/` and `frontend/test-results/`.

## Container publishing

GitLab CI is the single source of truth for official container images.
It builds once, scans the immutable `$CI_COMMIT_SHA` image, then promotes that exact artifact to the appropriate target registry.

Registry/tag policy:

- GitLab Container Registry:
  - `dev` and `dev-<short-sha>` from branch `dev`
- GHCR:
  - `latest` from the default branch
  - `X.Y.Z` and `X.Y` from Git tags `vX.Y.Z`

Use `X.Y.Z` when you need an immutable release, `X.Y` when you want the latest patch in a minor series, and `latest` when you want the current validated build from `main`.

If a separate GitHub-side workflow still publishes images, disable it or restrict it to release metadata only. Do not rebuild official images in two CI systems.
