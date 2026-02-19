/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../../components/Layout";
import TopbarContextAccountSelector, {
  getContextAccessModeVisual,
} from "../../components/TopbarContextAccountSelector";
import { S3AccountProvider, useS3AccountContext } from "./S3AccountContext";
import { SidebarSection } from "../../components/Sidebar";
import { formatAccountLabel, useDefaultStorageEndpoint } from "../shared/storageEndpointLabel";
import { useGeneralSettings } from "../../components/GeneralSettingsContext";

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
  const usageFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const metricsFeatureEnabled = endpointCaps ? endpointCaps.usage !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const canViewMetricsMenu = Boolean(managerStatsEnabled) && (usageFeatureEnabled || metricsFeatureEnabled);
  const isAccessModeToggleVisible = accessMode === "admin" || accessMode === "portal";
  const canToggleAccess = canSwitchAccess && isAccessModeToggleVisible;
  const modeVisual = getContextAccessModeVisual(accessMode);
  const identityLabel = iamIdentity
    ? accessMode === "connection"
      ? `S3 Identity: ${iamIdentity}`
      : `IAM Identity: ${iamIdentity}`
    : selectedS3AccountType === "s3_user" && sessionS3AccountName
      ? `S3 user account: ${sessionS3AccountName}`
      : null;

  const pillClasses =
    "inline-flex h-9 items-center rounded-xl border border-slate-200/80 bg-white px-3 ui-caption font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
  const selectedLabel = selected
    ? formatAccountLabel(selected, defaultEndpointId, defaultEndpointName)
    : "No account selected";

  const handleS3AccountChange = (selectedValue: string) => {
    const value = selectedValue || null;
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
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-3">
        <span className="ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Context</span>
        {requiresS3AccountSelection ? (
          showSelector ? (
            <TopbarContextAccountSelector
              contexts={accounts}
              selectedContextId={selectedS3AccountId}
              onContextChange={handleS3AccountChange}
              selectedLabel={selectedLabel}
              identityLabel={identityLabel}
              accessMode={accessMode}
              canToggleAccess={canToggleAccess}
              onToggleAccess={handleAccessModeToggle}
              defaultEndpointId={defaultEndpointId}
              defaultEndpointName={defaultEndpointName}
            />
          ) : (
            <div className="inline-flex items-center gap-2">
              <div className={pillClasses} title={identityLabel ?? undefined}>
                {selectedLabel}
              </div>
              <span className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${modeVisual.classes}`}>
                {modeVisual.shortLabel}
              </span>
            </div>
          )
        ) : (
          <div className="inline-flex items-center gap-2">
            <div className={pillClasses} title={identityLabel ?? undefined}>
              {sessionS3AccountName || "S3 session"}
            </div>
            <span className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${modeVisual.classes}`}>
              {modeVisual.shortLabel}
            </span>
          </div>
        )}
      </div>
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
    <Layout navSections={navSections} hideHeader topbarContent={inlineAction} sidebarTitle="MANAGER">
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
