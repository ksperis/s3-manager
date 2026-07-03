# Backup and Restore

Use this page to define the minimum backup contract for s3-manager deployments.

## What must be protected

| Data | Why it matters |
|---|---|
| Application database | UI users, account links, app settings, Portal metadata, grants, audit, usage, billing, and operational history. |
| Credential encryption key | Required to decrypt stored credentials after restore. |
| Runtime secrets | JWT/refresh secrets, scheduler token, SMTP, OIDC/LDAP, and deployment-specific credentials. |
| Deployment values | Helm values, Compose `.env`, ingress, and scheduler configuration. |

## Backup checklist

1. Back up the database on a schedule that matches your recovery point objective.
2. Store the credential encryption key and database backup in coordinated recovery storage.
3. Back up Helm values or Compose environment files without placing secrets in Git.
4. Keep at least one recent backup outside the cluster or host that runs s3-manager.
5. Test restore before user onboarding and before major upgrades.

## Restore checklist

1. Stop schedulers or CronJobs to avoid writes during restore.
2. Restore the database.
3. Restore the same credential encryption key.
4. Restore runtime secrets and deployment values.
5. Start backend and frontend.
6. Run endpoint healthchecks.
7. Validate login, Admin, Manager context selection, Portal Storage Spaces, Browser access, and scheduled jobs.

## SQLite note

SQLite is suitable for local and validation environments. For production-like environments, make database persistence, locking behavior, and backup automation explicit before onboarding users.

## PostgreSQL note

When using PostgreSQL, use your platform backup tooling and keep migration execution tied to deployment. Restore tests should include both database data and encrypted credential readability.

## Related pages

- [Production readiness](production-readiness.md)
- [Configuration](configuration.md)
- [Deploy with Docker Compose](deploy-docker-compose.md)
- [Deploy with Helm](deploy-helm.md)
- [Operations: security](operations-security.md)
