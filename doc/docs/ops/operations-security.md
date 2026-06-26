# Operations: Security

## Authentication and access

- Prefer enterprise OIDC.
- For LDAP, require LDAPS or StartTLS with certificate verification, keep the bind account least-privilege, and leave `ALLOW_EMAIL_LINKING=false` unless you are intentionally migrating existing local users.
- Restrict admin surface access by network/ingress policy.
- Use least privilege for UI users and storage credentials.

## Secret management

- Set strong non-default secrets for JWT and credential encryption keys.
- Store all secrets in secure secret management systems.
- Treat LDAP bind passwords like other runtime secrets; inject them from your deployment secret manager and never place them in public compose/Helm values.
- Rotate credentials and API tokens periodically.

## Transport and network

- Enforce TLS at ingress/reverse proxy.
- Configure `CORS_ORIGINS` with explicit trusted UI origins. Avoid `*` for authenticated deployments, and enable `REFRESH_TOKEN_COOKIE_SECURE=true` for non-local origins.
- Keep internal endpoints protected with `INTERNAL_CRON_TOKEN` and private network exposure.
- End-user custom S3 endpoints are restricted to public `https://` targets. Only admin-managed endpoint flows may keep `http://` endpoints when an internal deployment explicitly requires them.

## Audit and traceability

- Retain audit trail centrally.
- Correlate UI actions with backend logs and executor identity.
- LDAP login success, failure, rate-limit, and provider configuration failures are audited without recording submitted passwords.
- Backend HTTP 5xx details are sanitized before being returned or logged by the HTTP exception handler. Do not bypass the shared error helpers when exposing upstream S3/RGW/IAM failures.

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
- `promote-*` jobs copy the validated `$CI_COMMIT_SHA` image only after the security stage succeeds.
- GitLab CI is the single image publisher; GitHub must not rebuild official images.
- Public tag policy:
  - branch `dev`: GitLab Container Registry only, tags `dev` and `dev-$CI_COMMIT_SHORT_SHA`
  - default branch: GitLab Container Registry SHA images only, no public GHCR tag
  - Git tags matching `vX.Y.Z`: GHCR only, image tag `X.Y.Z`
  - highest patch in a minor series: GHCR alias `X.Y`
  - highest stable release tag: GHCR alias `latest`
- Promotion never rebuilds images; it copies the validated digest to the target registry.

Required CI variables for GHCR publication:

- `GHCR_USERNAME`
- `GHCR_TOKEN`

Store them in GitLab CI/CD variables as protected and masked values.
The token should have `write:packages`, and `read:packages` if your GHCR access policy requires it.
The `dev` branch no longer depends on these variables.

## Local replay

Install Trivy locally, then run:

```bash
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore backend
trivy fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore frontend
trivy image --scanners vuln --pkg-types os,library --severity HIGH,CRITICAL --ignore-unfixed --ignorefile .trivyignore <image-ref>
```

Examples:

- backend image: `trivy image ... "$CI_REGISTRY_IMAGE/backend:$CI_COMMIT_SHA"`
- frontend image: `trivy image ... "$CI_REGISTRY_IMAGE/frontend:$CI_COMMIT_SHA"`

Promotion validation should confirm that the promoted digest matches the validated GitLab registry digest for the same commit SHA.

Secret detection is managed by the GitLab analyzer template in CI. To validate it safely, use a dedicated branch or a scheduled/manual pipeline with `SECRET_DETECTION_HISTORIC_SCAN=true`.

## False positives and temporary exceptions

- Prefer upgrading the vulnerable dependency or rebuilding from a remediated base image.
- If a Trivy finding is a temporary exception, add the vulnerability ID to `.trivyignore` at the repository root and document the reason, owner, and expiry in the merge request.
- Keep exceptions short-lived and remove them once the remediation is available.
- Treat secret-detection findings as real leaks by default; only suppress recurring false positives after verifying the value is non-sensitive and the exclusion is narrowly scoped in GitLab.

## Related pages

- [Operations: observability](operations-observability.md)
- [Developer: principles](../developer/principles.md)
