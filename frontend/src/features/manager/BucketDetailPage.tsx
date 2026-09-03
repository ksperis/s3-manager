/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  cx,
  uiButtonBaseClass,
  uiButtonVariants,
  uiCardMutedClass,
  uiCheckboxClass,
  uiDataTableClass,
  uiInputClass,
  uiTableContainerClass,
} from "../../components/ui/styles";
import type { BucketPublicAccessBlock } from "../../api/bucketContracts";
import ConfirmActionDialog from "../../components/ConfirmActionDialog";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import PageTabs from "../../components/PageTabs";
import SplitView from "../../components/SplitView";
import { MetricsCard } from "../../components/MetricsCard";
import UsageTile from "../../components/UsageTile";
import UiInlineMessage from "../../components/ui/UiInlineMessage";
import { formatCompactNumber } from "../../utils/format";
import { isAdminLikeRole, readStoredUser } from "../../utils/workspaces";
import { useS3AccountContext } from "./S3AccountContext";
import TrafficAnalytics from "./TrafficAnalytics";
import BucketUsageStatsPanel from "../shared/BucketUsageStatsPanel";
import PropertySummaryChip, { PropertySummaryTone } from "../../components/PropertySummaryChip";
import { PortalSettingsSwitch } from "../../components/PortalSettingsLayout";
import { useCephAdminEndpoint } from "../cephAdmin/CephAdminEndpointContext";
import {
  BucketFeatureCard,
  BucketFeatureJsonExample,
  BucketFeatureModeToggle,
  bucketAclOptions,
  buildNotificationExample,
  type BucketQuotaUnit,
  buildPolicyExample,
  defaultCorsExample,
  defaultEncryptionExample,
  defaultNotificationTemplate,
  resolveFeatureVisualState,
  useBucketAccessLoggingController,
  useBucketAclController,
  useBucketCorsController,
  useBucketEncryptionController,
  useBucketLifecycleController,
  useBucketMetadataController,
  useBucketNotificationsController,
  useBucketObjectLockController,
  useBucketObjectsController,
  useBucketPolicyController,
  useBucketPublicAccessController,
  useBucketQuotaController,
  useBucketReplicationController,
  useBucketTagsController,
  useBucketUsageStatsController,
  useBucketVersioningController,
  useBucketWebsiteController,
} from "./bucketDetail";
import {
  describeLifecycleActions,
  lifecycleFilterLabel,
  lifecycleRuleId,
  lifecycleRulePrefix,
  lifecycleRuleStatus,
  type LifecycleRuleRecord,
} from "./bucketLifecycle";
import {
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
  type BucketDetailTabId,
  type BucketDetailMode,
} from "./bucketDetail/bucketDetailSurface";
import { isApiFeatureNotImplemented } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import type { UiRole } from "../../api/users";

type BucketConfigurationDeleteKind =
  | "cors"
  | "encryption"
  | "tags"
  | "notifications"
  | "replication"
  | "website"
  | "policy"
  | "access-logging";

const bucketConfigurationDeleteCopy: Record<
  BucketConfigurationDeleteKind,
  { title: string; description: string; confirmLabel: string; impacts: string[] }
> = {
  cors: {
    title: "Delete CORS configuration?",
    description: "Remove all cross-origin access rules from this bucket.",
    confirmLabel: "Delete CORS configuration",
    impacts: ["Browser-based clients may no longer be able to access objects across origins."],
  },
  encryption: {
    title: "Disable default bucket encryption?",
    description: "Remove the default server-side encryption rules for new objects.",
    confirmLabel: "Disable encryption",
    impacts: ["Existing objects remain encrypted. New objects will no longer inherit this bucket default."],
  },
  tags: {
    title: "Clear all bucket tags?",
    description: "Remove every key/value tag attached to this bucket.",
    confirmLabel: "Clear tags",
    impacts: ["Automation or access rules that rely on bucket tags may stop matching this bucket."],
  },
  notifications: {
    title: "Clear notification configuration?",
    description: "Remove every event notification configured for this bucket.",
    confirmLabel: "Clear notifications",
    impacts: ["New bucket events will no longer be delivered to the configured destinations."],
  },
  replication: {
    title: "Clear replication configuration?",
    description: "Remove the replication rules configured for this bucket.",
    confirmLabel: "Clear replication",
    impacts: ["New object changes will stop replicating. Existing destination objects will remain."],
  },
  website: {
    title: "Delete static website configuration?",
    description: "Stop hosting or redirecting requests through this bucket's website endpoint.",
    confirmLabel: "Delete website configuration",
    impacts: ["Website routing will stop. Objects stored in the bucket will not be deleted."],
  },
  policy: {
    title: "Delete bucket policy?",
    description: "Remove the IAM-style resource policy attached directly to this bucket.",
    confirmLabel: "Delete bucket policy",
    impacts: ["Access granted only by this policy will be revoked. IAM and ACL permissions remain unchanged."],
  },
  "access-logging": {
    title: "Disable server access logging?",
    description: "Stop delivering new server access logs for this bucket.",
    confirmLabel: "Disable access logging",
    impacts: ["Existing log objects remain in the target bucket, but no new access logs will be delivered."],
  },
};

function getUserRole(): UiRole | null {
  return readStoredUser()?.role ?? null;
}

type PropertySummary = {
  label: string;
  state: string;
  tone: PropertySummaryTone;
};

const publicAccessOptions: { key: keyof BucketPublicAccessBlock; label: string; description: string }[] = [
  {
    key: "block_public_acls",
    label: "BlockPublicAcls",
    description: "S3 rejects new PUT ACLs that grant public access to buckets or objects.",
  },
  {
    key: "ignore_public_acls",
    label: "IgnorePublicAcls",
    description: "Ignores any existing ACLs that grant public permissions on objects.",
  },
  {
    key: "block_public_policy",
    label: "BlockPublicPolicy",
    description: "Prevents bucket policies that grant public access from being set.",
  },
  {
    key: "restrict_public_buckets",
    label: "RestrictPublicBuckets",
    description: "Blocks access to buckets with public policies for all but the bucket owner.",
  },
];

const bucketFeaturePrimaryActionClass = cx(uiButtonBaseClass, uiButtonVariants.primary, "px-3 py-1");
const bucketFeatureSecondaryActionClass = cx(uiButtonBaseClass, uiButtonVariants.secondary, "px-3 py-1");
const bucketFeatureDangerActionClass = cx(
  uiButtonBaseClass,
  "border border-rose-200 px-3 py-1 text-rose-700 hover:border-rose-400 hover:text-rose-800 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800",
);
const bucketFeatureInputClass = cx(uiInputClass, "px-2 py-1 ui-body");
const bucketFeatureJsonInputClass = cx(uiInputClass, "px-3 py-2 font-mono ui-caption");
const bucketFeatureLabelClass =
  "flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200";
const bucketDetailHintClass = "ui-caption text-slate-500 dark:text-slate-400";
const bucketDetailTwoColumnGridClass = "grid gap-3 md:grid-cols-2";
const bucketDetailTableHeaderClass =
  "px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const bucketDetailWideTableHeaderClass =
  "px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
const bucketDetailTableCellClass =
  "px-4 py-2 text-slate-600 dark:text-slate-300";
const bucketDetailCompactCellClass =
  "px-3 py-1.5 text-slate-700 dark:text-slate-200";
const bucketDetailCompactStackClass = "space-y-2";
const bucketDetailDividerClass =
  "divide-y divide-slate-200 dark:divide-slate-800";
const bucketDetailEndActionClass = "mt-2 flex justify-end";
const bucketDetailFieldStackClass = "flex flex-col gap-1";
const bucketDetailInlineActionsClass = "flex gap-2";
const bucketDetailMutedBodyClass =
  "ui-caption text-slate-600 dark:text-slate-300";
const bucketDetailMutedTitleClass =
  "ui-caption font-semibold text-slate-700 dark:text-slate-100";
const bucketDetailSectionStackClass = "space-y-4";
const bucketDetailStackClass = "space-y-3";
const bucketDetailTableButtonCellClass = "px-3 py-2 text-left";
const bucketDetailTextActionClass =
  "ui-caption font-semibold text-primary hover:text-primary-600 disabled:opacity-60";
const bucketDetailTightStackClass = "space-y-1";
const bucketDetailWrapActionsClass = "flex flex-wrap gap-2";

const defaultLifecycleJsonExample = `[
  {
    "ID": "expire-logs",
    "Status": "Enabled",
    "Filter": { "Prefix": "logs/" },
    "Expiration": { "Days": 30 }
  }
]`;
const defaultReplicationJsonExample = `{
  "Role": "arn:aws:iam::123456789012:role/replication-role",
  "Rules": [
    {
      "ID": "rule-1",
      "Status": "Enabled",
      "Priority": 1,
      "Filter": { "Prefix": "logs/" },
      "Destination": { "Bucket": "arn:aws:s3:::target-bucket" },
      "DeleteMarkerReplication": { "Status": "Disabled" }
    }
  ]
}`;
const defaultWebsiteRoutingRulesExample = `[
  {
    "Condition": { "KeyPrefixEquals": "docs/" },
    "Redirect": { "ReplaceKeyPrefixWith": "documents/" }
  },
  {
    "Condition": { "HttpErrorCodeReturnedEquals": "404" },
    "Redirect": { "ReplaceKeyWith": "error.html" }
  }
]`;

type BucketDetailPageProps = {
  mode?: BucketDetailMode;
  bucketNameOverride?: string;
  accountIdOverride?: string | null;
  hideQuotaTab?: boolean;
  embedded?: boolean;
  hideObjectsTab?: boolean;
  bucketListPathOverride?: string;
  onBackToBuckets?: () => void;
};

type BucketDetailPageContentProps = BucketDetailPageProps & {
  activeTab: BucketDetailTabId;
  cephAdminEndpoint: ReturnType<typeof useCephAdminEndpoint>;
  onActiveTabChange: (tab: BucketDetailTabId) => void;
  routeBucketName?: string;
  s3AccountContext: ReturnType<typeof useS3AccountContext>;
};

export default function BucketDetailPage(props: BucketDetailPageProps) {
  const [activeTab, setActiveTab] = useState<BucketDetailTabId>("overview");
  const params = useParams<{ bucketName: string }>();
  const s3AccountContext = useS3AccountContext();
  const cephAdminEndpoint = useCephAdminEndpoint();
  const bucketName = props.bucketNameOverride ?? params.bucketName;
  const contextKey = JSON.stringify([
    props.mode ?? "manager",
    bucketName ?? null,
    props.accountIdOverride ?? null,
    s3AccountContext.accountIdForApi ?? null,
    s3AccountContext.selectedS3AccountId ?? null,
    s3AccountContext.requiresS3AccountSelection
      ? null
      : (s3AccountContext.accounts[0]?.id ?? null),
    s3AccountContext.accessMode,
    cephAdminEndpoint.selectedEndpointId ?? null,
  ]);

  return (
    <BucketDetailPageContent
      key={contextKey}
      {...props}
      activeTab={activeTab}
      cephAdminEndpoint={cephAdminEndpoint}
      onActiveTabChange={setActiveTab}
      routeBucketName={params.bucketName}
      s3AccountContext={s3AccountContext}
    />
  );
}

