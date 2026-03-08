# Operations: Observability and Troubleshooting

## Health and readiness

- `GET /health` returns backend liveness.
- Endpoint status requires periodic healthcheck jobs.

## Logs

Collect backend logs centrally and include:

- request path and status
- selected context/endpoint when relevant
- backend errors (including upstream storage denials)

## Frequent failure classes

- `AccessDenied`: storage policy/permission denial.
- Missing menu/page: feature flag or capability mismatch.
- Stale metrics/billing: scheduler or token misconfiguration.

## Related pages

- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [User troubleshooting](../user/troubleshooting.md)
