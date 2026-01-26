
# Observability & troubleshooting

## Health

The backend exposes a health endpoint:

- `GET /health` → `{ "status": "ok" }` (see `backend/app/main.py`)

## Logs

For reliable troubleshooting:

- enable structured logs (JSON) for the backend in production
- propagate request IDs from frontend to backend
- log executor identity and target resources for high-risk operations

## Common issues

- **AccessDenied**: indicates IAM/S3 policy denial on the backend; s3-manager should not mask this.
- **Backend feature mismatch**: some backends partially implement S3/IAM; expect capability-based UX.

Add your environment-specific runbooks here once you deploy in real clusters.
