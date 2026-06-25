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
import type { TopbarControlDescriptor } from "../../components/topbarControlsLayout";
import {
  getManagerToolAccess,
  readStoredUser,
} from "../../utils/workspaces";

type SessionCapabilities = {
  can_manage_iam?: boolean;
  can_manage_buckets?: boolean;
  can_view_traffic?: boolean;
};

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
    managerStatsEnabled,
    managerStatsMessage,
    managerBrowserEnabled,
    managerCephKeysEnabled,
  } = useS3AccountContext();
  const { generalSettings } = useGeneralSettings();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selected = accounts.find((a) => a.id === selectedS3AccountId);
  const showSelector = requiresS3AccountSelection && accounts.length > 1;
  const { defaultEndpointId, defaultEndpointName } = useDefaultStorageEndpoint();
  const storedUser = readStoredUser();
  const userCapabilities = (storedUser?.capabilities as SessionCapabilities | undefined) ?? null;
  const contextCapabilities = (selected?.capabilities as Partial<SessionCapabilities> | undefined) ?? null;
  const capabilities: SessionCapabilities = {
    can_manage_iam: contextCapabilities?.can_manage_iam ?? userCapabilities?.can_manage_iam ?? true,
    can_manage_buckets: contextCapabilities?.can_manage_buckets ?? userCapabilities?.can_manage_buckets ?? true,
    can_view_traffic: contextCapabilities?.can_view_traffic ?? userCapabilities?.can_view_traffic ?? true,
  };
  const isS3User = selectedS3AccountType === "s3_user";
  const canManageBuckets = capabilities.can_manage_buckets !== false;
  const canAccessBucketCompare =
    canManageBuckets && Boolean(generalSettings.bucket_compare_enabled) && Boolean(requiresS3AccountSelection);
  const canAccessBucketIntegrity =
    canManageBuckets && Boolean(generalSettings.bucket_integrity_check_enabled) && Boolean(requiresS3AccountSelection);
  const canAccessBucketPurge =
    canManageBuckets && Boolean(generalSettings.bucket_purge_enabled) && Boolean(requiresS3AccountSelection);
  const userRole = storedUser?.role ?? null;
  const managerToolAccess = getManagerToolAccess(storedUser);
  const canAccessMigration =
    Boolean(generalSettings.bucket_migration_enabled) &&
    Boolean(managerToolAccess?.bucket_migration) &&
    (userRole === "ui_admin" || userRole === "ui_superadmin" || userRole === "ui_user");
  const canAccessBucketCompareForUser = Boolean(managerToolAccess?.bucket_compare);
  const canAccessBucketIntegrityForUser = Boolean(managerToolAccess?.bucket_integrity_check);
  const canAccessBucketPurgeForUser = Boolean(managerToolAccess?.bucket_purge);
  const canAccessFeatureRulesForUser = Boolean(managerToolAccess?.feature_rules);
  const canShowBucketCompare = canAccessBucketCompare && canAccessBucketCompareForUser;
  const canShowBucketIntegrity = canAccessBucketIntegrity && canAccessBucketIntegrityForUser;
  const canShowBucketPurge = canAccessBucketPurge && canAccessBucketPurgeForUser;
  const endpointCaps = selected?.storage_endpoint_capabilities ?? null;
  const iamFeatureEnabled = endpointCaps ? endpointCaps.iam !== false : true;
  const canManageIam = !isS3User && capabilities.can_manage_iam !== false && iamFeatureEnabled;
  const usageFeatureEnabled = endpointCaps ? endpointCaps.metrics !== false : true;
  const metricsFeatureEnabled = endpointCaps ? endpointCaps.usage !== false : true;
  const snsFeatureEnabled = endpointCaps ? endpointCaps.sns !== false : true;
  const canViewUsageStatsMenu =
    canManageBuckets && Boolean(requiresS3AccountSelection) && Boolean(generalSettings.bucket_usage_stats_enabled);
  const canViewMetricsMenu =
    canViewUsageStatsMenu || (Boolean(managerStatsEnabled) && (usageFeatureEnabled || metricsFeatureEnabled));
  const managerMetricsDisabledHint =
    managerStatsEnabled === null
      ? "Metrics availability is loading for this context."
      : managerStatsEnabled === false
        ? managerStatsMessage && managerStatsMessage.trim()
          ? managerStatsMessage
          : "Metrics are disabled for this context."
        : !usageFeatureEnabled && !metricsFeatureEnabled
          ? "Metrics are unavailable for this endpoint capabilities."
          : undefined;
  const managerBrowserAvailable = managerBrowserEnabled !== false;
  const modeVisual = getContextAccessModeVisual(accessMode);
  const identityLabel = iamIdentity
    ? accessMode === "connection"
      ? `S3 Identity: ${iamIdentity}`
      : `IAM Identity: ${iamIdentity}`
    : selectedS3AccountType === "s3_user" && sessionS3AccountName
      ? `S3 user account: ${sessionS3AccountName}`
      : null;

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

  const compactAccountControlWidthClass = "w-[96px] max-w-[26vw] min-w-[4.75rem]";

  const renderStaticAccountPill = (mode: "icon" | "icon_label") => {
    if (mode === "icon") {
      return (
        <button
          type="button"
          aria-label={`Account context ${selectedLabel}`}
          title={identityLabel ?? selectedLabel}
          className={`shell-control inline-flex h-10 ${compactAccountControlWidthClass} items-center rounded-lg border px-2 text-left`}
        >
          <span className="min-w-0 flex-1 leading-tight">
            <span className="shell-muted-text block truncate text-[10px] font-medium">Account</span>
            <span className="mt-0.5 block truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
              {selectedLabel}
            </span>
          </span>
        </button>
      );
    }
    return (
      <div className="shell-control inline-flex h-10 w-[300px] max-w-[42vw] min-w-[17rem] items-center gap-2.5 rounded-lg border px-3 text-left">
        <span className="min-w-0 flex-1 leading-tight">
          <span className="shell-muted-text block truncate text-[10px] font-medium">
            Account
          </span>
          <span className="mt-0.5 block max-w-[18rem] truncate text-[12px] font-semibold leading-4 text-[var(--shell-text)]">
            {selectedLabel}
          </span>
        </span>
        <span className={`rounded-full px-2 py-0.5 ui-caption font-semibold ${modeVisual.classes}`}>
          {modeVisual.shortLabel}
        </span>
      </div>
    );
  };

  const topbarControlDescriptors: TopbarControlDescriptor[] = [
    {
      id: "account",
      icon: <AccountControlIcon className="h-4 w-4" />,
      selectedLabel,
      priority: 10,
      estimatedIconWidth: 96,
      estimatedLabelWidth: 212,
      renderControl: (mode) =>
        requiresS3AccountSelection && showSelector ? (
          <TopbarContextAccountSelector
            contexts={accounts}
            selectedContextId={selectedS3AccountId}
            onContextChange={handleS3AccountChange}
            selectedLabel={selectedLabel}
            identityLabel={identityLabel}
            defaultEndpointId={defaultEndpointId}
            defaultEndpointName={defaultEndpointName}
            widthClassName={mode === "icon" ? compactAccountControlWidthClass : "w-[300px] max-w-[42vw] min-w-[17rem]"}
            triggerMode={mode === "icon" ? "icon_label" : mode}
            showTriggerTags={mode !== "icon"}
          />
        ) : (
          renderStaticAccountPill(mode)
        ),
    },
  ];

  const navSections: SidebarSection[] = [
    {
      label: "Overview",
      links: [
        { to: "/manager", label: "Dashboard", end: true },
        {
          to: "/manager/metrics",
          label: "Usage & Metrics",
          disabled: !canViewMetricsMenu,
          disabledHint: !canViewMetricsMenu ? managerMetricsDisabledHint : undefined,
        },
      ],
    },
  ];

  if (canManageBuckets) {
    navSections.push({
      label: "Storage",
      links: [
        { to: "/manager/buckets", label: "Buckets" },
        ...(generalSettings.browser_enabled && generalSettings.browser_manager_enabled && managerBrowserAvailable
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

  if (managerCephKeysEnabled) {
    navSections.push({
      label: "Ceph",
      links: [{ to: "/manager/ceph/keys", label: "Access keys" }],
    });
  }

  if (canManageBuckets) {
    const toolsLinks: SidebarSection[number]["links"] = [];
    if (canAccessFeatureRulesForUser) {
      toolsLinks.push({ to: "/manager/feature-rules", label: "Feature rules" });
    }
    if (canShowBucketCompare) {
      toolsLinks.push({ to: "/manager/bucket-compare", label: "Compare" });
    }
    if (canShowBucketIntegrity) {
      toolsLinks.push({ to: "/manager/bucket-integrity", label: "Integrity" });
    }
    if (canShowBucketPurge) {
      toolsLinks.push({ to: "/manager/bucket-purge", label: "Purge" });
    }
    if (canAccessMigration) {
      toolsLinks.push({ to: "/manager/migrations", label: "Migration" });
    }
    if (toolsLinks.length > 0) {
      navSections.push({
        label: "Tools",
        links: toolsLinks,
      });
    }
  }

  return (
    <Layout
      navSections={navSections}
      headerTitle="Manager"
      hideHeader
      sidebarTitle="MANAGER"
      topbarControlDescriptors={topbarControlDescriptors}
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

function AccountControlIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" strokeWidth={1.5} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M3 10h18" />
      <circle cx="8.5" cy="14.2" r="1.1" strokeWidth={1.4} />
      <path strokeLinecap="round" strokeWidth={1.5} d="M12 14.2h6" />
    </svg>
  );
}

export default function ManagerLayout() {
  return (
    <S3AccountProvider>
      <ManagerShell />
    </S3AccountProvider>
  );
}
