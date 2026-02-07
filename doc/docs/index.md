
# s3-manager

**s3-manager** is an open-source web application to explore and manage **S3-compatible object storage**
with a strong focus on **IAM alignment** and **auditability**.

It targets two complementary usage modes:

- **Console mode** for storage administrators and platform teams (Admin / Manager)
- **Credential-first mode** for users who only have **S3 access keys** and want a simple S3 console (Browser)

> Project status: **Early-stage / Proof of Concept**  
> Suitable for labs, experimentation, and design validation. Not yet production-ready.

## Documentation map

- **Getting started**: run locally with Docker Compose, run in dev mode, configure the application
- **Concepts**: non-negotiable principles, surfaces, S3 Accounts vs S3 Connections, identity model
- **Architecture**: backend, frontend, database, migrations
- **Features**: grouped by surface (Admin / Ceph Admin / Manager / Browser / Portal)
- **Backends**: Ceph RGW specifics and compatibility notes

## Guiding principles

- IAM is the **source of truth** for authorization
- UI authentication is **decoupled** from storage credentials
- Storage changes create or modify **standard S3 / IAM resources**
- No “shadow permission model” outside IAM

See **Concepts → Core principles** for details.
