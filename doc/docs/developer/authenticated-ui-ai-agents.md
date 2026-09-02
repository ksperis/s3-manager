# Authenticated UI Access for AI Agents

Use this workflow when an AI agent needs to inspect a real authenticated
BucketReef route from the current checkout. The default path is isolated: it
does not reuse `backend/app.db`, Quickstart volumes, local users, or configured
storage endpoints.

The harness covers two surfaces:

- `/admin` with a super-administrator session created through the real
  first-administrator and WebAuthn enrollment flow;
- `/browser` with a separate UI user, private S3 Connection, and seeded Moto
  bucket.

Manager, Portal, Ceph Admin, and Storage Ops are not seeded by this workflow.

## Prerequisites

Install the normal backend and frontend development dependencies first. The
backend virtualenv must provide `moto_server`, and the frontend installation
must provide Playwright and Chromium. Playwright CLI access also requires
Node.js/npm and `npx`.

Verify the Playwright CLI prerequisite:

```bash
command -v npx >/dev/null 2>&1
```

The isolated harness does not require Docker.

## Start the isolated authenticated UI

From the repository root:

```bash
npm --prefix frontend run ui:agent
```

In an agent shell where every command must use RTK, use the streaming form so
the readiness message remains visible:

```bash
rtk proxy npm --prefix frontend run ui:agent
```

The command:

1. refuses to reuse occupied ports;
2. starts its own Moto, FastAPI, and Vite processes;
3. creates a fresh temporary SQLite database and generated key rings;
4. completes real first-admin bootstrap and virtual WebAuthn enrollment;
5. writes independent Admin and Browser storage states with mode `0600`;
6. prints the exact Admin and Browser URLs, then stays in the foreground.

Keep this command running while inspecting the UI. Press `Ctrl+C` in its
terminal to stop only the processes it started.

The defaults are:

| Service | Address |
|---|---|
| Frontend | `http://localhost:4173` |
| Backend | `http://127.0.0.1:18080` |
| Moto S3 | `http://127.0.0.1:15000` |

If a default port is occupied, choose three distinct alternatives rather than
reusing an unknown process:

```bash
npm --prefix frontend run ui:agent -- \
  --frontend-port 14173 \
  --backend-port 18081 \
  --s3-port 15001
```

Always use the frontend URL printed by the command. The harness derives CORS
and WebAuthn origins from that port while retaining `localhost` as the WebAuthn
relying-party host.

## Open the reusable Playwright CLI sessions

In a second terminal, configure the bundled Playwright CLI wrapper:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
cd frontend
```

Open Admin:

```bash
rtk "$PWCLI" --session bucketreef-admin \
  --config playwright-cli.agent-admin.json \
  open http://localhost:4173/admin --headed
rtk "$PWCLI" --session bucketreef-admin snapshot
rtk "$PWCLI" --session bucketreef-admin console
```

Open Browser:

```bash
rtk "$PWCLI" --session bucketreef-browser \
  --config playwright-cli.agent-browser.json \
  open http://localhost:4173/browser --headed
rtk "$PWCLI" --session bucketreef-browser snapshot
rtk "$PWCLI" --session bucketreef-browser console
```

When ports were overridden, replace `4173` with the printed frontend port. Use
the same named session for later navigation, snapshots, console inspection,
and tracing. Close the sessions when finished:

```bash
rtk "$PWCLI" --session bucketreef-admin close
rtk "$PWCLI" --session bucketreef-browser close
```

The state files live under `frontend/e2e/.auth/`; Playwright CLI runtime files
live under `.playwright-cli/`. Both locations are ignored by Git. They contain
temporary authentication material: never print, copy, commit, or reuse them
against another backend.

## Run the automated self-check

Use this before relying on the interactive workflow or after changing its
authentication, process, or port behavior:

```bash
rtk npm --prefix frontend run ui:agent:test
rtk npm --prefix frontend run ui:agent:check
```

The first command verifies option parsing and occupied-port refusal. The second
starts the full isolated stack, checks authenticated Admin and Browser reloads,
checks the session API and Moto bucket, rejects application JavaScript errors,
then stops every process it started.

The full check also accepts `--frontend-port`, `--backend-port`, and
`--s3-port` after `--`.

## Expected console and network noise

Inspect console and network output, but classify it accurately:

- `/api/admin/stats/storage` and `/api/admin/stats/traffic` can return `403`
  because the isolated endpoint has no RGW Admin metrics credentials;
- `/api/manager/context` can return `403` for the Browser-only user because it
  has no Manager permission;
- Gravatar can return `404` when no avatar exists;
- Moto can report `NoSuchCORSConfiguration` for the seeded bucket.

These resource failures are not authentication failures and are not JavaScript
exceptions. A redirect to `/login`, a `401` from `/api/auth/session`, an
uncaught page error, or missing Admin/Browser content is a failed authenticated
smoke test.

## Troubleshooting

| Symptom | Action |
|---|---|
| `Operation not permitted` or loopback binding denied | Request permission for local process networking, then rerun. Do not diagnose this as a BucketReef login failure. |
| A port is already in use | Use explicit alternate ports or stop only a process whose ownership is known. The harness deliberately does not reuse it. |
| The route redirects to `/login` | The saved state is stale, the isolated backend was restarted, or the wrong origin was opened. Stop and restart `ui:agent`. |
| Recent WebAuthn verification is required | Restart the isolated harness to create a fresh verified session. Do not weaken or reset the MFA guard. |
| Browser contacts an unexpected S3 endpoint or reports `AccessDenied` | Stop the harness and run `ui:agent:check`. The isolated runner must clear ambient `ENV_STORAGE_ENDPOINTS`; never copy local endpoint credentials into the test state. |
| Docker is unavailable | Continue with the isolated harness. Docker is required only for the optional Quickstart/live path below. |

## Optional validation against the real local instance

Use a real local instance only when the requested evidence depends on its
actual data or storage configuration. From the current checkout, Quickstart is
the preferred live path:

```bash
./quickstart
./quickstart status
```

Open its login URL in a distinct headed Playwright CLI session:

```bash
rtk "$PWCLI" --session bucketreef-live open http://localhost:8080/login --headed
```

The user must complete password and passkey authentication in that visible
browser. Continue automation only in the same named session after the user has
finished. Never request or record the password, passkey, recovery codes, or
session cookies.

Do not run `./quickstart reset`, issue a replacement administrator, reset MFA,
or reseed existing development data merely to obtain access. If authentication
or a recent WebAuthn step-up is required, stop and ask the user to complete it.
The isolated Admin and Browser state files are never valid evidence for the
live instance.

## Evidence checklist

For each validated route:

1. capture a fresh snapshot showing the expected heading, workspace, or bucket;
2. reload and confirm the route remains authenticated;
3. inspect console and relevant network failures;
4. distinguish expected resource failures from application exceptions;
5. keep screenshots, traces, videos, reports, tokens, and copied secrets out of
   commits.

A successful process start, type check, unit test, or redirect to `/login` is
not authenticated browser evidence.
