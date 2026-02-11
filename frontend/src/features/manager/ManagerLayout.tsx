/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { ChangeEvent } from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../../components/Layout";
import { S3AccountProvider, useS3AccountContext } from "./S3AccountContext";
import { SidebarSection } from "../../components/Sidebar";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

function getUserRole(): string | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { role?: string | null };
    return parsed.role ?? null;
  } catch {
    return null;
  }
}

type SessionCapabilities = {
  can_manage_iam?: boolean;
  can_manage_buckets?: boolean;
  can_view_traffic?: boolean;
};

function getUserCapabilities(): SessionCapabilities | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { capabilities?: SessionCapabilities };
    return parsed.capabilities ?? null;
  } catch {
    return null;
  }
}

function ManagerShell() {
  const {
    accounts,
    selectedS3AccountId,
    setSelectedS3AccountId,
    requiresS3AccountSelection,
    sessionS3AccountName,
    selectedS3AccountType,
    accessError,
    iamIdentity,
    accessMode,
    setAccessMode,
    canSwitchAccess,
    managerStatsEnabled,
  } = useS3AccountContext();
  const { generalSettings } = useGeneralSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selected = accounts.find((a) => a.id === selectedS3AccountId);
  const showSelector = requiresS3AccountSelection && accounts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const userRole = getUserRole();
  const fallbackCapabilities = getUserCapabilities();
  const capabilities = fallbackCapabilities ?? {
    can_manage_iam: true,
    can_manage_buckets: true,
    can_view_traffic: true,
  };
  const isS3User = selectedS3AccountType === "s3_user";
  const isConnection = selectedS3AccountType === "connection";
  const canManageBuckets = capabilities.can_manage_buckets !== false;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const iamFeatureEnabled = endpointCaps ? endpointCaps.iam !== false : true;
  const canManageIam = !isS3User && !isConnection && capabilities.can_manage_iam !== false && iamFeatureEnabled;
  const usageFeatureEnabled = endpointCaps ? endpointCaps.usage !== false : true;
  const metricsFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const canViewMetricsMenu = Boolean(managerStatsEnabled) && (usageFeatureEnabled || metricsFeatureEnabled);
  const isAccessModeToggleVisible = accessMode === "admin" || accessMode === "portal";
  const canToggleAccess = canSwitchAccess && isAccessModeToggleVisible;
  const identityLabel = iamIdentity
    ? accessMode === "connection"
      ? `Identité S3: ${iamIdentity}`
      : `Identité IAM: ${iamIdentity}`
    : selectedS3AccountType === "s3_user" && sessionS3AccountName
      ? `Compte utilisateur S3: ${sessionS3AccountName}`
      : null;
  const baseControlClasses =
    "w-48 rounded-full border border-slate-200 bg-white px-3 py-1.5 ui-caption font-semibold text-slate-700 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus-visible:ring-offset-slate-900";
  const selectClasses = `appearance-none pr-8 ${baseControlClasses}`;
  const pillClasses = `${baseControlClasses} ${selected ? "" : "text-slate-500 dark:text-slate-400"}`;
  const handleS3AccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value || null;
    if (value === selectedS3AccountId) return;
    setSelectedS3AccountId(value);
    const nextParams = new URLSearchParams(searchParams);
    if (value) {
      nextParams.set("ctx", value);
    } else {
      nextParams.delete("ctx");
    }
    navigate({ pathname: "/manager", search: nextParams.toString() ? `?${nextParams.toString()}` : "" });
  };
  const handleAccessModeToggle = () => {
    if (!canToggleAccess) return;
    setAccessMode(accessMode === "admin" ? "portal" : "admin");
  };

  const inlineAction = (
    <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:gap-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Context</span>
        {requiresS3AccountSelection ? (
          showSelector ? (
            <div className="relative">
              <select
                className={selectClasses}
                value={selectedS3AccountId ?? ""}
                onChange={handleS3AccountChange}
                title={identityLabel ?? undefined}
              >
                {!selected && (
                  <option value="">
                    No account selected
                  </option>
                )}
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id} title={acc.endpoint_url || undefined}>
                    {formatAccountLabel(acc, defaultEndpointId, defaultEndpointName)}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center ui-caption text-slate-500 dark:text-slate-300">
                ▼
              </div>
            </div>
          ) : (
            <div className={pillClasses} title={identityLabel ?? undefined}>
              {selected ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName) : "No account selected"}
            </div>
          )
        ) : (
          <div className={pillClasses} title={identityLabel ?? undefined}>
            {sessionS3AccountName || "RGW session"}
          </div>
        )}
      </div>
      {isAccessModeToggleVisible && (
        <div className="flex items-center gap-2">
          <span
            className={`ui-caption font-semibold ${
              canToggleAccess ? "text-slate-500 dark:text-slate-400" : "text-slate-400 dark:text-slate-500"
            }`}
          >
            Admin
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={accessMode === "admin"}
            onClick={handleAccessModeToggle}
            disabled={!canToggleAccess}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              accessMode === "admin"
                ? "bg-amber-400/80 dark:bg-amber-500/70"
                : "bg-slate-200 dark:bg-slate-700"
            } ${canToggleAccess ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
            aria-label={
              accessMode === "admin"
                ? canToggleAccess
                  ? "Admin mode active, switch to portal"
                  : "Admin mode active"
                : canToggleAccess
                  ? "Portal mode active, switch to admin"
                  : "Portal mode active"
            }
            title={
              accessMode === "admin"
                ? canToggleAccess
                  ? "Admin mode active"
                  : "Admin mode active"
                : canToggleAccess
                  ? "Portal mode active"
                  : "Portal mode active"
            }
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition ${
                accessMode === "admin" ? "translate-x-4" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}
    </div>
  );

  const navSections: SidebarSection[] = [
    {
      label: "Overview",
      links: [
        { to: "/manager", label: "Dashboard", end: true },
        { to: "/manager/metrics", label: "Metrics", disabled: !canViewMetricsMenu },
      ],
    },
  ];

  if (canManageBuckets) {
    navSections.push({
      label: "Storage",
      links: [
        { to: "/manager/buckets", label: "Buckets" },
        ...(generalSettings.browser_enabled && generalSettings.browser_manager_enabled
          ? [{ to: "/manager/browser", label: "Browser" }]
          : []),
      ],
    });
    if (snsFeatureEnabled) {
      navSections.push({
        label: "Events",
        links: [{ to: "/manager/topics", label: "SNS Topics" }],
      });
    }
  }

  if (canManageIam) {
    navSections.push({
      label: "IAM",
      links: [
        { to: "/manager/users", label: "Users" },
        { to: "/manager/groups", label: "Groups" },
        { to: "/manager/roles", label: "Roles" },
        { to: "/manager/iam/policies", label: "Policies" },
      ],
    });
  }

  return (
    <Layout
      navSections={navSections}
      hideHeader
      topbarContent={inlineAction}
      sidebarTitle="MANAGER"
    >
      <>
        {accessError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 shadow-sm dark:border-amber-900/40 dark:bg-amber-900/30 dark:text-amber-100">
            Access denied for /manager. Check your account permissions or contact an administrator.
          </div>
        )}
        <Outlet key={`${selectedS3AccountId ?? "session"}:${accessMode ?? "default"}`} />
      </>
    </Layout>
  );
}

export default function ManagerLayout() {
  return (
    <S3AccountProvider>
      <ManagerShell />
    </S3AccountProvider>
  );
}
