# Operations: Security

## Authentication and access

- Prefer enterprise OIDC.
- Restrict admin surface access by network/ingress policy.
- Use least privilege for UI users and storage credentials.

## Secret management

- Set strong non-default secrets for JWT and credential encryption keys.
- Store all secrets in secure secret management systems.
- Rotate credentials and API tokens periodically.

## Transport and network

- Enforce TLS at ingress/reverse proxy.
- Keep internal endpoints protected with `INTERNAL_CRON_TOKEN` and private network exposure.

## Audit and traceability

- Retain audit trail centrally.
- Correlate UI actions with backend logs and executor identity.

## CI security gates

GitLab CI blocks merges and image promotion when security scans detect `HIGH` or `CRITICAL` findings.

Current CI baseline:

- `secret_detection`: GitLab secret detection on merge requests and the default branch.
- `backend-vuln-scan`: Trivy filesystem scan of Python dependencies from `backend/requirements.txt`.
- `frontend-vuln-scan`: Trivy filesystem scan of Node dependencies from `frontend/package-lock.json`.
- `backend-image-vuln-scan`: Trivy image scan of the backend image tagged with `$CI_COMMIT_SHA`.
- `frontend-image-vuln-scan`: Trivy image scan of the frontend image tagged with `$CI_COMMIT_SHA`.

Promotion rules:

- `build-*` jobs publish immutable images tagged with `$CI_COMMIT_SHA`.
- `promote-*` jobs copy the validated `$CI_COMMIT_SHA` image to public tags only after the security stage succeeds.
- GitLab CI is the single image publisher; GitHub must not rebuild official images.
- Public tag policy:
  - branch `dev`: `dev` and `dev-$CI_COMMIT_SHORT_SHA`
  - default branch: `latest`
  - Git tags: exact `$CI_COMMIT_TAG`, plus a plain semver alias without the leading `v` when the tag matches `v*`
- Promotion copies images to both the GitLab Container Registry and GHCR without rebuilding them.

Required CI variables for GHCR publication:

- `GHCR_USERNAME`
- `GHCR_TOKEN`

Store them in GitLab CI/CD variables as protected and masked values.
The token should have `write:packages`, and `read:packages` if your GHCR access policy requires it.

## Local replay

Install Trivy locally, then run:

```bash
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore backend
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore frontend
trivy image --scanners vuln --vuln-type os,library --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore <image-ref>
```

Examples:

- backend image: `trivy image ... "$CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHA"`
- frontend image: `trivy image ... "$CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHA"`

Promotion validation should confirm that the promoted GHCR digest matches the validated GitLab registry digest for the same commit SHA.

Secret detection is managed by the GitLab analyzer template in CI. To validate it safely, use a dedicated branch or a scheduled/manual pipeline with `SECRET_DETECTION_HISTORIC_SCAN=true`.

## False positives and temporary exceptions

- Prefer upgrading the vulnerable dependency or rebuilding from a remediated base image.
- If a Trivy finding is a temporary exception, add the vulnerability ID to [`.trivyignore`](../../../.trivyignore) and document the reason, owner, and expiry in the merge request.
- Keep exceptions short-lived and remove them once the remediation is available.
- Treat secret-detection findings as real leaks by default; only suppress recurring false positives after verifying the value is non-sensitive and the exclusion is narrowly scoped in GitLab.

## Related pages

- [Operations: observability](operations-observability.md)
- [Developer: principles](../developer/principles.md)
