# s3-manager

**s3-manager** is an open-source web application to manage **S3-compatible object storage**, primarily focused on **Ceph RGW**, with **partial compatibility** for non-Ceph S3 implementations.

> Project status: **Early-stage / Proof of Concept**. Suitable for labs and validation environments.

## Workspaces

- **Admin**: platform governance, endpoints, users, and settings.
- **Manager**: bucket and IAM administration in account context.
- **Browser**: direct object operations.
- **Portal**: guided self-service workflows (**temporarily removed**).
- **Ceph-admin**: Ceph RGW cluster-wide administration.

## Screenshots

### Admin

![Admin dashboard](doc/docs/assets/screenshots/user/user-overview.png)

### Manager

![Manager buckets](doc/docs/assets/screenshots/user/workspace-manager.png)

### Browser

![S3 browser](doc/docs/assets/screenshots/user/workspace-browser.png)

### Ceph-admin

![Ceph Admin](doc/docs/assets/screenshots/user/workspace-ceph-admin.png)

### Portal

> Note: the Portal feature is temporarily removed; this screenshot is kept as historical documentation.

![Portal](doc/docs/assets/screenshots/user/workspace-portal.png)

## Quick Start (Docker Compose)

Use prebuilt images:

```bash
mkdir s3-manager && cd s3-manager
wget https://raw.githubusercontent.com/ksperis/s3-manager/refs/heads/main/docker-compose.yml
S3_MANAGER_TAG=latest docker compose up
```

Default endpoints:

- Frontend: `http://localhost:8080`


## Full Documentation

See `doc/` (MkDocs) for:

- user workflows
- ops/sysadmin deployment and runbooks
- developer architecture and principles
- AI assistant and contribution guardrails in the developer guide

## License

Apache-2.0 — see `LICENSE`.
