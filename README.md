# BucketReef - S3-compatible object storage management

[![Docs](https://img.shields.io/badge/docs-github%20pages-0A66C2)](https://ksperis.github.io/bucketreef/)
[![Tag](https://img.shields.io/github/v/tag/ksperis/bucketreef?sort=semver)](https://github.com/ksperis/bucketreef/tags)
[![License](https://img.shields.io/github/license/ksperis/bucketreef)](./LICENSE)
![Status](https://img.shields.io/badge/status-beta-F28C28)

**BucketReef** is an open-source web application to manage S3-compatible object storage primarily focused on **Ceph RGW**.

> Project status: **Beta**. Suitable for evaluation and controlled deployments.

It gives storage administrators and delegated team managers a single interface to manage their storage environments.
It can also be used solely through the integrated S3 browser for direct object access.


## Workspaces summary

- **Admin**: platform governance, endpoints, users, and settings.
- **Manager**: bucket and IAM administration in account context.
- **Browser**: direct object operations.
- **Portal**: explicit self-service workspace backed by RGW IAM.
- **Ceph-admin**: Ceph RGW cluster-wide administration.

## Workspace features

### Admin

<a href="https://ksperis.github.io/bucketreef/user/screenshots-gallery/#admin">
  <img src="doc/docs/assets/screenshots/user/user-overview.light.png" alt="Admin dashboard" width="560">
</a>

- Manage UI users, roles, and workspace entitlements.
- Administer RGW accounts, S3 users, and S3 connections.
- Register storage endpoints and review endpoint status.
- Access audit trails and platform-wide settings.

### Manager

<a href="https://ksperis.github.io/bucketreef/user/screenshots-gallery/#manager">
  <img src="doc/docs/assets/screenshots/user/workspace-manager.light.png" alt="Manager buckets" width="560">
</a>

- Create and configure buckets with versioning, lifecycle, quotas, CORS, and access controls.
- Manage IAM users, groups, roles, policies, and access keys.
- Operate SNS topics when the selected endpoint supports notifications.
- Use migration and comparison tools for bucket alignment and controlled transfers.

### Browser

<a href="https://ksperis.github.io/bucketreef/user/screenshots-gallery/#browser">
  <img src="doc/docs/assets/screenshots/user/workspace-browser.light.png" alt="S3 browser" width="560">
</a>

- Browse buckets, prefixes, and objects from the selected context.
- Upload, download, preview, delete, and restore objects and versions.
- Run bulk operations on large object selections.
- Inspect and update object metadata and tags directly from the UI.

### Ceph-admin

<a href="https://ksperis.github.io/bucketreef/user/screenshots-gallery/#ceph-admin">
  <img src="doc/docs/assets/screenshots/user/workspace-ceph-admin.light.png" alt="Ceph Admin" width="560">
</a>

- Manage Ceph RGW accounts and users at cluster scope.
- Inspect bucket inventory and apply bucket-level configuration centrally.
- Monitor endpoint metrics for operational visibility.
- Run long-running bulk actions with explicit progress and failure counters.

### Portal

<a href="https://ksperis.github.io/bucketreef/user/screenshots-gallery/#portal">
  <img src="doc/docs/assets/screenshots/user/workspace-portal.light.png" alt="Portal" width="560">
</a>

- Self-service dashboard for eligible Ceph RGW accounts with IAM enabled.
- Access is explicit per account with `portal_user` or `portal_manager`.
- `/manager` access remains separate and still requires account admin/root links.

## Quick Start (Docker Compose)

For a local evaluation from a clean machine:

```bash
git clone https://github.com/ksperis/bucketreef.git
cd bucketreef
./quickstart
```

The script generates strong local secrets in `.env.quickstart`, builds the
backend and frontend from the current checkout, waits for both services, then
prints a 15-minute one-time URL. The first build can take several minutes.
Open the URL to create the first administrator and enroll a passkey. Re-running
the script is safe and prints either a fresh setup URL or the sign-in URL.

This quickstart is intentionally limited to loopback, SQLite and local
evaluation. It includes no MinIO, no simulated or preconfigured storage, and no
scheduler. Connect an existing S3-compatible or Ceph RGW endpoint later from
Admin if you want to exercise storage workflows. A complete deployment enables
the `operations` Compose profile and uses a reverse proxy with TLS.

Useful commands:

```bash
./quickstart status
./quickstart stop
./quickstart reset
```

See the [Quickstart guide](https://ksperis.github.io/bucketreef/ops/quickstart/)
for reset backups, restore steps, expired links and deployment boundaries.

## Full Documentation

See the published documentation on GitHub Pages:

- https://ksperis.github.io/bucketreef/

## License

Apache-2.0 — see `LICENSE`.
