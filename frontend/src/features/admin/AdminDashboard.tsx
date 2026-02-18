/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { getBillingSummary } from "../../api/billing";
import { fetchHealthSummary, fetchHealthWorkspaceOverview, WorkspaceEndpointHealthOverviewResponse } from "../../api/healthchecks";
import { dismissOnboarding, fetchOnboardingStatus, type OnboardingStatus } from "../../api/onboarding";
import { AdminSummary, fetchAdminSummary } from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import StatCards from "../../components/StatCards";
import WorkspaceEndpointHealthCards from "../../components/WorkspaceEndpointHealthCards";

const ENDPOINT_STATUS_MAX_AGE_HOURS = 24;
const ENDPOINT_STATUS_MAX_AGE_MS = ENDPOINT_STATUS_MAX_AGE_HOURS * 60 * 60 * 1000;

function utcMonthKey(value: Date): string {
  const year = value.getUTCFullYear();
  const month = `${value.getUTCMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function getYesterdayUtc(now = new Date()): Date {
  const midnightUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  midnightUtc.setUTCDate(midnightUtc.getUTCDate() - 1);
  return midnightUtc;
}

function parseBackendIsoDate(value?: string | null): Date | null {
  if (!value) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value);
  const normalized = hasTimezone ? value : `${value}Z`;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [billingFreshnessWarning, setBillingFreshnessWarning] = useState<string | null>(null);
  const [endpointFreshnessWarning, setEndpointFreshnessWarning] = useState<string | null>(null);
  const [workspaceHealth, setWorkspaceHealth] = useState<WorkspaceEndpointHealthOverviewResponse | null>(null);
  const [workspaceHealthLoading, setWorkspaceHealthLoading] = useState(false);
  const [workspaceHealthError, setWorkspaceHealthError] = useState<string | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);
  const { generalSettings } = useGeneralSettings();

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAdminSummary();
        setSummary(data);
        setError(null);
      } catch (err) {
        setError("Unable to load admin overview.");
      }
    };
    load();
  }, []);

  useEffect(() => {
    const loadOnboarding = async () => {
      try {
        const data = await fetchOnboardingStatus();
        setOnboarding(data);
        setOnboardingError(null);
      } catch (err) {
        setOnboardingError("Unable to load onboarding status.");
      }
    };
    loadOnboarding();
  }, []);

  useEffect(() => {
    if (!generalSettings.billing_enabled) {
      setBillingFreshnessWarning(null);
      return;
    }
    let cancelled = false;
    const verifyBillingFreshness = async () => {
      try {
        const yesterday = getYesterdayUtc();
        const expectedMonth = utcMonthKey(yesterday);
        const expectedCollectedDays = yesterday.getUTCDate();
        const summaryData = await getBillingSummary(expectedMonth);
        if (cancelled) return;
        if (summaryData.coverage.days_collected < expectedCollectedDays) {
          const expectedDay = yesterday.toISOString().slice(0, 10);
          setBillingFreshnessWarning(
            `Billing collection seems stale: expected data up to ${expectedDay}, but only ${summaryData.coverage.days_collected} day(s) are collected for ${expectedMonth}.`
          );
          return;
        }
        setBillingFreshnessWarning(null);
      } catch {
        if (!cancelled) {
          setBillingFreshnessWarning("Billing is enabled, but freshness could not be verified from billing data.");
        }
      }
    };
    verifyBillingFreshness();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.billing_enabled]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) {
      setEndpointFreshnessWarning(null);
      setWorkspaceHealth(null);
      setWorkspaceHealthError(null);
      setWorkspaceHealthLoading(false);
      return;
    }
    let cancelled = false;
    const verifyEndpointStatusFreshness = async () => {
      try {
        const data = await fetchHealthSummary();
        if (cancelled) return;
        const endpoints = data.endpoints ?? [];
        if (endpoints.length === 0) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but no endpoint healthcheck data is available.");
          return;
        }
        const now = Date.now();
        let noChecksCount = 0;
        let staleCount = 0;
        for (const endpoint of endpoints) {
          if ((endpoint.error_message ?? "").toLowerCase().includes("no checks yet")) {
            noChecksCount += 1;
            continue;
          }
          const checkedAt = parseBackendIsoDate(endpoint.checked_at);
          if (!checkedAt || now - checkedAt.getTime() > ENDPOINT_STATUS_MAX_AGE_MS) {
            staleCount += 1;
          }
        }
        if (noChecksCount > 0 || staleCount > 0) {
          setEndpointFreshnessWarning(
            `Endpoint Status data is not recent enough for ${noChecksCount + staleCount}/${endpoints.length} endpoint(s) (no checks or older than ${ENDPOINT_STATUS_MAX_AGE_HOURS}h).`
          );
          return;
        }
        setEndpointFreshnessWarning(null);
      } catch {
        if (!cancelled) {
          setEndpointFreshnessWarning("Endpoint Status is enabled, but freshness could not be verified.");
        }
      }
    };
    verifyEndpointStatusFreshness();
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled]);

  useEffect(() => {
    if (!generalSettings.endpoint_status_enabled) return;
    let cancelled = false;
    setWorkspaceHealthLoading(true);
    setWorkspaceHealthError(null);
    fetchHealthWorkspaceOverview()
      .then((data) => {
        if (cancelled) return;
        setWorkspaceHealth(data);
      })
      .catch(() => {
        if (cancelled) return;
        setWorkspaceHealth(null);
        setWorkspaceHealthError("Unable to load workspace endpoint health.");
      })
      .finally(() => {
        if (!cancelled) {
          setWorkspaceHealthLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [generalSettings.endpoint_status_enabled]);

  const handleDismissOnboarding = async () => {
    if (!onboarding?.can_dismiss) return;
    setDismissBusy(true);
    try {
      const data = await dismissOnboarding();
      setOnboarding(data);
    } catch (err) {
      setOnboardingError("Unable to dismiss onboarding yet.");
    } finally {
      setDismissBusy(false);
    }
  };

  const cards = useMemo(
    () =>
      summary
        ? [
            {
              label: "UI users",
              value: (summary.total_users ?? 0) + (summary.total_admins ?? 0) + (summary.total_none_users ?? 0),
              hint: `Admins: ${summary.total_admins ?? 0} | Users: ${summary.total_users ?? 0} | None: ${
                summary.total_none_users ?? 0
              }`,
              to: "/admin/users",
            },
            {
              label: "Endpoints",
              value: summary.total_endpoints ?? 0,
              hint: `Ceph: ${summary.total_ceph_endpoints ?? 0} | Other: ${summary.total_other_endpoints ?? 0}`,
              to: "/admin/storage-endpoints",
            },
            {
              label: "Accounts",
              value: summary.total_accounts,
              hint: `Assigned: ${summary.assigned_accounts ?? 0} | Unassigned: ${summary.unassigned_accounts ?? 0}`,
              to: "/admin/s3-accounts",
            },
            {
              label: "S3 users",
              value: summary.total_s3_users ?? 0,
              hint: `Assigned: ${summary.assigned_s3_users ?? 0} | Unassigned: ${summary.unassigned_s3_users ?? 0}`,
              to: "/admin/s3-users",
            },
            {
              label: "Connections",
              value: summary.total_connections ?? 0,
              hint: `Private: ${summary.total_private_connections ?? 0} | Public: ${summary.total_public_connections ?? 0}`,
              to: "/admin/s3-connections",
            },
          ]
        : [],
    [summary]
  );

  const coreFeatures = useMemo(
    () => [
      {
        id: "manager",
        label: "Manager",
        description: "Tenant administration workspace",
        enabled: generalSettings.manager_enabled,
        critical: false,
      },
      {
        id: "browser",
        label: "Browser",
        description: "Object and bucket navigation workspace",
        enabled: generalSettings.browser_enabled,
        critical: false,
      },
      {
        id: "portal",
        label: "Portal",
        description: "End-user self-service workspace",
        enabled: generalSettings.portal_enabled,
        critical: false,
      },
      {
        id: "ceph_admin",
        label: "Ceph admin",
        description: "Cluster-wide advanced operations",
        enabled: generalSettings.ceph_admin_enabled,
        critical: true,
      },
    ],
    [
      generalSettings.browser_enabled,
      generalSettings.ceph_admin_enabled,
      generalSettings.manager_enabled,
      generalSettings.portal_enabled,
    ]
  );

  const enabledCoreFeatures = useMemo(() => coreFeatures.filter((feature) => feature.enabled), [coreFeatures]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin overview"
        breadcrumbs={[{ label: "Admin" }, { label: "Dashboard" }]}
      />

      {onboarding && !onboarding.dismissed && (
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <h2 className="ui-subtitle font-semibold text-slate-900 dark:text-white">
                Welcome! Let&apos;s finish your initial setup.
              </h2>
              <p className="ui-body text-slate-600 dark:text-slate-300">
                Complete the two base steps below to unlock the rest of the console. You can dismiss this checklist once the base
                setup is done.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDismissOnboarding}
              disabled={!onboarding.can_dismiss || dismissBusy}
              className="rounded-lg border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
            >
              {dismissBusy ? "Dismissing..." : "Dismiss checklist"}
            </button>
          </div>

          {onboardingError && <p className="mt-3 ui-body text-rose-600">{onboardingError}</p>}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">1. Secure the default admin</p>
                  <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                    Change the seeded admin email and password so the default credentials are no longer active.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 ui-caption font-semibold ${
                    onboarding.seed_user_configured
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {onboarding.seed_user_configured ? "Done" : "Pending"}
                </span>
              </div>
              <div className="mt-3">
                <Link
                  to="/admin/users"
                  className="inline-flex items-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
                >
                  Go to UI users
                </Link>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">2. Configure a storage endpoint</p>
                  <p className="mt-1 ui-caption text-slate-600 dark:text-slate-300">
                    Add at least one S3 or Ceph endpoint so the platform can manage accounts and users.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 ui-caption font-semibold ${
                    onboarding.endpoint_configured
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {onboarding.endpoint_configured ? "Done" : "Pending"}
                </span>
              </div>
              <div className="mt-3">
                <Link
                  to="/admin/storage-endpoints"
                  className="inline-flex items-center rounded-lg bg-primary px-3 py-2 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600"
                >
                  Configure endpoints
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-4 dark:border-slate-800 dark:bg-slate-900">
            <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Next steps</p>
            <p className="mt-2 ui-caption text-slate-600 dark:text-slate-300">
              Add a UI user, create an account, and link that account to the UI user. If you plan to use the portal, enable the
              Portal feature in Settings first so you can assign portal roles.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Link
                to="/admin/users"
                className="rounded-lg border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
              >
                Add UI user
              </Link>
              <Link
                to="/admin/s3-accounts"
                className="rounded-lg border border-slate-200 px-3 py-2 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
              >
                Create account
              </Link>
            </div>
          </div>
        </div>
      )}

      {billingFreshnessWarning && <PageBanner tone="warning">{billingFreshnessWarning}</PageBanner>}
      {endpointFreshnessWarning && <PageBanner tone="warning">{endpointFreshnessWarning}</PageBanner>}
      {error && <PageBanner tone="error">{error}</PageBanner>}

      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="ui-body font-semibold text-slate-900 dark:text-white">Active core features</h2>
            <p className="ui-caption text-slate-600 dark:text-slate-300">
              {enabledCoreFeatures.length} / {coreFeatures.length} enabled
            </p>
          </div>
          <Link
            to="/admin/general-settings"
            className="rounded-md border border-slate-200 px-2.5 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-400 dark:hover:text-primary-100"
          >
            Configure features
          </Link>
        </div>

        {enabledCoreFeatures.length === 0 ? (
          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">No core feature is enabled.</p>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {enabledCoreFeatures.map((feature) => {
              const baseClasses = feature.critical
                ? "border-orange-200 bg-orange-50 dark:border-orange-500/50 dark:bg-orange-950/30"
                : "border-emerald-200 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-950/30";
              const labelClasses = feature.critical
                ? "text-orange-900 dark:text-orange-100"
                : "text-emerald-900 dark:text-emerald-100";
              const badgeClasses = feature.critical
                ? "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200"
                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200";

              return (
                <div key={feature.id} className={`rounded-lg border px-2.5 py-2 ${baseClasses}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`ui-caption font-semibold ${labelClasses}`}>{feature.label}</p>
                    <span className={`rounded-full px-1.5 py-0.5 ui-caption font-semibold ${badgeClasses}`}>ON</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {generalSettings.endpoint_status_enabled && (
        <WorkspaceEndpointHealthCards
          data={workspaceHealth}
          loading={workspaceHealthLoading}
          error={workspaceHealthError}
          title="Endpoint Health (Platform)"
          action={{ to: "/admin/endpoint-status", label: "Open Endpoint Status" }}
        />
      )}

      <StatCards stats={cards} columns={3} />
    </div>
  );
}