function BucketDetailPageContent({
  mode = "manager",
  bucketNameOverride,
  accountIdOverride = null,
  hideQuotaTab = false,
  embedded = false,
  hideObjectsTab = false,
  bucketListPathOverride,
  onBackToBuckets,
  activeTab,
  cephAdminEndpoint,
  onActiveTabChange,
  routeBucketName,
  s3AccountContext,
}: BucketDetailPageContentProps) {
  const bucketName = bucketNameOverride ?? routeBucketName;
  const isCephAdmin = mode === "ceph-admin";
  const {
    accounts,
    selectedS3AccountId,
    accountIdForApi,
    requiresS3AccountSelection,
    managerBucketQuotaEnabled,
  } = s3AccountContext;
  const { selectedEndpointId, selectedEndpoint } = cephAdminEndpoint;
  const [showNotificationExample, setShowNotificationExample] = useState(false);
  const [showWebsiteRulesExample, setShowWebsiteRulesExample] = useState(false);
  const [showEncryptionExample, setShowEncryptionExample] = useState(false);
  const [showLifecycleJsonExample, setShowLifecycleJsonExample] = useState(false);
  const [showReplicationExample, setShowReplicationExample] = useState(false);
  const [pendingConfigurationDelete, setPendingConfigurationDelete] = useState<BucketConfigurationDeleteKind | null>(null);

  const [showPolicyExample, setShowPolicyExample] = useState(false);
  const [showCorsExample, setShowCorsExample] = useState(false);
  const selectedS3Account = useMemo(() => {
    if (isCephAdmin) return null;
    if (accountIdOverride) {
      return accounts.find((account) => account.id === accountIdOverride) ?? null;
    }
    if (selectedS3AccountId) {
      return accounts.find((account) => account.id === selectedS3AccountId) ?? null;
    }
    if (!requiresS3AccountSelection && accounts.length > 0) {
      return accounts[0];
    }
    return null;
  }, [accountIdOverride, accounts, isCephAdmin, requiresS3AccountSelection, selectedS3AccountId]);
  const isCephEndpoint = isCephAdmin || selectedS3Account?.endpoint_provider === "ceph";
  const accountId = accountIdOverride ?? accountIdForApi ?? null;
  const hasAccountContext = !requiresS3AccountSelection || accountId !== null;
  const endpointId = selectedEndpointId ?? null;
  const hasCephContext = Boolean(endpointId);
  const hasContext = isCephAdmin ? hasCephContext : hasAccountContext;
  const {
    dirty: versioningDirty,
    draftEnabled: versioningDraftEnabled,
    isEnabled: versioningIsEnabled,
    isSuspended: versioningIsSuspended,
    load: loadVersioning,
    loadError: versioningLoadError,
    loading: versioningLoading,
    markEnabled: markVersioningEnabled,
    save: saveVersioning,
    saveError: versioningSaveError,
    saving: updatingVersioning,
    status: versioningStatus,
    updateDraft: updateVersioningDraft,
  } = useBucketVersioningController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    configured: policyConfigured,
    deleting: deletingPolicy,
    dirty: policyDirty,
    error: policyError,
    load: loadPolicy,
    loading: policyLoading,
    remove: removePolicy,
    save: savePolicy,
    saving: savingPolicy,
    setText: setPolicyText,
    text: policyText,
  } = useBucketPolicyController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const policyExample = buildPolicyExample(bucketName);
  const {
    configured: corsConfigured,
    deleting: deletingCors,
    dirty: corsDirty,
    error: corsError,
    load: loadCors,
    loading: corsLoading,
    remove: removeCors,
    save: saveCors,
    saving: savingCors,
    setText: setCorsText,
    text: corsText,
  } = useBucketCorsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    clear: clearAccessLogging,
    clearing: clearingAccessLogging,
    configured: accessLoggingConfigured,
    dirty: accessLoggingDirty,
    error: accessLoggingError,
    load: loadAccessLogging,
    loading: accessLoggingLoading,
    loggingEnabled: accessLoggingEnabled,
    save: saveAccessLogging,
    saving: savingAccessLogging,
    status: accessLoggingStatus,
    targetBucket: accessLoggingTargetBucket,
    targetPrefix: accessLoggingTargetPrefix,
    updateEnabled: updateAccessLoggingEnabled,
    updateTargetBucket: updateAccessLoggingTargetBucket,
    updateTargetPrefix: updateAccessLoggingTargetPrefix,
  } = useBucketAccessLoggingController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    clear: clearNotifications,
    clearing: clearingNotifications,
    configured: notificationsConfigured,
    dirty: notificationsDirty,
    error: notificationsError,
    load: loadNotifications,
    loading: notificationsLoading,
    save: saveNotifications,
    saving: savingNotifications,
    status: notificationsStatus,
    text: notificationText,
    updateText: updateNotificationText,
  } = useBucketNotificationsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    config: publicAccessBlock,
    dirty: publicAccessDirty,
    error: publicAccessError,
    fullyEnabled: publicAccessBlockEnabled,
    load: loadPublicAccessBlock,
    loading: publicAccessLoading,
    partiallyEnabled: publicAccessBlockPartial,
    save: savePublicAccessBlock,
    saving: savingPublicAccess,
    status: publicAccessStatus,
    update: updatePublicAccessField,
  } = useBucketPublicAccessController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    acl: bucketAcl,
    configured: aclConfigured,
    custom: bucketAclCustom,
    dirty: aclDirty,
    error: bucketAclError,
    load: loadBucketAcl,
    loading: bucketAclLoading,
    preset: bucketAclPreset,
    save: saveBucketAcl,
    saving: savingBucketAcl,
    status: bucketAclStatus,
    updateCustom: updateBucketAclCustom,
    updatePreset: updateBucketAclPreset,
  } = useBucketAclController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    active: objectLockActive,
    configuration: objectLockConfig,
    days: objectLockDays,
    dirty: objectLockDirty,
    enabled: objectLockEnabled,
    error: objectLockError,
    load: loadObjectLock,
    loadError: objectLockLoadError,
    loading: objectLockLoading,
    mode: objectLockMode,
    persistentlyEnabled: objectLockPersistentlyEnabled,
    reset: resetObjectLock,
    save: saveObjectLock,
    saving: savingObjectLock,
    status: objectLockStatus,
    updateDays: updateObjectLockDays,
    updateEnabled: updateObjectLockEnabled,
    updateMode: updateObjectLockMode,
    updateYears: updateObjectLockYears,
    years: objectLockYears,
  } = useBucketObjectLockController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
    onVersioningEnabled: markVersioningEnabled,
    versioningEnabled: versioningIsEnabled,
  });
  const {
    add: addBucketTag,
    clear: clearBucketTags,
    clearing: deletingBucketTags,
    configured: bucketTagsConfigured,
    dirty: tagsDirty,
    error: bucketTagsError,
    load: loadBucketTags,
    loading: bucketTagsLoading,
    remove: removeBucketTag,
    save: saveBucketTags,
    saving: savingBucketTags,
    status: bucketTagsStatus,
    tags: bucketTags,
    update: updateBucketTag,
  } = useBucketTagsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const quotaFeatureEnabled = isCephAdmin ? isCephEndpoint : Boolean(isCephEndpoint && managerBucketQuotaEnabled);
  const showQuotaTab = !hideQuotaTab && (isCephAdmin || Boolean(quotaFeatureEnabled && hasAccountContext));
  const showObjectsTab = !hideObjectsTab;
  const availableTabs = useMemo(() => {
    return resolveBucketDetailTabs({ mode, showObjectsTab, showQuotaTab });
  }, [mode, showObjectsTab, showQuotaTab]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      onActiveTabChange(availableTabs[0] ?? "overview");
    }
  }, [activeTab, availableTabs, onActiveTabChange]);
  const staticWebsiteEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.static_website === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.static_website === true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const {
    clear: clearWebsite,
    clearing: clearingWebsite,
    configured: websiteConfigured,
    dirty: websiteDirty,
    error: websiteError,
    errorDocument: websiteErrorDocument,
    indexDocument: websiteIndexDocument,
    load: loadWebsite,
    loading: websiteLoading,
    mode: websiteMode,
    redirectHost: websiteRedirectHost,
    redirectProtocol: websiteRedirectProtocol,
    routingRules: websiteRoutingRules,
    save: saveWebsite,
    saving: savingWebsite,
    status: websiteStatus,
    updateErrorDocument: updateWebsiteErrorDocument,
    updateIndexDocument: updateWebsiteIndexDocument,
    updateMode: updateWebsiteMode,
    updateRedirectHost: updateWebsiteRedirectHost,
    updateRedirectProtocol: updateWebsiteRedirectProtocol,
    updateRoutingRules: updateWebsiteRoutingRules,
  } = useBucketWebsiteController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && staticWebsiteEnabled,
    endpointId,
  });
  const sseFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.sse === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.sse === true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const {
    clearStatus: clearEncryptionStatus,
    configured: encryptionConfigured,
    deleting: deletingEncryption,
    dirty: encryptionDirty,
    error: encryptionError,
    load: loadEncryption,
    loading: encryptionLoading,
    remove: clearEncryption,
    save: saveEncryption,
    saving: savingEncryption,
    setText: setEncryptionText,
    status: encryptionStatus,
    text: encryptionText,
  } = useBucketEncryptionController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && sseFeatureEnabled,
    endpointId,
  });
  const {
    addCleanupExample: addLifecycleCleanupExample,
    addExpirationExample: addLifecycleExpirationExample,
    addTransitionExample: addLifecycleTransitionExample,
    deleteRule: deleteLifecycleRule,
    dirty: lifecycleDirty,
    editorVisible: showLifecycleEditor,
    error: lifecycleError,
    expirationDraft: lifecycleExpirationDraft,
    hasRules: hasLifecycleRules,
    load: loadLifecycle,
    loading: lifecycleLoading,
    mode: lifecycleMode,
    ruleCount: lifecycleRuleCount,
    rules: lifecycleRules,
    save: saveLifecycle,
    saving: savingLifecycle,
    status: lifecycleStatus,
    text: lifecycleText,
    toggleEditor: toggleLifecycleEditor,
    toggleRuleStatus: toggleLifecycleRuleStatus,
    transitionDraft: lifecycleTransitionDraft,
    updateExpirationDraft: updateLifecycleExpirationDraft,
    updateMode: updateLifecycleMode,
    updateText: updateLifecycleText,
    updateTransitionDraft: updateLifecycleTransitionDraft,
    warning: simpleLifecycleWarning,
  } = useBucketLifecycleController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    error: usageStatsError,
    load: loadUsageStats,
    loading: usageStatsLoading,
    recalculate: recalculateUsageStats,
    recalculating: usageStatsRecalculating,
    snapshot: usageStatsSnapshot,
  } = useBucketUsageStatsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const {
    currentPrefix,
    error: objectsError,
    loading: objectsLoading,
    openPrefix: openObjectsPrefix,
    parentPrefix,
    prefixes,
    refresh: refreshObjects,
    rows: objectRows,
  } = useBucketObjectsController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
  });
  const snsFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.sns === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.sns !== false;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const replicationFeatureEnabled = useMemo(() => {
    if (!isCephEndpoint) return false;
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.replication === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.replication === true;
  }, [isCephAdmin, isCephEndpoint, selectedEndpoint, selectedS3Account]);
  const {
    addRule: addReplicationRule,
    busy: replicationBusy,
    clear: clearReplication,
    clearing: clearingReplication,
    configured: replicationConfigured,
    dirty: replicationDirty,
    error: replicationError,
    hasUnsupportedZone: replicationHasUnsupportedZone,
    load: loadReplication,
    loading: replicationLoading,
    mode: replicationMode,
    removeRule: removeReplicationRule,
    role: replicationRole,
    rules: replicationRules,
    save: saveReplication,
    saving: savingReplication,
    status: replicationStatus,
    text: replicationText,
    updateMode: updateReplicationMode,
    updateRole: updateReplicationRole,
    updateRule: updateReplicationRule,
    updateText: updateReplicationText,
    warning: replicationWarning,
  } = useBucketReplicationController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext && isCephEndpoint && replicationFeatureEnabled,
    endpointId,
  });
  const usageFeatureEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.metrics ?? true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.metrics ?? true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const canViewBucketMetrics = hasContext;
  const canViewLiveBucketMetrics = Boolean(isCephEndpoint && usageFeatureEnabled);
  const staticWebsiteBlocked = !staticWebsiteEnabled;
  const exampleS3AccountId = selectedS3Account?.rgw_account_id || "ACCOUNT00000000000000001";

  useEffect(() => {
    if (activeTab === "metrics" && !canViewBucketMetrics) {
      onActiveTabChange("overview");
    }
  }, [activeTab, canViewBucketMetrics, onActiveTabChange]);
  const notificationExample = buildNotificationExample(exampleS3AccountId);
  const userRole = getUserRole();
  const isAdmin = isAdminLikeRole(userRole);
  const canEditQuota =
    quotaFeatureEnabled &&
    ((isCephAdmin && isAdmin && hasCephContext) || (!isCephAdmin && hasAccountContext));
  const quotaSectionRestricted = quotaFeatureEnabled && !canEditQuota;
  const versioningDisableBlocked = objectLockActive && versioningIsEnabled;
  const objectLockFormId = "bucket-object-lock-form";
  const quotaFormId = "bucket-quota-form";

  const {
    bucket,
    error: bucketError,
    loading: loadingBucket,
    refresh: refreshBucketMeta,
  } = useBucketMetadataController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    enabled: hasContext,
    endpointId,
    withStats: usageFeatureEnabled,
  });

  const {
    configured: quotaConfigured,
    dirty: quotaDirty,
    error: quotaError,
    maxObjects: quotaObjects,
    maxSize: quotaSizeGb,
    save: saveQuota,
    saving: updatingQuota,
    status: quotaStatus,
    unit: quotaSizeUnit,
    updateMaxObjects: updateQuotaObjects,
    updateMaxSize: updateQuotaSize,
    updateUnit: updateQuotaSizeUnit,
  } = useBucketQuotaController({
    accountId,
    bucketName,
    cephAdmin: isCephAdmin,
    editable: canEditQuota,
    enabled: quotaFeatureEnabled,
    endpointId,
    maxObjects: bucket?.quota_max_objects,
    maxSizeBytes: bucket?.quota_max_size_bytes,
    onSaved: refreshBucketMeta,
  });

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === "overview") {
      await Promise.all([
        refreshBucketMeta(),
        loadVersioning(),
        loadObjectLock(),
        loadLifecycle(),
        loadPolicy(),
        loadBucketAcl(),
        loadCors(),
        loadReplication(),
        loadEncryption(),
        loadPublicAccessBlock(),
        loadWebsite(),
        loadAccessLogging(),
        loadNotifications(),
      ]);
      return;
    }
    if (activeTab === "metrics") {
      if (!canViewBucketMetrics) return;
      await refreshBucketMeta();
      return;
    }
    if (activeTab === "objects") {
      await refreshObjects();
      return;
    }
    if (activeTab === "usage-stats") {
      await loadUsageStats();
      return;
    }
    if (activeTab === "properties") {
      await Promise.all([loadVersioning(), loadObjectLock(), loadLifecycle(), loadBucketTags(), loadEncryption()]);
      return;
    }
    if (activeTab === "permissions") {
      await Promise.all([loadPublicAccessBlock(), loadBucketAcl(), loadPolicy()]);
      return;
    }
    if (activeTab === "advanced") {
      await Promise.all([loadWebsite(), loadCors(), loadReplication(), loadAccessLogging(), loadNotifications()]);
      return;
    }
    if (activeTab === "ceph") {
      await Promise.all([refreshBucketMeta(), loadVersioning(), loadObjectLock()]);
    }
  }, [
    activeTab,
    canViewBucketMetrics,
    loadAccessLogging,
    loadBucketAcl,
    loadBucketTags,
    loadCors,
    loadEncryption,
    loadLifecycle,
    loadUsageStats,
    loadNotifications,
    loadObjectLock,
    loadPolicy,
    loadPublicAccessBlock,
    loadReplication,
    loadVersioning,
    loadWebsite,
    refreshObjects,
    refreshBucketMeta,
  ]);

  useEffect(() => {
    if (!hasContext) return;
    void refreshActiveTab();
  }, [hasContext, refreshActiveTab]);

  const activeTabLoading = useMemo(() => {
    if (activeTab === "overview") {
      return (
        loadingBucket ||
        versioningLoading ||
        objectLockLoading ||
        lifecycleLoading ||
        policyLoading ||
        bucketAclLoading ||
        corsLoading ||
        replicationLoading ||
        encryptionLoading ||
        publicAccessLoading
      );
    }
    if (activeTab === "metrics") {
      return loadingBucket;
    }
    if (activeTab === "objects") {
      return objectsLoading;
    }
    if (activeTab === "usage-stats") {
      return usageStatsLoading || usageStatsRecalculating;
    }
    if (activeTab === "properties") {
      return versioningLoading || objectLockLoading || lifecycleLoading || bucketTagsLoading || encryptionLoading;
    }
    if (activeTab === "permissions") {
      return publicAccessLoading || bucketAclLoading || policyLoading;
    }
    if (activeTab === "advanced") {
      return websiteLoading || corsLoading || replicationLoading || accessLoggingLoading || notificationsLoading;
    }
    if (activeTab === "ceph") {
      return loadingBucket || versioningLoading || objectLockLoading;
    }
    return false;
  }, [
    accessLoggingLoading,
    activeTab,
    bucketAclLoading,
    bucketTagsLoading,
    corsLoading,
    encryptionLoading,
    lifecycleLoading,
    loadingBucket,
    notificationsLoading,
    objectLockLoading,
    objectsLoading,
    policyLoading,
    publicAccessLoading,
    replicationLoading,
    usageStatsLoading,
    usageStatsRecalculating,
    versioningLoading,
    websiteLoading,
  ]);

  const canRefreshActiveTab = useMemo(() => {
    if (activeTab === "metrics") {
      return hasContext && canViewBucketMetrics;
    }
    if (activeTab === "objects") {
      return hasContext;
    }
    return hasContext;
  }, [activeTab, canViewBucketMetrics, hasContext]);

  const storageUsage = useMemo(
    () => ({
      used: bucket?.used_bytes ?? null,
      quota: bucket?.quota_max_size_bytes ?? null,
    }),
    [bucket]
  );

  const objectUsage = useMemo(
    () => ({
      used: bucket?.object_count ?? null,
      quota: bucket?.quota_max_objects ?? null,
    }),
    [bucket]
  );
  const bucketOwner = useMemo(() => {
    const ownerFromBucket = (bucket?.owner ?? "").trim();
    if (ownerFromBucket) return ownerFromBucket;
    const ownerFromAcl = (bucketAcl?.owner ?? "").trim();
    if (ownerFromAcl) return ownerFromAcl;
    return null;
  }, [bucket?.owner, bucketAcl?.owner]);

  const replicationBlocked = !replicationFeatureEnabled;
  const versioningNotImplemented = isApiFeatureNotImplemented(versioningLoadError);
  const objectLockNotImplemented = isApiFeatureNotImplemented(objectLockLoadError);
  const lifecycleNotImplemented = isApiFeatureNotImplemented(lifecycleError);
  const tagsNotImplemented = isApiFeatureNotImplemented(bucketTagsError);
  const publicAccessNotImplemented = isApiFeatureNotImplemented(publicAccessError);
  const aclNotImplemented = isApiFeatureNotImplemented(bucketAclError);
  const policyNotImplemented = isApiFeatureNotImplemented(policyError);
  const corsNotImplemented = isApiFeatureNotImplemented(corsError);
  const encryptionNotImplemented = isApiFeatureNotImplemented(encryptionError);
  const websiteNotImplemented = isApiFeatureNotImplemented(websiteError);
  const replicationNotImplemented = isApiFeatureNotImplemented(replicationError);
  const accessLoggingNotImplemented = isApiFeatureNotImplemented(accessLoggingError);
  const notificationsNotImplemented = isApiFeatureNotImplemented(notificationsError);
  const versioningCardState = resolveFeatureVisualState({
    disabled: versioningNotImplemented,
    configured: versioningIsEnabled,
    unsaved: versioningDirty,
  });
  const encryptionCardState = resolveFeatureVisualState({
    disabled: !sseFeatureEnabled || encryptionNotImplemented,
    configured: encryptionConfigured,
    unsaved: encryptionDirty,
  });
  const objectLockCardState = resolveFeatureVisualState({
    disabled: objectLockNotImplemented,
    configured: objectLockPersistentlyEnabled,
    unsaved: objectLockDirty,
  });
  const lifecycleCardState = resolveFeatureVisualState({
    disabled: lifecycleNotImplemented,
    configured: hasLifecycleRules,
    unsaved: lifecycleDirty,
  });
  const tagsCardState = resolveFeatureVisualState({
    disabled: tagsNotImplemented,
    configured: bucketTagsConfigured,
    unsaved: tagsDirty,
  });
  const publicAccessCardState = resolveFeatureVisualState({
    disabled: publicAccessNotImplemented,
    configured: publicAccessBlockEnabled || publicAccessBlockPartial,
    unsaved: publicAccessDirty,
  });
  const aclCardState = resolveFeatureVisualState({
    disabled: aclNotImplemented,
    configured: aclConfigured,
    unsaved: aclDirty,
  });
  const policyCardState = resolveFeatureVisualState({
    disabled: policyNotImplemented,
    configured: policyConfigured,
    unsaved: policyDirty,
  });
  const websiteCardState = resolveFeatureVisualState({
    disabled: staticWebsiteBlocked || websiteNotImplemented,
    configured: websiteConfigured,
    unsaved: websiteDirty,
  });
  const replicationCardState = resolveFeatureVisualState({
    disabled: replicationBlocked || replicationNotImplemented,
    configured: replicationConfigured,
    unsaved: replicationDirty,
  });
  const corsCardState = resolveFeatureVisualState({
    disabled: corsNotImplemented,
    configured: corsConfigured,
    unsaved: corsDirty,
  });
  const accessLoggingCardState = resolveFeatureVisualState({
    disabled: accessLoggingNotImplemented,
    configured: accessLoggingConfigured,
    unsaved: accessLoggingDirty,
  });
  const notificationsCardState = resolveFeatureVisualState({
    disabled: notificationsNotImplemented,
    configured: notificationsConfigured,
    unsaved: notificationsDirty,
  });
  const quotaCardState = resolveFeatureVisualState({
    disabled: !quotaFeatureEnabled || quotaSectionRestricted,
    configured: quotaConfigured,
    unsaved: quotaDirty,
  });

  const propertySummary = useMemo<PropertySummary[]>(() => {
    const versioningState = versioningLoading
      ? "Loading..."
      : versioningLoadError
        ? "Unavailable"
        : versioningStatus ?? "Disabled";
    const versioningNormalized = String(versioningState || "").trim().toLowerCase();
    const versioningTone: PropertySummary["tone"] =
      versioningLoading || versioningLoadError
        ? "unknown"
        : versioningIsEnabled
          ? "active"
          : versioningNormalized === "suspended"
            ? "unknown"
            : "inactive";

    const hasObjectLockData = !(objectLockLoading || objectLockLoadError);
    let objectLockState = "Disabled";
    let objectLockTone: PropertySummary["tone"] = "inactive";
    if (!hasObjectLockData) {
      objectLockState = objectLockLoading ? "Loading..." : "Unavailable";
      objectLockTone = "unknown";
    } else if (objectLockPersistentlyEnabled) {
      objectLockState = "Enabled";
      objectLockTone = "active";
    } else {
      objectLockState = "Disabled";
      objectLockTone = "inactive";
    }

    const lifecycleState = lifecycleLoading
      ? "Loading..."
      : lifecycleError
        ? "Unavailable"
        : hasLifecycleRules
          ? "Enabled"
          : "Disabled";
    const lifecycleTone: PropertySummary["tone"] = lifecycleLoading
      ? "unknown"
      : hasLifecycleRules
        ? "active"
        : lifecycleError
          ? "unknown"
          : "inactive";

    const quotaState = bucket ? (quotaConfigured ? "Configured" : "Not set") : "Unknown";
    const quotaTone: PropertySummary["tone"] =
      !bucket || quotaState === "Unknown" ? "unknown" : quotaConfigured ? "active" : "inactive";

    const policyState = policyLoading
      ? "Loading..."
      : policyError
        ? "Unavailable"
        : policyConfigured
          ? "Configured"
          : "Not set";
    const policyTone: PropertySummary["tone"] =
      policyLoading || policyError ? "unknown" : policyConfigured ? "active" : "inactive";

    const corsState = corsLoading
      ? "Loading..."
      : corsError
        ? "Unavailable"
        : corsConfigured
          ? "Configured"
          : "Not set";
    const corsTone: PropertySummary["tone"] = corsLoading || corsError ? "unknown" : corsConfigured ? "active" : "inactive";

    const encryptionState = !sseFeatureEnabled
      ? "Unavailable"
      : encryptionLoading
        ? "Loading..."
        : encryptionError
          ? "Unavailable"
          : encryptionConfigured
            ? "Enabled"
            : "Disabled";
    const encryptionTone: PropertySummary["tone"] = !sseFeatureEnabled
      ? "unknown"
      : encryptionLoading || encryptionError
        ? "unknown"
        : encryptionConfigured
          ? "active"
          : "inactive";

    const accessLoggingState = accessLoggingLoading
      ? "Loading..."
      : accessLoggingError
        ? "Unavailable"
        : accessLoggingConfigured
          ? "Enabled"
          : "Disabled";
    const accessLoggingTone: PropertySummary["tone"] =
      accessLoggingLoading || accessLoggingError ? "unknown" : accessLoggingConfigured ? "active" : "inactive";

    const notificationsState = notificationsLoading
      ? "Loading..."
      : notificationsError
        ? "Unavailable"
        : notificationsConfigured
          ? "Configured"
          : "Not set";
    const notificationsTone: PropertySummary["tone"] =
      notificationsLoading || notificationsError ? "unknown" : notificationsConfigured ? "active" : "inactive";

    const replicationState = !isCephEndpoint || !replicationFeatureEnabled
      ? "Unavailable"
      : replicationLoading
        ? "Loading..."
        : replicationError
          ? "Unavailable"
          : replicationConfigured
            ? "Configured"
            : "Not set";
    const replicationTone: PropertySummary["tone"] = !isCephEndpoint || !replicationFeatureEnabled
      ? "unknown"
      : replicationLoading || replicationError
        ? "unknown"
        : replicationConfigured
          ? "active"
          : "inactive";

    const websiteState = !staticWebsiteEnabled
      ? "Unavailable"
      : websiteLoading
        ? "Loading..."
        : websiteError
          ? "Unavailable"
          : websiteConfigured
            ? "Enabled"
            : "Disabled";
    const websiteTone: PropertySummary["tone"] = !staticWebsiteEnabled
      ? "unknown"
      : websiteLoading || websiteError
        ? "unknown"
        : websiteConfigured
          ? "active"
          : "inactive";

    const publicAccessState = publicAccessLoading
      ? "Loading..."
      : publicAccessError
        ? "Unavailable"
        : publicAccessBlockEnabled
          ? "Enabled"
          : publicAccessBlockPartial
            ? "Partial"
            : "Disabled";
    const publicAccessTone: PropertySummary["tone"] =
      publicAccessLoading || publicAccessError ? "unknown" : publicAccessBlockEnabled || publicAccessBlockPartial ? "active" : "inactive";

    const summary: PropertySummary[] = [
      { label: "Versioning", state: versioningState, tone: versioningTone },
      { label: "Object Lock", state: objectLockState, tone: objectLockTone },
      { label: "Block public access", state: publicAccessState, tone: publicAccessTone },
      { label: "Lifecycle rules", state: lifecycleState, tone: lifecycleTone },
    ];
    if (staticWebsiteEnabled) {
      summary.push({ label: "Static website", state: websiteState, tone: websiteTone });
    }
    if (quotaFeatureEnabled) {
      summary.push({ label: "Quota", state: quotaState, tone: quotaTone });
    }
    summary.push({ label: "Bucket policy", state: policyState, tone: policyTone });
    summary.push({ label: "CORS", state: corsState, tone: corsTone });
    if (sseFeatureEnabled) {
      summary.push({ label: "Server-side encryption", state: encryptionState, tone: encryptionTone });
    }
    summary.push({ label: "Access logging", state: accessLoggingState, tone: accessLoggingTone });
    if (snsFeatureEnabled) {
      summary.push({ label: "Notifications", state: notificationsState, tone: notificationsTone });
    }
    if (replicationFeatureEnabled) {
      summary.push({ label: "Replication", state: replicationState, tone: replicationTone });
    }

    return summary;
  }, [
    bucket,
    accessLoggingConfigured,
    accessLoggingError,
    accessLoggingLoading,
    encryptionConfigured,
    encryptionError,
    encryptionLoading,
    hasLifecycleRules,
    corsConfigured,
    corsError,
    corsLoading,
    lifecycleError,
    lifecycleLoading,
    notificationsConfigured,
    notificationsError,
    notificationsLoading,
    objectLockLoadError,
    objectLockLoading,
    objectLockPersistentlyEnabled,
    policyConfigured,
    policyError,
    policyLoading,
    quotaConfigured,
    quotaFeatureEnabled,
    publicAccessBlockEnabled,
    publicAccessBlockPartial,
    publicAccessError,
    publicAccessLoading,
    sseFeatureEnabled,
    versioningLoadError,
    versioningIsEnabled,
    versioningLoading,
    versioningStatus,
    isCephEndpoint,
    replicationConfigured,
    replicationError,
    replicationFeatureEnabled,
    replicationLoading,
    snsFeatureEnabled,
    staticWebsiteEnabled,
    websiteConfigured,
    websiteError,
    websiteLoading,
  ]);

  const basePath = useMemo(
    () => bucketListPathOverride ?? resolveBucketDetailSurface(mode).bucketListPath,
    [bucketListPathOverride, mode]
  );
  const breadcrumbs = useMemo(() => {
    const items = buildBucketDetailBreadcrumbs(mode, bucketName);
    return items.map((item, index) => (index === 1 ? { ...item, to: basePath } : item));
  }, [basePath, bucketName, mode]);

  const confirmPendingConfigurationDelete = async () => {
    if (!pendingConfigurationDelete) return;
    try {
      if (pendingConfigurationDelete === "cors") await removeCors();
      if (pendingConfigurationDelete === "encryption") await clearEncryption();
      if (pendingConfigurationDelete === "tags") await clearBucketTags();
      if (pendingConfigurationDelete === "notifications") await clearNotifications();
      if (pendingConfigurationDelete === "replication") await clearReplication();
      if (pendingConfigurationDelete === "website") await clearWebsite();
      if (pendingConfigurationDelete === "policy") await removePolicy();
      if (pendingConfigurationDelete === "access-logging") await clearAccessLogging();
    } finally {
      setPendingConfigurationDelete(null);
    }
  };

  const handleUpdateQuota = (e: React.FormEvent) => {
    e.preventDefault();
    void saveQuota();
  };

  const configurationDeleteLoading =
    pendingConfigurationDelete === "cors"
      ? deletingCors
      : pendingConfigurationDelete === "encryption"
        ? deletingEncryption
        : pendingConfigurationDelete === "tags"
          ? deletingBucketTags
          : pendingConfigurationDelete === "notifications"
            ? clearingNotifications
            : pendingConfigurationDelete === "replication"
              ? clearingReplication
              : pendingConfigurationDelete === "website"
                ? clearingWebsite
                : pendingConfigurationDelete === "policy"
                  ? deletingPolicy
                  : pendingConfigurationDelete === "access-logging"
                    ? clearingAccessLogging
                    : false;

  return (
    <div className={bucketDetailSectionStackClass}>
      {!embedded && (
        <PageHeader
          title={bucketName ?? "Bucket"}
          description={
            bucketError ||
            (isCephAdmin
              ? "Bucket configuration and permissions (Admin Ops + S3)."
              : "Bucket overview, objects, properties, permissions, metrics.")
          }
          breadcrumbs={breadcrumbs}
          actions={[
            onBackToBuckets
              ? { label: "← Back to buckets", onClick: onBackToBuckets, variant: "ghost" }
              : { label: "← Back to buckets", to: basePath, variant: "ghost" },
          ]}
        />
      )}

      {isCephAdmin && !endpointId && (
        <PageBanner tone="warning">Select a Ceph endpoint before managing this bucket.</PageBanner>
      )}

      {bucketError && <PageBanner tone="error">{bucketError}</PageBanner>}

      <PageTabs
        activeTab={activeTab}
        onChange={(id) => onActiveTabChange(id as BucketDetailTabId)}
        headerActions={
          <button
            type="button"
            onClick={refreshActiveTab}
            disabled={!canRefreshActiveTab || activeTabLoading}
            className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
          >
            {activeTabLoading ? "Loading..." : "Refresh"}
          </button>
        }
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <section className="space-y-4 px-1 py-2">
                <header className={bucketDetailTightStackClass}>
                  <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {bucketName ? `Bucket ${bucketName}` : "Bucket overview"}
                  </h3>
                  <p className={bucketDetailHintClass}>
                    Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{bucketOwner ?? (loadingBucket || bucketAclLoading ? "Loading..." : "Unknown")}</span>
                  </p>
                </header>
                <div className={bucketDetailTwoColumnGridClass}>
                  <UsageTile
                    label="Storage"
                    used={storageUsage.used}
                    quota={storageUsage.quota}
                    formatter={formatBytes}
                    quotaFormatter={formatBytes}
                    loading={loadingBucket}
                    emptyHint="No storage quota configured."
                  />
                  <UsageTile
                    label="Objects"
                    used={objectUsage.used}
                    quota={objectUsage.quota}
                    formatter={formatCompactNumber}
                    quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                    loading={loadingBucket}
                    unitHint="objects"
                    emptyHint="No object quota configured."
                  />
                </div>
                <div className="border-t border-[color:var(--ui-border-soft)] pt-4">
                  <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Bucket properties</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {propertySummary.map((item) => (
                      <PropertySummaryChip key={item.label} label={item.label} state={item.state} tone={item.tone} />
                    ))}
                  </div>
                </div>
              </section>
            ),
          },
          ...(showObjectsTab
            ? [
                {
                  id: "objects",
                  label: "Objects / S3 Console",
                  content: (
                    <SplitView
                      left={
                  <div className="p-3 space-y-2">
                    <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Prefixes</p>
                    <div className={bucketDetailTightStackClass}>
                      <button
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption ${
                          currentPrefix === ""
                            ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => openObjectsPrefix("")}
                      >
                        <span>(root)</span>
                      </button>
                      {parentPrefix !== "" && (
                        <button
                          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                          onClick={() => openObjectsPrefix(parentPrefix)}
                        >
                          <span>⬆️ Up</span>
                          <span className={bucketDetailHintClass}>{parentPrefix || "/"}</span>
                        </button>
                      )}
                      {prefixes.map((prefix) => {
                        const isActive = prefix === currentPrefix;
                        const displayName = prefix.replace(currentPrefix, "") || prefix;
                        return (
                          <button
                            key={prefix}
                            className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption ${
                              isActive
                                ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                            }`}
                            onClick={() => openObjectsPrefix(prefix)}
                          >
                            <span>{displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                }
                right={
                  <div className="space-y-3 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className={bucketDetailTightStackClass}>
                        <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Path</p>
                        <div className="ui-caption text-slate-500 dark:text-slate-300">
                          {bucketName}/{currentPrefix || "(root)"}
                        </div>
                        <div className={bucketDetailHintClass}>
                          {isCephAdmin
                            ? "Read-only preview using the selected endpoint's Ceph Admin credentials."
                            : "Read-only preview. Use the main Browser page for object operations."}
                        </div>
                      </div>
                      <div className={bucketDetailWrapActionsClass}>
                        <button
                          type="button"
                          onClick={() => void refreshObjects()}
                          disabled={objectsLoading}
                          className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Refresh
                        </button>
                      </div>
                    </div>
                    {objectsError && (
                      <UiInlineMessage tone="error">{objectsError}</UiInlineMessage>
                    )}

                    <div className={uiTableContainerClass}>
                      <table className={cx(uiDataTableClass, "min-w-full ui-body")}>
                        <thead>
                          <tr>
                            <th className={bucketDetailWideTableHeaderClass}>
                              Name
                            </th>
                            <th className={bucketDetailWideTableHeaderClass}>
                              Size
                            </th>
                            <th className={bucketDetailWideTableHeaderClass}>
                              Last modified
                            </th>
                            <th className={bucketDetailWideTableHeaderClass}>
                              Storage class
                            </th>
                          </tr>
                        </thead>
                        <tbody className={bucketDetailDividerClass}>
                          {objectsLoading && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                Loading objects...
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && objectRows.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                No objects in this prefix.
                              </td>
                            </tr>
                          )}
                          {!objectsLoading &&
                            objectRows.map((row) => {
                              if (row.type === "prefix") {
                                return (
                                  <tr
                                    key={row.key}
                                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    onClick={() => openObjectsPrefix(row.key)}
                                  >
                                    <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                      📁 {row.name}
                                    </td>
                                    <td className={bucketDetailTableCellClass}>—</td>
                                    <td className={bucketDetailTableCellClass}>—</td>
                                    <td className={bucketDetailTableCellClass}>—</td>
                                  </tr>
                                );
                              }
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">{row.name}</td>
                                  <td className={bucketDetailTableCellClass}>{formatBytes(row.object.size)}</td>
                                  <td className={bucketDetailTableCellClass}>
                                    {row.object.last_modified ? new Date(row.object.last_modified).toLocaleString() : "-"}
                                  </td>
                                  <td className={bucketDetailTableCellClass}>{row.object.storage_class ?? "-"}</td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                }
              />
            ),
          },
        ]
      : []),
          {
            id: "properties",
            label: "Properties",
            content: (
              <div className={bucketDetailSectionStackClass}>
                <div className={bucketDetailTwoColumnGridClass}>
                  <BucketFeatureCard
                    title="Versioning"
                    description="Enable or disable S3 object versioning."
                    mode="graphical"
                    visualState={versioningCardState}
                    testId="bucket-feature-versioning"
                    className="md:col-start-1"
                    actions={
                      <button
                        type="button"
                        onClick={() => void saveVersioning(versioningDisableBlocked)}
                        disabled={
                          updatingVersioning ||
                          versioningLoading ||
                          Boolean(versioningLoadError) ||
                          versioningDisableBlocked ||
                          !versioningDirty
                        }
                        title={versioningDisableBlocked ? "Disable Object Lock to change versioning." : undefined}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {updatingVersioning ? "Saving..." : "Save"}
                      </button>
                    }
                  >
                    <div className={bucketDetailCompactStackClass}>
                      {versioningLoading && (
                        <UiInlineMessage>Loading versioning...</UiInlineMessage>
                      )}
                      {versioningLoadError && (
                        <UiInlineMessage tone="error">{versioningLoadError}</UiInlineMessage>
                      )}
                      {versioningSaveError && (
                        <UiInlineMessage tone="error">{versioningSaveError}</UiInlineMessage>
                      )}
                      <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                        <div>
                          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Enable versioning</p>
                          <p className={bucketDetailHintClass}>
                            Keeps object history for restores and is required for Object Lock.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {versioningIsSuspended && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 ui-caption font-semibold text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/60 dark:text-amber-100">
                              Suspended
                            </span>
                          )}
                          <PortalSettingsSwitch
                            checked={versioningDraftEnabled}
                            disabled={updatingVersioning || versioningLoading || Boolean(versioningLoadError) || versioningDisableBlocked}
                            ariaLabel="Enable versioning"
                            onChange={updateVersioningDraft}
                          />
                        </div>
                      </div>
                    </div>
                    {versioningDisableBlocked && (
                      <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                        Versioning cannot be disabled while Object Lock is enabled.
                      </p>
                    )}
                  </BucketFeatureCard>
                  <BucketFeatureCard
                    title="Server-side encryption"
                    description="Bucket default encryption rules (S3 API Rules array)."
                    mode="json"
                    visualState={encryptionCardState}
                    testId="bucket-feature-encryption"
                    className="md:col-start-2 md:row-start-1 md:row-span-2 space-y-3"
                    actions={
                      <div className={bucketDetailInlineActionsClass}>
                        <button
                          type="button"
                          onClick={() => setPendingConfigurationDelete("encryption")}
                          disabled={!sseFeatureEnabled || encryptionNotImplemented || deletingEncryption || !encryptionConfigured}
                          className={bucketFeatureDangerActionClass}
                        >
                          {deletingEncryption ? "Disabling..." : "Disable"}
                        </button>
                        <button
                          type="button"
                          onClick={saveEncryption}
                          disabled={!sseFeatureEnabled || encryptionNotImplemented || savingEncryption || encryptionLoading}
                          className={bucketFeaturePrimaryActionClass}
                        >
                          {savingEncryption ? "Saving..." : "Save"}
                        </button>
                      </div>
                    }
                  >
                    {!sseFeatureEnabled && <EndpointFeatureDisabledNotice featureLabel="Server-side encryption" />}
                    {encryptionError && (
                      <UiInlineMessage tone="error">{encryptionError}</UiInlineMessage>
                    )}
                    {encryptionStatus && (
                      <UiInlineMessage tone="success">{encryptionStatus}</UiInlineMessage>
                    )}
                    <textarea
                      value={encryptionText}
                      onChange={(e) => {
                        setEncryptionText(e.target.value);
                        if (encryptionStatus) {
                          clearEncryptionStatus();
                        }
                      }}
                      className={cx(bucketFeatureJsonInputClass, "h-40 w-full")}
                      placeholder='[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]'
                      spellCheck={false}
                      disabled={!sseFeatureEnabled || encryptionNotImplemented || encryptionLoading || savingEncryption || deletingEncryption}
                    />
                    <BucketFeatureJsonExample
                      show={showEncryptionExample}
                      onToggle={() => setShowEncryptionExample((prev) => !prev)}
                      example={defaultEncryptionExample}
                      onUseExample={() => setEncryptionText(defaultEncryptionExample)}
                      disabled={!sseFeatureEnabled || encryptionNotImplemented}
                      helperText={
                        <span className={bucketDetailHintClass}>
                          Leave <code>Rules</code> empty to disable default encryption.
                        </span>
                      }
                    />
                  </BucketFeatureCard>
                  <BucketFeatureCard
                    title="Object Lock"
                    description="WORM / default retention."
                    mode="graphical"
                    visualState={objectLockCardState}
                    testId="bucket-feature-object-lock"
                    className="md:col-start-1 md:row-start-2"
                    actions={
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={resetObjectLock}
                          className={bucketFeatureSecondaryActionClass}
                          disabled={objectLockLoading || Boolean(objectLockLoadError) || savingObjectLock}
                        >
                          Reset
                        </button>
                        <button
                          type="submit"
                          form={objectLockFormId}
                          disabled={savingObjectLock || objectLockLoading || Boolean(objectLockLoadError)}
                          className={bucketFeaturePrimaryActionClass}
                        >
                          {savingObjectLock ? "Saving..." : "Save"}
                        </button>
                      </div>
                    }
                  >
                    <div className={bucketDetailCompactStackClass}>
                      {objectLockLoading && (
                        <UiInlineMessage>Loading Object Lock configuration...</UiInlineMessage>
                      )}
                      {objectLockLoadError && (
                        <UiInlineMessage tone="error">{objectLockLoadError}</UiInlineMessage>
                      )}
                      {objectLockError && (
                        <UiInlineMessage tone="error">{objectLockError}</UiInlineMessage>
                      )}
                      {objectLockStatus && (
                        <UiInlineMessage tone="success">{objectLockStatus}</UiInlineMessage>
                      )}
                      <form
                        id={objectLockFormId}
                        className={bucketDetailCompactStackClass}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveObjectLock();
                        }}
                      >
                        <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Enable Object Lock</p>
                            <p className={bucketDetailHintClass}>
                              Write-once retention controls for bucket objects.
                            </p>
                          </div>
                          <PortalSettingsSwitch
                            checked={objectLockEnabled ?? false}
                            disabled={objectLockPersistentlyEnabled || objectLockLoading || Boolean(objectLockLoadError) || objectLockNotImplemented}
                            ariaLabel="Enable object lock"
                            onChange={(checked) => {
                              if (objectLockPersistentlyEnabled) return;
                              updateObjectLockEnabled(checked);
                              if (checked) {
                                updateVersioningDraft(true);
                              }
                            }}
                          />
                        </div>
                        <p className={bucketDetailHintClass}>
                          Enabling Object Lock automatically enables bucket versioning.
                        </p>
                        {objectLockPersistentlyEnabled && (
                          <p className={bucketDetailHintClass}>
                            Object Lock cannot be disabled once it has been enabled on the bucket. Update only the default retention below.
                          </p>
                        )}
                        {objectLockActive && (
                          <UiInlineMessage tone="warning">
                            Warning: while Object Lock is enabled, objects cannot be deleted until the specified retention period ends. Review mode and retention before saving changes.
                          </UiInlineMessage>
                        )}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className={bucketFeatureLabelClass}>
                            Mode
                            <select
                              value={objectLockMode}
                              onChange={(e) => updateObjectLockMode(e.target.value)}
                              className={bucketFeatureInputClass}
                              disabled={objectLockNotImplemented}
                            >
                              <option value="">(none)</option>
                              <option value="GOVERNANCE">Governance</option>
                              <option value="COMPLIANCE">Compliance</option>
                            </select>
                          </label>
                          <label className={bucketFeatureLabelClass}>
                            Retention (days)
                            <input
                              type="number"
                              min={0}
                              step="1"
                              value={objectLockDays}
                              onChange={(e) => updateObjectLockDays(e.target.value)}
                              className={bucketFeatureInputClass}
                              placeholder="e.g. 30"
                              disabled={objectLockNotImplemented}
                            />
                          </label>
                          <label className={bucketFeatureLabelClass}>
                            Retention (years)
                            <input
                              type="number"
                              min={0}
                              step="1"
                              value={objectLockYears}
                              onChange={(e) => updateObjectLockYears(e.target.value)}
                              className={bucketFeatureInputClass}
                              placeholder="e.g. 1"
                              disabled={objectLockNotImplemented}
                            />
                          </label>
                        </div>
                        {objectLockConfig?.mode && (objectLockConfig.days != null || objectLockConfig.years != null) && (
                          <p className={bucketDetailMutedBodyClass}>
                            Current retention: {objectLockConfig.mode}
                            {objectLockConfig.days != null ? ` · ${objectLockConfig.days} day(s)` : ""}
                            {objectLockConfig.years != null ? ` · ${objectLockConfig.years} year(s)` : ""}
                          </p>
                        )}
                      </form>
                    </div>
                    <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                      Choose a mode plus days or years. Leave it empty to remove the default retention (Object Lock must already be enabled on the bucket).
                    </p>
                  </BucketFeatureCard>
                  <BucketFeatureCard
                      title="Lifecycle rules"
                      description="S3-side expiration/clean-up."
                      mode="hybrid"
                      visualState={lifecycleCardState}
                      testId="bucket-feature-lifecycle"
                      className="order-4 md:order-none md:col-span-2 md:col-start-1 md:row-start-3"
                      actions={
                        <div className="flex items-center gap-2">
                          <span className={bucketDetailHintClass}>{lifecycleRuleCount} rule(s)</span>
                          <button
                            type="button"
                            onClick={toggleLifecycleEditor}
                            className={bucketFeatureSecondaryActionClass}
                            disabled={lifecycleNotImplemented}
                          >
                            {showLifecycleEditor ? "Hide editor" : "Show editor"}
                          </button>
                          <button
                            type="button"
                            onClick={saveLifecycle}
                            disabled={
                              lifecycleNotImplemented ||
                              savingLifecycle ||
                              lifecycleLoading ||
                              lifecycleMode !== "json"
                            }
                            title={
                              lifecycleMode === "simple"
                                ? "Quick add actions save immediately."
                                : undefined
                            }
                            className={bucketFeaturePrimaryActionClass}
                          >
                            {savingLifecycle ? "Saving..." : "Save"}
                          </button>
                        </div>
                      }
                    >
                      {lifecycleLoading && (
                        <UiInlineMessage className="mt-2">Loading lifecycle rules...</UiInlineMessage>
                      )}
                      {lifecycleError && (
                        <UiInlineMessage tone="error" className="mt-2">{lifecycleError}</UiInlineMessage>
                      )}
                      {lifecycleStatus && (
                        <UiInlineMessage tone="success" className="mt-2">{lifecycleStatus}</UiInlineMessage>
                      )}
                      <div className={cx(uiCardMutedClass, "mt-3 px-3 py-2")}>
                        {lifecycleRules.length === 0 ? (
                          <p className={bucketDetailMutedBodyClass}>No rules configured on this bucket.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className={cx(uiDataTableClass, "min-w-full ui-caption")}>
                              <thead>
                                <tr>
                                  <th className={bucketDetailTableHeaderClass}>
                                    ID
                                  </th>
                                  <th className={bucketDetailTableHeaderClass}>
                                    Status
                                  </th>
                                  <th className={bucketDetailTableHeaderClass}>
                                    Filter
                                  </th>
                                  <th className={bucketDetailTableHeaderClass}>
                                    Actions
                                  </th>
                                  <th className={bucketDetailTableHeaderClass}>
                                    Manage
                                  </th>
                                </tr>
                              </thead>
                              <tbody className={bucketDetailDividerClass}>
                                {lifecycleRules.map((rawRule, idx) => {
                                  const rule = rawRule as LifecycleRuleRecord;
                                  const ruleId = lifecycleRuleId(rule);
                                  const filterLabel = lifecycleFilterLabel(rule.Filter);
                                  const status = lifecycleRuleStatus(rule);
                                  return (
                                    <tr
                                      key={`${ruleId ?? lifecycleRulePrefix(rule) ?? "rule"}-${idx}`}
                                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    >
                                      <td className="px-3 py-1.5 font-semibold text-slate-900 dark:text-slate-100">
                                        {ruleId ?? "(no ID)"}
                                      </td>
                                      <td className={bucketDetailCompactCellClass}>
                                        <button
                                          type="button"
                                          onClick={() => toggleLifecycleRuleStatus(idx)}
                                          className={`flex items-center gap-2 rounded-full px-3 py-1 ui-caption font-semibold ${
                                            status === "Disabled"
                                              ? "border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-200"
                                              : "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                                          }`}
                                          disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                        >
                                          {status}
                                        </button>
                                      </td>
                                      <td className={bucketDetailCompactCellClass}>{filterLabel}</td>
                                      <td className={bucketDetailCompactCellClass}>{describeLifecycleActions(rule)}</td>
                                      <td className={bucketDetailCompactCellClass}>
                                        <div className={bucketDetailWrapActionsClass}>
                                          <button
                                            type="button"
                                            onClick={() => deleteLifecycleRule(idx)}
                                            className="rounded border border-rose-200 px-2 py-1 ui-caption font-semibold text-rose-700 hover:border-rose-300 hover:text-rose-800 dark:border-rose-900/40 dark:text-rose-100"
                                            disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                          >
                                            Delete
                                          </button>
                                        </div>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>

                      {showLifecycleEditor && (
                        <>
                          <div className="mt-3">
                            <BucketFeatureModeToggle
                              value={lifecycleMode}
                              options={[
                                { value: "json", label: "JSON mode" },
                                { value: "simple", label: "Quick add" },
                              ]}
                              onChange={updateLifecycleMode}
                              disabled={lifecycleNotImplemented}
                            />
                          </div>
                          {lifecycleMode === "simple" ? (
                            <div className="mt-3 space-y-3">
                              {simpleLifecycleWarning && (
                                <UiInlineMessage tone="warning">{simpleLifecycleWarning}</UiInlineMessage>
                              )}
                              <p className={bucketDetailMutedBodyClass}>
                                Quickly add one of the preconfigured rules below (appended to the existing configuration).
                              </p>
                              <div className={bucketDetailStackClass}>
                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>
                                    Rule 1: noncurrent 90d + multipart 30d + delete markers (explicit)
                                  </p>
                                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                    Cleans noncurrent versions after 90d, removes incomplete multipart uploads after 30d, and deletes expired delete markers.
                                  </p>
                                  <div className={bucketDetailEndActionClass}>
                                    <button
                                      type="button"
                                      onClick={() => void addLifecycleCleanupExample()}
                                      className={bucketDetailTextActionClass}
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>Rule 2: current/noncurrent transitions</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className={bucketDetailFieldStackClass}>
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleTransitionDraft.currentDays}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            currentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleTransitionDraft.noncurrentDays}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            noncurrentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Storage class
                                      <input
                                        type="text"
                                        value={lifecycleTransitionDraft.storageClass}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            storageClass: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="GLACIER"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={lifecycleTransitionDraft.prefix}
                                        onChange={(e) =>
                                          updateLifecycleTransitionDraft({
                                            prefix: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="logs/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className={bucketDetailEndActionClass}>
                                    <button
                                      type="button"
                                      onClick={() => void addLifecycleTransitionExample()}
                                      className={bucketDetailTextActionClass}
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className={bucketDetailMutedTitleClass}>Rule 3: current/noncurrent expiration</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className={bucketDetailFieldStackClass}>
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleExpirationDraft.currentDays}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            currentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={lifecycleExpirationDraft.noncurrentDays}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            noncurrentDays: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className={bucketDetailFieldStackClass}>
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={lifecycleExpirationDraft.prefix}
                                        onChange={(e) =>
                                          updateLifecycleExpirationDraft({
                                            prefix: e.target.value,
                                          })
                                        }
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="archive/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className={bucketDetailEndActionClass}>
                                    <button
                                      type="button"
                                      onClick={() => void addLifecycleExpirationExample()}
                                      className={bucketDetailTextActionClass}
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <p className={bucketDetailHintClass}>
                                Use JSON mode to customize or edit rules.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-3 space-y-2">
                              <p className={bucketDetailHintClass}>
                                Paste a JSON array that matches the S3 API (<code>Rules</code>). Existing rules are listed above.
                              </p>
                              <textarea
                                value={lifecycleText}
                                onChange={(e) => updateLifecycleText(e.target.value)}
                                rows={10}
                                className={cx(bucketFeatureJsonInputClass, "w-full rounded-lg bg-slate-50 dark:bg-slate-900")}
                                disabled={lifecycleNotImplemented}
                              />
                              <BucketFeatureJsonExample
                                show={showLifecycleJsonExample}
                                onToggle={() => setShowLifecycleJsonExample((prev) => !prev)}
                                example={defaultLifecycleJsonExample}
                                onUseExample={() => updateLifecycleText(defaultLifecycleJsonExample)}
                                disabled={lifecycleNotImplemented}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </BucketFeatureCard>
                    <BucketFeatureCard
                      title="Bucket tags"
                      description="S3 key/value tags associated with this bucket."
                      mode="graphical"
                      visualState={tagsCardState}
                      testId="bucket-feature-tags"
                      className="space-y-3 order-3 md:order-none md:col-start-1 md:row-start-4"
                      actions={
                        <div className={bucketDetailWrapActionsClass}>
                          <button
                            type="button"
                            onClick={() => setPendingConfigurationDelete("tags")}
                            className={bucketFeatureDangerActionClass}
                            disabled={tagsNotImplemented || bucketTagsLoading || savingBucketTags || deletingBucketTags || bucketTags.length === 0}
                          >
                            {deletingBucketTags ? "Clearing..." : "Clear"}
                          </button>
                          <button
                            type="button"
                            onClick={saveBucketTags}
                            className={bucketFeaturePrimaryActionClass}
                            disabled={tagsNotImplemented || bucketTagsLoading || savingBucketTags || deletingBucketTags}
                          >
                            {savingBucketTags ? "Saving..." : "Save"}
                          </button>
                        </div>
                      }
                    >
                      {bucketTagsError && (
                        <UiInlineMessage tone="error">{bucketTagsError}</UiInlineMessage>
                      )}
                      {bucketTagsStatus && (
                        <UiInlineMessage tone="success">{bucketTagsStatus}</UiInlineMessage>
                      )}
                      {bucketTagsLoading ? (
                        <UiInlineMessage>Loading bucket tags...</UiInlineMessage>
                      ) : (
                        <div className={bucketDetailCompactStackClass}>
                          {bucketTags.length === 0 && (
                            <p className={bucketDetailHintClass}>No tags configured on this bucket.</p>
                          )}
                          {bucketTags.map((tag) => (
                            <div
                              key={tag.uiId}
                              className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                            >
                              <input
                                type="text"
                                value={tag.key}
                                onChange={(e) => updateBucketTag(tag.uiId, { key: e.target.value })}
                                className={bucketFeatureInputClass}
                                placeholder="Tag key"
                                disabled={tagsNotImplemented || savingBucketTags || deletingBucketTags}
                              />
                              <input
                                type="text"
                                value={tag.value}
                                onChange={(e) => updateBucketTag(tag.uiId, { value: e.target.value })}
                                className={bucketFeatureInputClass}
                                placeholder="Tag value"
                                disabled={tagsNotImplemented || savingBucketTags || deletingBucketTags}
                              />
                              <button
                                type="button"
                                onClick={() => removeBucketTag(tag.uiId)}
                                className={bucketFeatureSecondaryActionClass}
                                disabled={tagsNotImplemented || savingBucketTags || deletingBucketTags}
                              >
                                Remove
                              </button>
                            </div>
                          ))}
                          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                            <button
                              type="button"
                              onClick={addBucketTag}
                              className={bucketFeatureSecondaryActionClass}
                              disabled={tagsNotImplemented || savingBucketTags || deletingBucketTags}
                            >
                              Add tag
                            </button>
                            <p className={bucketDetailHintClass}>
                              Tag keys must be unique and cannot be empty.
                            </p>
                          </div>
                        </div>
                      )}
                    </BucketFeatureCard>
                </div>
              </div>
            ),
          },
          {
            id: "permissions",
            label: "Permissions",
            content: (
              <div className={bucketDetailSectionStackClass}>
                <BucketFeatureCard
                  title="Block public access"
                  description="Manage the four S3 public access block flags. Configure each option below."
                  mode="graphical"
                  visualState={publicAccessCardState}
                  testId="bucket-feature-block-public-access"
                  className={bucketDetailStackClass}
                  actions={
                    <button
                      type="button"
                      onClick={savePublicAccessBlock}
                      disabled={publicAccessNotImplemented || publicAccessLoading || savingPublicAccess}
                      className={bucketFeaturePrimaryActionClass}
                    >
                      {savingPublicAccess ? "Saving..." : "Save"}
                    </button>
                  }
                >
                  {publicAccessStatus && (
                    <UiInlineMessage tone="success">{publicAccessStatus}</UiInlineMessage>
                  )}
                  {publicAccessError && (
                    <UiInlineMessage tone="error">{publicAccessError}</UiInlineMessage>
                  )}
                  <div className={bucketDetailTwoColumnGridClass}>
                    {publicAccessOptions.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-body text-slate-700 hover:border-primary dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100"
                      >
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-50">{option.label}</p>
                          <p className={bucketDetailHintClass}>{option.description}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(publicAccessBlock[option.key])}
                          onChange={(e) => updatePublicAccessField(option.key, e.target.checked)}
                          disabled={publicAccessNotImplemented || publicAccessLoading || savingPublicAccess}
                          className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                        />
                      </label>
                    ))}
                  </div>
                </BucketFeatureCard>

                <BucketFeatureCard
                  title="Access control list"
                  description="Configure a canned ACL and review resulting grants."
                  mode="graphical"
                  visualState={aclCardState}
                  testId="bucket-feature-acl"
                  className={bucketDetailStackClass}
                  actions={
                    <button
                      type="button"
                      onClick={saveBucketAcl}
                      className={bucketFeaturePrimaryActionClass}
                      disabled={aclNotImplemented || savingBucketAcl || bucketAclLoading}
                    >
                      {savingBucketAcl ? "Saving..." : "Save"}
                    </button>
                  }
                >
                  {bucketAclError && (
                    <UiInlineMessage tone="error">{bucketAclError}</UiInlineMessage>
                  )}
                  {bucketAclStatus && (
                    <UiInlineMessage tone="success">{bucketAclStatus}</UiInlineMessage>
                  )}
                  <div className={bucketDetailTwoColumnGridClass}>
                    <label className={bucketFeatureLabelClass}>
                      Canned ACL
                      <select
                        value={bucketAclPreset}
                        onChange={(e) => updateBucketAclPreset(e.target.value)}
                        className={bucketFeatureInputClass}
                        disabled={aclNotImplemented || bucketAclLoading || savingBucketAcl}
                      >
                        {bucketAclOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {bucketAclPreset === "custom" && (
                      <label className={bucketFeatureLabelClass}>
                        Custom ACL
                        <input
                          type="text"
                          value={bucketAclCustom}
                          onChange={(e) => updateBucketAclCustom(e.target.value)}
                          className={bucketFeatureInputClass}
                          placeholder="e.g. private"
                          disabled={aclNotImplemented || bucketAclLoading || savingBucketAcl}
                        />
                      </label>
                    )}
                  </div>
                  <p className={bucketDetailHintClass}>
                    Saving a canned ACL replaces the current ACL grants.
                  </p>
                  {bucketAclLoading ? (
                    <UiInlineMessage>Loading ACL...</UiInlineMessage>
                  ) : (
                    <div className={bucketDetailStackClass}>
                      <p className={bucketDetailHintClass}>
                        Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{bucketAcl?.owner ?? "Unknown"}</span>
                      </p>
                      {(bucketAcl?.grants?.length ?? 0) > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                            <thead className="bg-slate-50 ui-caption uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                              <tr>
                                <th className={bucketDetailTableButtonCellClass}>Grantee</th>
                                <th className={bucketDetailTableButtonCellClass}>Type</th>
                                <th className={bucketDetailTableButtonCellClass}>Permission</th>
                              </tr>
                            </thead>
                            <tbody className={bucketDetailDividerClass}>
                              {bucketAcl?.grants.map((grant, index) => {
                                const { grantee } = grant;
                                const label =
                                  grantee.display_name ||
                                  grantee.id ||
                                  (grantee.uri ? grantee.uri.split("/").pop() : null) ||
                                  grantee.type;
                                return (
                                  <tr key={`${grantee.type}-${grantee.id ?? grantee.uri ?? index}`}>
                                    <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{label}</td>
                                    <td className="px-3 py-2 ui-caption text-slate-500 dark:text-slate-400">{grantee.type}</td>
                                    <td className="px-3 py-2 ui-body font-semibold text-slate-800 dark:text-slate-100">{grant.permission}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="ui-body text-slate-600 dark:text-slate-300">No explicit ACL grants on this bucket.</p>
                      )}
                    </div>
                  )}
                </BucketFeatureCard>

                <BucketFeatureCard
                  title="Bucket policy"
                  description="IAM-like JSON applied directly on the bucket."
                  mode="json"
                  visualState={policyCardState}
                  testId="bucket-feature-policy"
                  className={bucketDetailSectionStackClass}
                  actions={
                    <div className={bucketDetailInlineActionsClass}>
                      <button
                        type="button"
                        onClick={() => setPendingConfigurationDelete("policy")}
                        disabled={policyNotImplemented || deletingPolicy || !policyConfigured}
                        className={bucketFeatureDangerActionClass}
                      >
                        {deletingPolicy ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        type="button"
                        onClick={savePolicy}
                        disabled={policyNotImplemented || savingPolicy || policyLoading}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {savingPolicy ? "Saving..." : "Save"}
                      </button>
                    </div>
                  }
                >
                  {policyError && (
                    <UiInlineMessage tone="error">{policyError}</UiInlineMessage>
                  )}
                  <textarea
                    value={policyText}
                    onChange={(e) => setPolicyText(e.target.value)}
                    className={cx(bucketFeatureJsonInputClass, "h-72 w-full")}
                    placeholder='{"Version":"2012-10-17","Statement":[...]}'
                    spellCheck={false}
                    disabled={policyNotImplemented}
                  />
                  <BucketFeatureJsonExample
                    show={showPolicyExample}
                    onToggle={() => setShowPolicyExample((prev) => !prev)}
                    example={policyExample}
                    onUseExample={() => setPolicyText(policyExample)}
                    disabled={policyNotImplemented}
                  />
                </BucketFeatureCard>

                <BucketFeatureCard
                  title="CORS"
                  description="CORS rules in AWS format (CORSRules)."
                  mode="json"
                  visualState={corsCardState}
                  testId="bucket-feature-cors"
                  className={bucketDetailStackClass}
                  actions={
                    <div className={bucketDetailInlineActionsClass}>
                      <button
                        type="button"
                        onClick={() => setPendingConfigurationDelete("cors")}
                        disabled={corsNotImplemented || deletingCors || !corsConfigured}
                        className={bucketFeatureDangerActionClass}
                      >
                        {deletingCors ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        type="button"
                        onClick={saveCors}
                        disabled={corsNotImplemented || savingCors || corsLoading}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {savingCors ? "Saving..." : "Save"}
                      </button>
                    </div>
                  }
                >
                  {corsError && (
                    <UiInlineMessage tone="error">{corsError}</UiInlineMessage>
                  )}
                  <textarea
                    value={corsText}
                    onChange={(e) => setCorsText(e.target.value)}
                    className={cx(bucketFeatureJsonInputClass, "h-56 w-full")}
                    placeholder='[{"AllowedMethods":["GET"],"AllowedOrigins":["*"]}]'
                    spellCheck={false}
                    disabled={corsNotImplemented}
                  />
                  <BucketFeatureJsonExample
                    show={showCorsExample}
                    onToggle={() => setShowCorsExample((prev) => !prev)}
                    example={defaultCorsExample}
                    onUseExample={() => setCorsText(defaultCorsExample)}
                    disabled={corsNotImplemented}
                  />
                </BucketFeatureCard>

              </div>
            ),
          },
          {
            id: "advanced",
            label: "Advanced",
            content: (
              <div className={bucketDetailStackClass}>
                <BucketFeatureCard
                  title="Static website"
                  description="Host a static website from this bucket or redirect all requests."
                  mode="hybrid"
                  visualState={websiteCardState}
                  testId="bucket-feature-website"
                  className={bucketDetailStackClass}
                  actions={
                    <div className={bucketDetailWrapActionsClass}>
                      <button
                        type="button"
                        onClick={() => setPendingConfigurationDelete("website")}
                        disabled={websiteNotImplemented || clearingWebsite || staticWebsiteBlocked || !websiteConfigured}
                        className={bucketFeatureDangerActionClass}
                      >
                        {clearingWebsite ? "Deleting..." : "Delete"}
                      </button>
                      <button
                        type="button"
                        onClick={saveWebsite}
                        disabled={websiteNotImplemented || savingWebsite || websiteLoading || staticWebsiteBlocked}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {savingWebsite ? "Saving..." : "Save"}
                      </button>
                    </div>
                  }
                >
                  {staticWebsiteBlocked && <EndpointFeatureDisabledNotice featureLabel="Static website" />}
                  {websiteError && (
                    <UiInlineMessage tone="error">{websiteError}</UiInlineMessage>
                  )}
                  {websiteStatus && (
                    <UiInlineMessage tone="success">{websiteStatus}</UiInlineMessage>
                  )}
                  <div className={bucketDetailTwoColumnGridClass}>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                      <input
                        type="radio"
                        checked={websiteMode === "hosting"}
                        onChange={() => updateWebsiteMode("hosting")}
                        disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Host a website</p>
                        <p className={bucketDetailHintClass}>
                          Serve index and error documents from this bucket.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                      <input
                        type="radio"
                        checked={websiteMode === "redirect"}
                        onChange={() => updateWebsiteMode("redirect")}
                        disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Redirect all requests</p>
                        <p className={bucketDetailHintClass}>
                          Point every request to another host or domain.
                        </p>
                      </div>
                    </label>
                  </div>
                  {websiteMode === "hosting" ? (
                    <div className={bucketDetailStackClass}>
                      <div className={bucketDetailTwoColumnGridClass}>
                        <label className={bucketFeatureLabelClass}>
                          Index document
                          <input
                            type="text"
                            value={websiteIndexDocument}
                            onChange={(e) => updateWebsiteIndexDocument(e.target.value)}
                            className={bucketFeatureInputClass}
                            placeholder="index.html"
                            disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                          />
                        </label>
                        <label className={bucketFeatureLabelClass}>
                          Error document (optional)
                          <input
                            type="text"
                            value={websiteErrorDocument}
                            onChange={(e) => updateWebsiteErrorDocument(e.target.value)}
                            className={bucketFeatureInputClass}
                            placeholder="error.html"
                            disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                          />
                        </label>
                      </div>
                      <div className={bucketDetailCompactStackClass}>
                        <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">
                          Routing rules (JSON array)
                        </label>
                        <textarea
                          value={websiteRoutingRules}
                          onChange={(e) => updateWebsiteRoutingRules(e.target.value)}
                          rows={6}
                          className={cx(bucketFeatureJsonInputClass, "w-full")}
                          placeholder="[]"
                          spellCheck={false}
                          disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        />
                        <div className="ui-caption">
                          <BucketFeatureJsonExample
                            show={showWebsiteRulesExample}
                            onToggle={() => setShowWebsiteRulesExample((prev) => !prev)}
                            example={defaultWebsiteRoutingRulesExample}
                            onUseExample={() => updateWebsiteRoutingRules(defaultWebsiteRoutingRulesExample)}
                            disabled={websiteNotImplemented}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className={bucketDetailTwoColumnGridClass}>
                      <label className={bucketFeatureLabelClass}>
                        Redirect hostname
                        <input
                          type="text"
                          value={websiteRedirectHost}
                          onChange={(e) => updateWebsiteRedirectHost(e.target.value)}
                          className={bucketFeatureInputClass}
                          placeholder="www.example.com"
                          disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        />
                      </label>
                      <label className={bucketFeatureLabelClass}>
                        Protocol (optional)
                        <input
                          type="text"
                          value={websiteRedirectProtocol}
                          onChange={(e) => updateWebsiteRedirectProtocol(e.target.value)}
                          className={bucketFeatureInputClass}
                          placeholder="https"
                          disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        />
                      </label>
                      <p className="md:col-span-2 ui-caption text-slate-500 dark:text-slate-400">
                        All requests will redirect to the host above. Index and routing rules are ignored.
                      </p>
                    </div>
                  )}
                </BucketFeatureCard>
                {isCephEndpoint && (
                  <BucketFeatureCard
                    title="Replication / multisite"
                    description="Configure Ceph RGW multisite bucket replication across zones within this bucket's zonegroup."
                    mode="hybrid"
                    visualState={replicationCardState}
                    testId="bucket-feature-replication"
                    className={bucketDetailStackClass}
                    actions={
                      <div className={bucketDetailWrapActionsClass}>
                        <button
                          type="button"
                          onClick={() => setPendingConfigurationDelete("replication")}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy || !replicationConfigured}
                          className={bucketFeatureDangerActionClass}
                        >
                          {clearingReplication ? "Clearing..." : "Clear"}
                        </button>
                        <button
                          type="button"
                          onClick={saveReplication}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                          className={bucketFeaturePrimaryActionClass}
                        >
                          {savingReplication ? "Saving..." : "Save"}
                        </button>
                      </div>
                    }
                  >
                    <BucketFeatureModeToggle
                      value={replicationMode}
                      options={[
                        { value: "graphical", label: "Graphical mode" },
                        { value: "json", label: "JSON mode" },
                      ]}
                      onChange={updateReplicationMode}
                      disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                    />
                    {replicationBlocked && <EndpointFeatureDisabledNotice featureLabel="Bucket replication" />}
                    {replicationError && (
                      <UiInlineMessage tone="error">{replicationError}</UiInlineMessage>
                    )}
                    {replicationWarning && (
                      <UiInlineMessage tone="warning">{replicationWarning}</UiInlineMessage>
                    )}
                    {replicationStatus && (
                      <UiInlineMessage tone="success">{replicationStatus}</UiInlineMessage>
                    )}
                    {replicationLoading ? (
                      <UiInlineMessage>Loading replication configuration...</UiInlineMessage>
                    ) : replicationMode === "graphical" ? (
                      <div className={bucketDetailStackClass}>
                        <label className={bucketFeatureLabelClass}>
                          Role ARN
                          <input
                            type="text"
                            value={replicationRole}
                            onChange={(e) => updateReplicationRole(e.target.value)}
                            className={bucketFeatureInputClass}
                            placeholder="arn:aws:iam::123456789012:role/replication-role"
                            disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                          />
                        </label>
                        <div className={bucketDetailStackClass}>
                          {replicationRules.map((rule, index) => (
                            <div
                              key={rule.uiId}
                              className={cx(uiCardMutedClass, "space-y-3 p-3")}
                            >
                              <div className="flex items-center justify-between">
                                <p className="ui-caption font-semibold text-slate-700 dark:text-slate-200">Rule {index + 1}</p>
                                <button
                                  type="button"
                                  onClick={() => removeReplicationRule(rule.uiId)}
                                  disabled={replicationBlocked || replicationNotImplemented || replicationBusy || replicationRules.length <= 1}
                                  className="rounded-md border border-rose-200 px-2 py-1 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                                >
                                  Remove
                                </button>
                              </div>
                              <div className={bucketDetailTwoColumnGridClass}>
                                <label className={bucketFeatureLabelClass}>
                                  ID
                                  <input
                                    type="text"
                                    value={rule.id}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { id: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder={`rule-${index + 1}`}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Status
                                  <select
                                    value={rule.status}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { status: e.target.value as "Enabled" | "Disabled" })}
                                    className={bucketFeatureInputClass}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  >
                                    <option value="Enabled">Enabled</option>
                                    <option value="Disabled">Disabled</option>
                                  </select>
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Priority
                                  <input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={rule.priority}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { priority: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="1"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Prefix (optional)
                                  <input
                                    type="text"
                                    value={rule.prefix}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { prefix: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="logs/"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Destination bucket ARN
                                  <input
                                    type="text"
                                    value={rule.destinationBucket}
                                    onChange={(e) => updateReplicationRule(rule.uiId, { destinationBucket: e.target.value })}
                                    className={bucketFeatureInputClass}
                                    placeholder="arn:aws:s3:::target-bucket"
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  />
                                </label>
                                <label className={bucketFeatureLabelClass}>
                                  Delete marker replication
                                  <select
                                    value={rule.deleteMarkerStatus}
                                    onChange={(e) =>
                                      updateReplicationRule(rule.uiId, {
                                        deleteMarkerStatus: e.target.value as "Enabled" | "Disabled",
                                      })
                                    }
                                    className={bucketFeatureInputClass}
                                    disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                                  >
                                    <option value="Disabled">Disabled</option>
                                    <option value="Enabled">Enabled</option>
                                  </select>
                                </label>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div>
                          <button
                            type="button"
                            onClick={addReplicationRule}
                            disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                            className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-slate-300 dark:border-slate-700 dark:text-slate-200"
                          >
                            Add rule
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={bucketDetailCompactStackClass}>
                        <textarea
                          value={replicationText}
                          onChange={(e) => updateReplicationText(e.target.value)}
                          rows={14}
                          className={cx(bucketFeatureJsonInputClass, "w-full")}
                          spellCheck={false}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                        />
                        {replicationHasUnsupportedZone && (
                          <p className="ui-caption text-rose-700 dark:text-rose-200">
                            Destination.Zone is not supported in V1 and must be removed before saving.
                          </p>
                        )}
                        <BucketFeatureJsonExample
                          show={showReplicationExample}
                          onToggle={() => setShowReplicationExample((prev) => !prev)}
                          example={defaultReplicationJsonExample}
                          onUseExample={() => updateReplicationText(defaultReplicationJsonExample)}
                          disabled={replicationBlocked || replicationNotImplemented}
                        />
                      </div>
                    )}
                  </BucketFeatureCard>
                )}
                <BucketFeatureCard
                  title="Server access logging"
                  description="Deliver S3 server access logs to another bucket."
                  mode="graphical"
                  visualState={accessLoggingCardState}
                  testId="bucket-feature-access-logging"
                  className={bucketDetailStackClass}
                  actions={
                    <div className={bucketDetailWrapActionsClass}>
                      <button
                        type="button"
                        onClick={() => setPendingConfigurationDelete("access-logging")}
                        disabled={accessLoggingNotImplemented || clearingAccessLogging || !accessLoggingConfigured}
                        className={bucketFeatureDangerActionClass}
                      >
                        {clearingAccessLogging ? "Disabling..." : "Disable"}
                      </button>
                      <button
                        type="button"
                        onClick={saveAccessLogging}
                        disabled={accessLoggingNotImplemented || savingAccessLogging || accessLoggingLoading}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {savingAccessLogging ? "Saving..." : "Save"}
                      </button>
                    </div>
                  }
                >
                  {accessLoggingError && (
                    <UiInlineMessage tone="error">{accessLoggingError}</UiInlineMessage>
                  )}
                  {accessLoggingStatus && (
                    <UiInlineMessage tone="success">{accessLoggingStatus}</UiInlineMessage>
                  )}
                  <label className="flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={accessLoggingEnabled}
                      onChange={(e) => updateAccessLoggingEnabled(e.target.checked)}
                      disabled={accessLoggingNotImplemented || accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      className={uiCheckboxClass}
                    />
                    Enable server access logging
                  </label>
                  <div className={bucketDetailTwoColumnGridClass}>
                    <label className={bucketFeatureLabelClass}>
                      Target bucket
                      <input
                        type="text"
                        value={accessLoggingTargetBucket}
                        onChange={(e) => updateAccessLoggingTargetBucket(e.target.value)}
                        className={bucketFeatureInputClass}
                        placeholder="logs-bucket"
                        disabled={accessLoggingNotImplemented || accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      />
                    </label>
                    <label className={bucketFeatureLabelClass}>
                      Target prefix (optional)
                      <input
                        type="text"
                        value={accessLoggingTargetPrefix}
                        onChange={(e) => updateAccessLoggingTargetPrefix(e.target.value)}
                        className={bucketFeatureInputClass}
                        placeholder="access-logs/"
                        disabled={accessLoggingNotImplemented || accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      />
                    </label>
                  </div>
                  <p className={bucketDetailHintClass}>
                    The target bucket must allow log delivery (e.g., ACL <code className="font-mono ui-caption">log-delivery-write</code>
                    or an equivalent policy).
                  </p>
                </BucketFeatureCard>
                <BucketFeatureCard
                  title="Notifications / SNS topics"
                  description={
                    "JSON payload forwarded to put_bucket_notification_configuration."
                  }
                  mode="json"
                  visualState={notificationsCardState}
                  testId="bucket-feature-notifications"
                  className={bucketDetailStackClass}
                  actions={
                    <div className={bucketDetailWrapActionsClass}>
                      <button
                        type="button"
                        onClick={() => setPendingConfigurationDelete("notifications")}
                        disabled={notificationsNotImplemented || clearingNotifications || !notificationsConfigured}
                        className={bucketFeatureDangerActionClass}
                      >
                        {clearingNotifications ? "Clearing..." : "Clear"}
                      </button>
                      <button
                        type="button"
                        onClick={saveNotifications}
                        disabled={notificationsNotImplemented || savingNotifications || notificationsLoading}
                        className={bucketFeaturePrimaryActionClass}
                      >
                        {savingNotifications ? "Saving..." : "Save"}
                      </button>
                    </div>
                  }
                >
                  {notificationsError && (
                    <UiInlineMessage tone="error">{notificationsError}</UiInlineMessage>
                  )}
                  {notificationsStatus && (
                    <UiInlineMessage tone="success">{notificationsStatus}</UiInlineMessage>
                  )}
                  <textarea
                    value={notificationText}
                    onChange={(e) => updateNotificationText(e.target.value)}
                    className={cx(bucketFeatureJsonInputClass, "h-64 w-full")}
                    placeholder={defaultNotificationTemplate}
                    spellCheck={false}
                    disabled={notificationsNotImplemented}
                  />
                  <BucketFeatureJsonExample
                    show={showNotificationExample}
                    onToggle={() => setShowNotificationExample((prev) => !prev)}
                    example={notificationExample}
                    onUseExample={() => updateNotificationText(notificationExample)}
                    disabled={notificationsNotImplemented}
                    helperText={
                      <span className={bucketDetailHintClass}>
                        Need a topic? Create it in the Topics section.
                      </span>
                    }
                  />
                  <p className={bucketDetailHintClass}>
                    Only topic-based notifications are supported. Each entry should include{" "}
                    <code className="font-mono ui-caption">TopicArn</code>, <code className="font-mono ui-caption">Events</code>, and
                    an optional filter.
                  </p>
                </BucketFeatureCard>
              </div>
            ),
          },
          {
            id: "usage-stats",
            label: "Usage stats",
            content: (
              <BucketUsageStatsPanel
                snapshot={usageStatsSnapshot}
                loading={usageStatsLoading}
                error={usageStatsError}
                recalculating={usageStatsRecalculating}
                onRefresh={loadUsageStats}
                onRecalculate={recalculateUsageStats}
              />
            ),
          },
          {
            id: "metrics",
            label: "Metrics",
            disabled: !canViewBucketMetrics,
            content: (
              <div className={bucketDetailSectionStackClass}>
                <MetricsCard
                  title="Current usage and quota"
                  description="Live usage, quotas, and traffic sourced from backend metrics."
                >
                  <div className={bucketDetailTwoColumnGridClass}>
                    <UsageTile
                      label="Storage"
                      used={storageUsage.used}
                      quota={storageUsage.quota}
                      formatter={formatBytes}
                      quotaFormatter={formatBytes}
                      loading={loadingBucket}
                      emptyHint="No storage quota defined."
                    />
                    <UsageTile
                      label="Objects"
                      used={objectUsage.used}
                      quota={objectUsage.quota}
                      formatter={formatCompactNumber}
                      quotaFormatter={(value) => (value != null ? value.toLocaleString() : "-")}
                      loading={loadingBucket}
                      unitHint="objects"
                      emptyHint="No object quota defined."
                    />
                  </div>
                </MetricsCard>
                {!canViewLiveBucketMetrics && (
                  <PageBanner>
                    Live endpoint metrics are unavailable. BucketReef usage stats calculated from bucket listings remain
                    available in the Usage stats tab.
                  </PageBanner>
                )}
                {canViewLiveBucketMetrics &&
                  (isCephAdmin ? (
                    endpointId && bucketName ? (
                      <TrafficAnalytics scope="ceph-admin" endpointId={endpointId} bucketName={bucketName} enabled={hasCephContext} />
                    ) : (
                      <PageBanner tone="warning">Select an endpoint and a bucket to view detailed metrics.</PageBanner>
                    )
                  ) : hasAccountContext && bucketName ? (
                    <TrafficAnalytics accountId={accountIdForApi} bucketName={bucketName} enabled={hasAccountContext} />
                  ) : (
                    <PageBanner tone="warning">Select an account and a bucket to view detailed metrics.</PageBanner>
                  ))}
              </div>
            ),
          },
          ...(showQuotaTab
            ? [
                {
                  id: "ceph",
                  label: isCephAdmin ? "Ceph Admin" : "Privileged Ceph",
                  content: (
                    <div className={bucketDetailStackClass}>
                      <BucketFeatureCard
                        title="Quota"
                        description="Allowed bucket size and object count."
                        mode="graphical"
                        visualState={quotaCardState}
                        testId="bucket-feature-quota"
                        actions={
                          quotaSectionRestricted ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              Restricted
                            </span>
                          ) : canEditQuota ? (
                            <button
                              type="submit"
                              form={quotaFormId}
                              disabled={updatingQuota || !canEditQuota}
                              className={bucketFeaturePrimaryActionClass}
                              title={
                                !quotaFeatureEnabled
                                  ? "Unavailable on this endpoint"
                                  : !canEditQuota
                                    ? "Privileged Ceph access required"
                                    : undefined
                              }
                            >
                              {updatingQuota ? "Saving..." : "Save"}
                            </button>
                          ) : null
                        }
                      >
                  {!quotaFeatureEnabled && <EndpointFeatureDisabledNotice featureLabel="Quota" />}
                  <form
                    id={quotaFormId}
                    className={`mt-2 space-y-2 ${quotaSectionRestricted ? "pointer-events-none" : ""}`}
                    onSubmit={handleUpdateQuota}
                  >
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className={bucketFeatureLabelClass}>
                        Size
                        <div className={bucketDetailInlineActionsClass}>
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={quotaSizeGb}
                            onChange={(e) => updateQuotaSize(e.target.value)}
                            className={cx(bucketFeatureInputClass, "flex-1")}
                            placeholder="e.g. 100"
                            disabled={!canEditQuota}
                          />
                          <select
                            value={quotaSizeUnit}
                            onChange={(e) => updateQuotaSizeUnit(e.target.value as BucketQuotaUnit)}
                            className={cx(bucketFeatureInputClass, "w-20")}
                            disabled={!canEditQuota}
                          >
                            <option value="MiB">MiB</option>
                            <option value="GiB">GiB</option>
                            <option value="TiB">TiB</option>
                          </select>
                        </div>
                      </label>
                      <label className={bucketFeatureLabelClass}>
                        Object count
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={quotaObjects}
                          onChange={(e) => updateQuotaObjects(e.target.value)}
                          className={bucketFeatureInputClass}
                          placeholder="e.g. 1000000"
                          disabled={!canEditQuota}
                        />
                      </label>
                    </div>
                    {quotaStatus && (
                      <UiInlineMessage tone="success">{quotaStatus}</UiInlineMessage>
                    )}
                    {quotaError && (
                      <UiInlineMessage tone="error">{quotaError}</UiInlineMessage>
                    )}
                  </form>
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    {quotaFeatureEnabled
                      ? `Leave empty to remove the quota. ${canEditQuota ? "" : "(Privileged Ceph access required.)"}`
                      : "Quota management is unavailable on this endpoint."}
                  </p>
                      </BucketFeatureCard>
                    </div>
                  ),
                },
              ]
            : []),
        ].sort((a, b) => availableTabs.indexOf(a.id as BucketDetailTabId) - availableTabs.indexOf(b.id as BucketDetailTabId))}
      />

      {pendingConfigurationDelete && (
        <ConfirmActionDialog
          title={bucketConfigurationDeleteCopy[pendingConfigurationDelete].title}
          description={bucketConfigurationDeleteCopy[pendingConfigurationDelete].description}
          confirmLabel={bucketConfigurationDeleteCopy[pendingConfigurationDelete].confirmLabel}
          details={[{ label: "Bucket", value: bucketName ?? "Unknown", mono: true }]}
          impacts={bucketConfigurationDeleteCopy[pendingConfigurationDelete].impacts}
          loading={configurationDeleteLoading}
          onCancel={() => setPendingConfigurationDelete(null)}
          onConfirm={() => void confirmPendingConfigurationDelete()}
        />
      )}

    </div>
  );
}

function EndpointFeatureDisabledNotice({ featureLabel }: { featureLabel: string }) {
  return (
    <UiInlineMessage>
      {featureLabel} is disabled on this endpoint.
    </UiInlineMessage>
  );
}
