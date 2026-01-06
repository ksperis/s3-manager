# s3-manager

**s3-manager** is an open-source web application to explore and manage
**S3-compatible object storage** such as **Ceph RGW**, **MinIO**, and other
implementations exposing S3 and IAM semantics.

The project focuses on **transparency, IAM alignment, and auditability**,
while providing a **modern web UI with enterprise‑friendly authentication**.

---

## Project Status

⚠️ **Early-stage / Proof of Concept**

s3-manager is under active development.
It is suitable for labs, experimentation, and design validation, but is **not yet
considered production-ready**.

Feedback and contributions are welcome.

---

## Key Principles

- IAM remains the **source of truth** for storage authorization
- UI authentication is **decoupled** from storage credentials
- All storage changes result in **standard S3 / IAM resources**
- No hidden or proprietary authorization model for S3
- Clear separation between:
  - configuration exploration
  - data access
  - managed workflows
- Designed primarily for **Ceph RGW (Squid and later)**

---

## Authentication vs Authorization

### UI Authentication

Authentication to the s3-manager interface is **identity-based**, not storage-based.

Supported mechanisms include:
- Enterprise OIDC (SSO)
- Email / password (local or external identity provider)

This allows users to access the interface **without ever handling S3 access keys**.

A single UI user may manage:
- multiple S3 accounts
- multiple storage backends
- multiple RGW endpoints

### Storage Authorization

Authorization for storage operations always relies on:
- S3 IAM policies
- bucket policies
- or delegated STS credentials

UI profiles **do not grant storage permissions by themselves**.

---

## Application Surfaces (Overview)

s3-manager exposes four distinct application surfaces, each with a specific goal:

| Surface  | Purpose |
|--------|---------|
| **Admin**   | UI configuration and platform governance |
| **Manager** | IAM-aligned configuration exploration |
| **Browser** | Direct S3 object access (data plane) |
| **Portal**  | Managed and simplified administration |

Each surface is described in detail below.

---

## Admin – UI Administration

The **Admin** surface focuses on UI-level configuration and platform governance.
It does not grant storage permissions.

Responsibilities:
- UI configuration and global options
- Storage endpoints management
- Association between UI users and S3 accounts
- Authentication and portal options

![Admin dashboard](docs/screenshots/admin-dashboard.png)

---

## Manager – IAM-aligned Configuration

The **Manager** surface acts as a **thin, IAM-native configuration explorer**.

Its purpose is to expose the **actual S3 and IAM configuration as-is**, without
opinionated abstraction.

Responsibilities:
- Buckets management (creation, versioning, object lock, tags)
- IAM management (users, groups, roles, policies)
- Visibility into bucket policies and access rules
- Account-level usage statistics and traffic

Authorization model:
- Direct mapping to native S3 and IAM APIs
- Authorization strictly enforced by **effective IAM permissions**
- JSON policies are visible and explicit

`Manager` is the **source of truth** for storage configuration.

![Manager buckets](docs/screenshots/manager-buckets.png)

---

## Browser – S3 Object Browser

The **Browser** surface provides a **direct, storage-centric view of S3 objects**.
It represents the **data plane** of the platform.

### Purpose
- Browse buckets and objects hierarchically
- Interact directly with objects using standard S3 operations
- Avoid backend data proxying whenever possible

### Key Features
- Bucket and prefix navigation
- Object listing with pagination
- Object metadata and tags inspection
- Versioned objects support
- Multipart upload visibility
- Upload and download using **presigned URLs**
- Drag-and-drop uploads from the browser

### Authorization Model
- All operations are authorized using **effective S3 permissions**
- No additional authorization logic is introduced
- Errors are surfaced transparently if an operation is denied

### Relationship with Other Surfaces
- **Manager** focuses on configuration and IAM
- **Browser** focuses on data-level operations
- **Portal** focuses on managed workflows

The browser does not introduce abstractions or managed behavior; it is a direct
representation of what the user is allowed to see and do on the storage backend.

![S3 browser](docs/screenshots/s3-browser.png)



---

## Portal – Managed Administration

The **Portal** surface provides a **guided and opinionated experience** for common
object storage workflows.

Its goal is to simplify day-to-day operations while enforcing best practices.

The portal feature is disabled by default; enable `portal_enabled` in the general settings to expose it.

Responsibilities:
- Managed workflows for common use cases
- Guardrails and templates
- Simplified access management
- Usage dashboards and consumption visibility

