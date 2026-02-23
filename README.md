# s3-manager

**s3-manager** is an open-source web application to manage **S3-compatible object storage** (Ceph RGW, AWS S3, MinIO, Scality, ...).

It provides dedicated interfaces depending on user needs:
- **Admin**: platform and UI configuration
- **Manager**: IAM and bucket configuration
- **Browser**: object-level operations
- **Portal**: guided workflows for day-to-day operations
- **Ceph-admin**: Ceph cluster-wide buckets and users administration

---

## Project Status

⚠️ **Early-stage / Proof of Concept**

s3-manager is under active development and is currently better suited for labs and validation environments.

---

## Application Surfaces

| Surface | Purpose |
|--------|---------|
| **Admin** | UI configuration and platform governance |
| **Manager** | IAM-native configuration for buckets, users, groups, roles and policies |
| **Browser** | Direct S3 object access |
| **Portal** | Simplified and guided administration workflows |
| **Ceph-admin** | Cluster-wide Ceph buckets and users administration |

### Admin

Configure the platform and map UI users to storage identities.

Typical actions:
- Manage storage endpoints
- Configure authentication options
- Associate users with S3 accounts, users, or connections

![Admin dashboard](doc/docs/assets/screenshots/admin-dashboard.png)

### Manager

Manage S3/IAM configuration with native semantics.

Typical actions:
- Create and configure buckets (versioning, tags, object lock)
- Manage IAM users, groups, roles, and policies
- Inspect bucket policies and access rules

![Manager buckets](doc/docs/assets/screenshots/manager-buckets.png)

### Browser

Work directly on S3 objects using effective storage permissions.

Typical actions:
- Browse buckets and prefixes
- Upload/download objects (including presigned URL flows)
- View metadata, tags, versions, and multipart uploads

![S3 browser](doc/docs/assets/screenshots/s3-browser.png)

### Ceph-admin

Dedicated interface for Ceph storage administrators.

Typical actions:
- Manage buckets cluster-wide
- Manage users cluster-wide

![Ceph Admin](doc/docs/assets/screenshots/ceph-admin-buckets.png)

### Portal

Guided workflows for common operations with guardrails.

Notes:
- Disabled by default (`portal_enabled` setting)
- Available for RGW accounts with IAM support

![Portal](doc/docs/assets/screenshots/portal.png)

---

## Key Principles

- IAM and bucket policies remain the source of truth for storage authorization
- UI authentication is decoupled from storage credentials
- Operations create standard S3/IAM resources (no proprietary storage model)

---

## Quick Start (Docker Compose)

Use prebuilt images:

```bash
mkdir s3-manager && cd s3-manager
wget https://raw.githubusercontent.com/ksperis/s3-manager/refs/heads/main/docker-compose.yml
S3_MANAGER_TAG=latest docker compose up
```

Build from source:

```bash
docker compose -f docker-compose.build.yml up --build
```

Default endpoints:
- Frontend: http://localhost:8080
- API: http://localhost:8000/api

---

## Container Images

Published on GHCR:
- `ghcr.io/ksperis/s3-manager-backend`
- `ghcr.io/ksperis/s3-manager-frontend`

---

## Helm (Kubernetes)

```bash
helm install s3-manager helm/s3-manager \
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \
  --set image.backend.tag=latest \
  --set image.frontend.tag=latest
```

---

## Compatibility

- **Ceph RGW** (Tentacle and later)
- S3-compatible object storage
- Partial AWS S3 support (feature-dependent)

---

## Contributing

Contributions are welcome.

---

## License

Apache-2.0 — see `LICENSE`.
