# Operations: Security

## Production hardening checklist

- Use OIDC or LDAP over verified TLS for real users.
- Set distinct strong UI/API JWT rings, credential-encryption keys, and scheduler secrets.
- Set `APP_ENV=production`; startup then rejects HTTP origins, insecure cookies, wildcard hosts, weak keys, insecure providers, broad proxy trust, and unregistered S3 login endpoints.
- Keep `PUBLIC_ORIGIN`, `CORS_ORIGINS`, `ALLOWED_HOSTS`, `WEBAUTHN_ORIGIN`, and `WEBAUTHN_RP_ID` exact.
- Expose internal scheduler/API automation paths only on trusted networks.
- Store LDAP bind passwords, SMTP password, storage credentials, and registry tokens in a secret manager.
- Enable only the workspaces and feature flags that are ready for users.
- Configure central backend logs, retain application control-plane audit, and
  enable provider S3 access logging for object-level evidence.
- Run the documented CI or local security scans before publishing images.

## Authentication and access

- Prefer enterprise OIDC.
- For LDAP, require LDAPS or StartTLS with certificate verification and keep the bind account least-privilege. Email linking is never automatic.
- Require WebAuthn for every admin and use the manual superadmin approval queue for OIDC/LDAP email collisions.
- Restrict admin surface access by network/ingress policy.
- Use least privilege for UI users and storage credentials.

## Secret management

- Set strong non-default secrets for JWT and credential encryption keys.
- Store all secrets in secure secret management systems.
- Treat LDAP bind passwords like other runtime secrets; inject them from your deployment secret manager and never place them in public compose/Helm values.
- Rotate credentials and API tokens periodically.
- Follow [Authentication security and cutover](authentication-hardening.md) for JWT-ring, credential-ring, session, recovery-code, and destructive-migration procedures.

## Transport and network

- Enforce TLS at ingress/reverse proxy.
- Configure `CORS_ORIGINS` with explicit trusted UI origins. Avoid `*` for authenticated deployments, and enable `REFRESH_TOKEN_COOKIE_SECURE=true` for non-local origins.
- Trust `X-Forwarded-For` only from direct peers listed in `TRUSTED_PROXY_CIDRS`; Uvicorn runs with implicit proxy trust disabled.
- Keep internal endpoints protected with `INTERNAL_CRON_TOKEN` and private network exposure.
- End-user custom S3 endpoints are restricted to public `https://` targets. Only admin-managed endpoint flows may keep `http://` endpoints when an internal deployment explicitly requires them.

## Audit and traceability

- Retain application control-plane and security audit centrally.
- Enable and retain Server Access Logging or equivalent provider logs for S3
  data-plane operations. Delivery can be delayed; disabled logging means there
  is no exhaustive object audit.
- Correlate UI control changes with backend logs and object requests with their
  dedicated executor identity.
- Give every person a dedicated IAM identity or owned private connection.
  Multiple keys are allowed only for rotation and must never be shared.
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

- [Configuration](configuration.md)
- [Production readiness](production-readiness.md)
- [Backup and restore](backup-restore.md)
- [Operations: observability](operations-observability.md)
- [Developer: principles](../developer/principles.md)
