# Browser E2E bootstrap

The Playwright setup starts an empty backend database, waits for migrations,
issues a one-time first-administrator URL and completes the real
`/setup/first-admin` page with a virtual WebAuthn authenticator. It does not use
a predefined application administrator.

Administrator inputs are isolated to:

- `E2E_ADMIN_EMAIL`
- `E2E_ADMIN_PASSWORD`
- `E2E_ADMIN_FULL_NAME`

The backend wrapper writes the temporary URL with mode `0600` under
`backend/.browser-e2e-runtime/`; the setup reads it, immediately removes the URL
fragment through the application page, enrolls the passkey, then creates the
remaining E2E users and storage connection. The runtime directory is ignored by
Git and is recreated for every run.

From `frontend/`:

```bash
npm run test:e2e
```

Storage behavior uses the independently configured Moto/S3 test endpoint. It is
not part of the product quickstart.
