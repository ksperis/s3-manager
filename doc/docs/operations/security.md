
# Security hardening

This page summarizes common hardening steps for s3-manager deployments.

## Authentication

- Prefer enterprise OIDC where available
- Enforce MFA via your IdP policy when possible
- Keep local password auth for labs only (or protect it with strong controls)

## Secrets

- Store S3 credentials and OIDC secrets in a secret manager (Kubernetes secrets, Vault, etc.)
- Avoid committing `.env` files
- Rotate credentials regularly and support revocation flows

## Network

- Terminate TLS at the edge (Ingress / reverse proxy)
- Restrict Admin surface access by network policy or dedicated ingress
- Consider separate hostnames per surface (admin.example, console.example, etc.)

## Audit

- Ensure audit logs are centrally collected and retained
- Protect audit integrity (immutable storage) if compliance requires it
