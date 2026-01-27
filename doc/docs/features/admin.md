
# Admin surface

The Admin surface is intended for platform administrators.

## Typical capabilities

- Register and manage **storage endpoints**
- Create/import **S3 Accounts**
- Manage administrative users and roles
- Associate UI users with **S3 Accounts**, **legacy S3 users**, and **S3 Connections**
- Review audit and high-level statistics
- Configure global settings / feature toggles

## Implementation pointers

Backend routers:

- `backend/app/routers/admin_*`

Frontend routes:

- `/admin/*`