Characteristics:
- Reduced exposure to raw IAM complexity
- Actions translate into **standard S3 and IAM resources**
- Managed resources may be tagged (e.g. `managed-by: s3-manager`)

### Privilege Elevation

In some cases, portal workflows may rely on **controlled privilege elevation**
(e.g. bucket creation on behalf of a user).

Such elevation must always be:
- explicit
- auditable
- documented

![Portal](docs/screenshots/portal.png)

---

## UI Profiles (UX Roles)

s3-manager defines **UI profiles** that control access to interface features.
These profiles **do not directly grant S3 permissions**.

### ui_admin
- Manages UI-level configuration
- Manages storage endpoints
- Associates UI users with S3 accounts
- Manages authentication and portal options

### account_admin
- Manages the association between UI users and S3 accounts
- Oversees account-level visibility within the UI
- Does not automatically grant storage permissions

### portal_manager
- Access to advanced portal workflows
- May trigger managed operations requiring delegated privileges

### portal_user
- Simplified portal access
- Usage visibility and day-to-day object operations

> UI profiles define **what the user can do in the interface**, not what the user
> is allowed to do directly on the storage backend.

---

## Authorization Model

- Storage authorization is **capability-based**
- Frontend components check permissions such as:
  - `buckets:create`
  - `objects:write`
  - `lifecycle:update`
- UI profiles must never be used as a proxy for storage authorization
- If IAM denies an operation, the UI must not silently bypass it

Exceptions requiring privilege elevation (portal workflows) must be:
- explicit
- auditable
- documented

---

## Architecture Overview

### Backend
- FastAPI-based API
- Clear separation between:
  - IAM-native operations (`Manager`)
  - managed workflows (`Portal`)
- Delegated STS credentials preferred for portal workflows
- Minimal internal state (only for managed workflows)

### Frontend
- React-based UI
- Capability-driven rendering
- Clear separation between Admin / Manager / Browser / Portal

---

## Tests

```bash
cd backend
pytest
```

Note: `backend/tests_ceph_functional` requires a configured Ceph RGW environment.

---

## Deployment

- Dockerfiles provided for backend and frontend
- Frontend served via Nginx (`frontend/nginx.conf`)
- Suitable for lab and development environments

### Container images (GHCR)

Public images are published to:
- `ghcr.io/ksperis/s3-manager-backend`
- `ghcr.io/ksperis/s3-manager-frontend`

Set the package visibility to **Public** in GHCR after the first push.

### Versioning strategy

Use git tags in `vMAJOR.MINOR.PATCH` format:
- Tag `v1.2.3` publishes `1.2.3`, `1.2`, and `latest`
- `main` publishes `edge` and the commit `sha` tag

The workflow is defined in `.github/workflows/publish-ghcr.yml`.

### Docker Compose (quick start)

To run with prebuilt images:

```bash
mkdir s3-manager; cd s3-manager
wget https://raw.githubusercontent.com/ksperis/s3-manager/refs/heads/main/docker-compose.yml
S3_MANAGER_TAG=latest docker compose up
```

To build images from source:

```bash
docker compose -f docker-compose.build.yml up --build
```

Default endpoints:
- Frontend: http://localhost:8080
- API: http://localhost:8000/api

### Helm (Kubernetes)

```bash
helm install s3-manager helm/s3-manager \\
  --set image.backend.repository=ghcr.io/ksperis/s3-manager-backend \\
  --set image.frontend.repository=ghcr.io/ksperis/s3-manager-frontend \\
  --set image.backend.tag=latest \\
  --set image.frontend.tag=latest
```

The chart deploys an internal PostgreSQL instance by default.
To disable it and provide your own database, set:

```bash
helm upgrade --install s3-manager helm/s3-manager \\
  --set postgresql.enabled=false \\
  --set backend.env.DATABASE_URL=postgresql://user:pass@host:5432/db
```

For ingress-based deployments, build the frontend with `VITE_API_URL=/api`.

---

## Compatibility

- **Ceph RGW** (Squid and later)
- S3-compatible object storage
- Partial AWS S3 support (feature-dependent)

---

## Contributing

Contributions are welcome.

Please ensure:
- IAM alignment is preserved
- UI profiles are not misused as storage authorization
- `Manager` remains IAM-native
- `Browser` remains a direct S3 view
- `Portal` workflows remain explicit and auditable

---

## License

Apache-2.0 — see the `LICENSE` file.
