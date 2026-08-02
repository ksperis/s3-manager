# Operations: Observability and Troubleshooting

## Health and readiness

- `GET /health` returns backend liveness.
- Endpoint status requires periodic healthcheck jobs.
- Quota alerts require periodic quota monitor jobs; usage history requires the daily usage history job.

## Logs

Collect backend logs centrally and include:

- request path and status
- selected context/endpoint when relevant
- backend errors (including upstream storage denials)

Collect S3 provider access logs separately for object requests. These logs may
be delayed and their evidence window depends on activation, delivery, and
retention. Application `audit_logs` intentionally contains only control-plane,
security, configuration, and workflow-control events.

## Frequent failure classes

- `AccessDenied`: storage policy/permission denial.
- Missing menu/page: feature flag or capability mismatch.
- Stale metrics/billing/quota history: scheduler or token misconfiguration.
- Missing quota alert emails: SMTP configuration/user opt-in/global watch mismatch.

## From user report to operator check

| User report includes | Operator check |
|---|---|
| Workspace, page, and hidden action | Feature flag, role, account link, Manager tool access, and endpoint capability. |
| `AccessDenied` with bucket/key/context | Storage-side IAM/S3 policy for the execution identity and target scope. |
| Missing or stale metric card | Scheduler/CronJob status, `INTERNAL_CRON_TOKEN`, collection logs, and latest stored snapshot. |
| Failed upload, download, delete, copy, or individual restore | Provider S3 access logs, dedicated executor identity, backend route logs, and upstream S3/RGW error. |
| Failed purge, migration, global restore, or history cleanup | Application audit for workflow commands/state, backend logs, and upstream S3/RGW error. |
| Endpoint status warning | Healthcheck job status, endpoint URL, TLS verification, and recent incidents. |
| Missing quota email | Quota monitor job, SMTP settings, user opt-in, and notification threshold. |

## Related pages

- [Operations: healthchecks](operations-healthchecks.md)
- [Operations: billing](operations-billing.md)
- [Operations: quota monitoring and history](operations-quota-monitoring.md)
- [Production readiness](production-readiness.md)
- [User troubleshooting](../user/troubleshooting.md)
