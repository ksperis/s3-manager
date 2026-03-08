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

## Related pages

- [Operations: observability](operations-observability.md)
- [Developer: principles](../developer/principles.md)
