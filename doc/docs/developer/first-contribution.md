# First Contribution

Use this page when you are preparing your first code or documentation change.

## Development setup

1. Read [Architecture overview](architecture-overview.md), [Principles](principles.md), and [Identity and execution model](identity-and-execution-model.md).
2. Start backend and frontend using [Local development](local-development.md).
3. Keep `/admin`, `/manager`, `/portal`, `/browser`, `/ceph-admin`, and `/storage-ops` vocabulary separate.
4. For UI changes, read [Product design guidelines](product-design-guidelines.md), [Workspace surface separation](workspace-surface-separation.md), and [UI theme guidelines](ui-theme-guidelines.md).

## Change checklist

| Change type | Read first | Minimum validation |
|---|---|---|
| Backend route/service | Backend architecture, identity model, API reference | Targeted pytest and explicit error-case check. |
| Frontend workspace page | Product design guidelines, workspace separation | Typecheck, focused Vitest, and browser smoke when route rendering matters. |
| Portal behavior | Workspace separation, Portal user docs | Portal tests plus storage-space permission reasoning. |
| Ops behavior | Ops configuration and security pages | MkDocs strict build and deployment command review. |
| Documentation | Docs maintenance | MkDocs strict build and screenshot check for user pages. |

## Local validation commands

- Backend: `cd backend && PYTHONPATH=. ./.venv/bin/pytest tests -q`
- Frontend: `cd frontend && npm test`
- Browser E2E: `cd frontend && npm run test:e2e`
- Docs: `python3 -m mkdocs build --strict --config-file doc/mkdocs.yml --site-dir /tmp/bucketreef-docs-build`
- User screenshots: `npm --prefix frontend run docs:screenshots:check`

## Common mistakes

- Treating UI role as storage permission.
- Mixing S3 accounts and S3 connections.
- Adding Portal IAM concepts to user-facing Portal copy.
- Changing a route without updating the docs coverage matrix.
- Relying on typecheck alone for a route that can fail at runtime.

## Related pages

- [Local development](local-development.md)
- [Contributing](contributing.md)
- [Docs maintenance](docs-maintenance.md)
- [AI assistant guidelines](ai-assistant-guidelines.md)
