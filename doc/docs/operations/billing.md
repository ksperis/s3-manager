# Billing (Usage & Cost)

Billing is **disabled by default** and must be explicitly enabled.
When disabled, Billing menus and routes are hidden in the UI.

## Enable Billing

Enable it in **both**:

1. **App settings (UI)**
   Admin → General settings → **Billing feature**
2. **Backend env flag** (global kill switch)
   `BILLING_ENABLED=true`

> If `BILLING_ENABLED=false`, Billing stays disabled even if the UI toggle is on.

## Daily Collection (Cron)

Billing is based on daily snapshots. You can trigger it manually:

```bash
curl -X POST "http://localhost:8000/api/internal/billing/collect/daily?day=YYYY-MM-DD" \
  -H "X-Internal-Token: <INTERNAL_CRON_TOKEN>"
```

### Helm (recommended)

Enable the built‑in cronjob and provide the internal token:

```yaml
backend:
  env:
    INTERNAL_CRON_TOKEN: "change-me-strong"

billingCronJob:
  enabled: true
  schedule: "0 2 * * *"
  dayOffset: 1
```

### Docker Compose / Local Cron

Use any scheduler (cron, task runner, etc.) to call the internal endpoint.
Just make sure `INTERNAL_CRON_TOKEN` is set on the backend container.
