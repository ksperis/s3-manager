# BucketReef - S3-compatible object storage management

**BucketReef** is an open-source web application for managing **S3-compatible object storage** with IAM-aligned workflows.

> Project status: **Beta**. Suitable for evaluation and controlled deployments.

## Start from what you need to do

| I need to... | Start with | Why |
|---|---|---|
| Use storage, upload files, download files, or recover versions | [User Guide / Start Here](user/start-here.md) | It explains the workspace selector, account context, and the difference between Portal and Browser. |
| Work in a simple self-service storage area | [Portal overview](user/workspace-portal.md) | Portal is the end-user workspace for Storage Spaces, simple sharing, access keys, usage, and preferences. |
| Manage buckets, IAM, topics, and account-level tools | [Manager overview](user/workspace-manager.md) | Manager keeps S3 and IAM operations account-scoped and explicit. |
| Operate the platform, users, endpoints, settings, audit, or billing | [Storage admin runbook](user/admin-runbook-storage-admin.md) | It connects Admin, Manager, Browser, Portal, and Ops checks into one handover path. |
| Administer Ceph RGW cluster resources | [Ceph Admin overview](user/workspace-ceph-admin.md) | Ceph Admin is separate from Manager because it acts at cluster scope. |
| Deploy, secure, or troubleshoot the application | [Ops / Sysadmin onboarding](ops/sysadmin-onboarding.md) | It routes operators to deployment, configuration, security, scheduler, backup, and troubleshooting pages. |
| Make a first contribution | [Developer / First Contribution](developer/first-contribution.md) | It points to architecture, local setup, validation, and documentation rules. |

## Documentation by audience

- **User Guide**: concrete workflows for storage administrators and storage users.
- **Ops / Sysadmin Guide**: installation, deployment, security, and day-2 operations.
- **Developer Guide**: high-level architecture and core principles.

## Product surfaces

- **Admin** (`/admin`): platform governance, endpoints, users, settings.
- **Manager** (`/manager`): account-scoped bucket and IAM operations.
- **Portal** (`/portal`): explicit self-service workspace backed by RGW IAM.
- **Browser** (`/browser`): object-level operations.
- **Ceph Admin** (`/ceph-admin`): Ceph RGW cluster-level administration (optional).

## Quick links

- Start quickly as a user: [User Guide / Start Here](user/start-here.md)
- Choose a daily workflow: [Common tasks for storage users](user/common-tasks-storage-user.md)
- Choose an admin workflow: [Common tasks for storage administrators](user/common-tasks-storage-admin.md)
- Prepare a team handover: [Storage admin runbook](user/admin-runbook-storage-admin.md)
- Understand terms and search better: [Glossary and Search Tips](user/glossary.md)
- Start as an operator: [Ops / Sysadmin onboarding](ops/sysadmin-onboarding.md)
- Deploy quickly with containers: [Ops / Deploy with Docker Compose](ops/deploy-docker-compose.md)
- Prepare production-like rollout: [Ops / Production readiness](ops/production-readiness.md)
- Understand architecture: [Developer / Architecture Overview](developer/architecture-overview.md)
