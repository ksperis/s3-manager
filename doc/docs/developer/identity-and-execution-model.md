# Identity and Execution Model

## Separation of identities

- **UI identity**: who can access which workspace.
- **Storage executor identity**: which credentials are used for storage actions.

## Context and executor

- `/manager` and `/browser` rely on execution context selection.
- Backend resolves executor from selected context and policy constraints.

## Practical impact

A single UI user can have access to multiple accounts/connections/endpoints while keeping execution explicit and auditable.
