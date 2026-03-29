# s3-manager

[![Docs](https://img.shields.io/badge/docs-github%20pages-0A66C2)](https://ksperis.github.io/s3-manager/)
[![Tag](https://img.shields.io/github/v/tag/ksperis/s3-manager?sort=semver)](https://github.com/ksperis/s3-manager/tags)
[![License](https://img.shields.io/github/license/ksperis/s3-manager)](./LICENSE)
![Status](https://img.shields.io/badge/status-early--stage%20%2F%20PoC-F28C28)

**s3-manager** is an open-source web application to manage S3-compatible object storage primarily focused on **Ceph RGW**.

> Project status: **Early-stage / Proof of Concept**. Suitable for labs and validation environments.

It gives storage administrators and delegated team managers a single interface to manage their storage environments.
It can also be used solely through the integrated S3 browser for direct object access.


## Workspaces summary

- **Admin**: platform governance, endpoints, users, and settings.
- **Manager**: bucket and IAM administration in account context.
- **Browser**: direct object operations.
- **Portal**: guided self-service workflows (**temporarily removed**).
- **Ceph-admin**: Ceph RGW cluster-wide administration.

## Workspace features

### Admin

<a href="https://ksperis.github.io/s3-manager/user/screenshots-gallery/#admin">
  <img src="doc/docs/assets/screenshots/user/user-overview.png" alt="Admin dashboard" width="560">
</a>

- Manage UI users, roles, and workspace entitlements.
- Administer RGW accounts, S3 users, and S3 connections.
- Register storage endpoints and review endpoint status.
- Access audit trails and platform-wide settings.

### Manager

<a href="https://ksperis.github.io/s3-manager/user/screenshots-gallery/#manager">
  <img src="doc/docs/assets/screenshots/user/workspace-manager.png" alt="Manager buckets" width="560">
</a>

- Create and configure buckets with versioning, lifecycle, quotas, CORS, and access controls.
- Manage IAM users, groups, roles, policies, and access keys.
- Operate SNS topics when the selected endpoint supports notifications.
- Use migration and comparison tools for bucket alignment and controlled transfers.

### Browser

<a href="https://ksperis.github.io/s3-manager/user/screenshots-gallery/#browser">
  <img src="doc/docs/assets/screenshots/user/workspace-browser.png" alt="S3 browser" width="560">
</a>

- Browse buckets, prefixes, and objects from the selected context.
- Upload, download, preview, delete, and restore objects and versions.
- Run bulk operations on large object selections.
- Inspect and update object metadata and tags directly from the UI.

### Ceph-admin

<a href="https://ksperis.github.io/s3-manager/user/screenshots-gallery/#ceph-admin">
  <img src="doc/docs/assets/screenshots/user/workspace-ceph-admin.png" alt="Ceph Admin" width="560">
</a>

- Manage Ceph RGW accounts and users at cluster scope.
- Inspect bucket inventory and apply bucket-level configuration centrally.
- Monitor endpoint metrics for operational visibility.
- Run long-running bulk actions with explicit progress and failure counters.

### Portal

> Note: the Portal feature is temporarily removed; this screenshot is kept as historical documentation.

<a href="https://ksperis.github.io/s3-manager/user/screenshots-gallery/#portal">
  <img src="doc/docs/assets/screenshots/user/workspace-portal.png" alt="Portal" width="560">
</a>

- Historical workspace for guided self-service workflows.
- Temporarily removed from the active product surface.

## Quick Start (Docker Compose)

Use prebuilt images:

```bash
mkdir s3-manager && cd s3-manager
wget https://raw.githubusercontent.com/ksperis/s3-manager/refs/heads/main/docker-compose.yml
S3_MANAGER_TAG=latest docker compose up -d frontend backend
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
