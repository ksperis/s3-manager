/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dismissOnboarding, fetchOnboardingStatus, type OnboardingStatus } from "../../api/onboarding";
import { AdminSummary, fetchAdminSummary } from "../../api/stats";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import StatCards from "../../components/StatCards";

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingStatus | null>(null);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
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
              hint: "Credentialed access entries",
              to: "/admin/s3-connections",
            },
          ]
        : [],
    [summary]
  );

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

      {error && <PageBanner tone="error">{error}</PageBanner>}

      <StatCards stats={cards} columns={3} />
    </div>
  );
}
