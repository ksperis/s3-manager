
# API reference (OpenAPI)

The backend exposes an OpenAPI schema automatically via FastAPI.

Typical endpoints:

- Swagger UI: `http://localhost:8000/docs`
- OpenAPI JSON: `http://localhost:8000/openapi.json`

## Documentation strategy

For a stable API reference:

- keep router tags consistent
- add examples to request/response models
- document error semantics (especially S3/IAM errors) without masking backend reality
