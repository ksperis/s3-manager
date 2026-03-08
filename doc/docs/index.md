# s3-manager Documentation

**s3-manager** is an open-source web application for managing **S3-compatible object storage** with IAM-aligned workflows.

> Project status: **Early-stage / Proof of Concept**. Suitable for labs and validation environments.

## Documentation by audience

- **User Guide**: concrete workflows for storage administrators and storage users.
- **Ops / Sysadmin Guide**: installation, deployment, security, and day-2 operations.
- **Developer Guide**: high-level architecture and core principles.

## Product surfaces

- **Admin** (`/admin`): platform governance, endpoints, users, settings.
- **Manager** (`/manager`): account-scoped bucket and IAM operations.
- **Browser** (`/browser`): object-level operations.
- **Portal** (`/portal`): guided self-service workflows (optional).
- **Ceph Admin** (`/ceph-admin`): Ceph RGW cluster-level administration (optional).

## Quick links

- Start quickly as a user: [User Guide / Start Here](user/start-here.md)
- Deploy quickly with containers: [Ops / Deploy with Docker Compose](ops/deploy-docker-compose.md)
- Understand architecture: [Developer / Architecture Overview](developer/architecture-overview.md)
