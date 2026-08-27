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
import {
  Bucket,
  BucketAcl,
  BucketLifecycleConfig,
  BucketObjectLockConfiguration,
  BucketReplicationConfiguration,
  BucketPublicAccessBlock,
  BucketTag,
  BucketWebsiteConfiguration,
  deleteBucketNotifications,
  deleteBucketReplication,
  deleteBucketTags,
  deleteBucketWebsite,
  deleteBucketLifecycle,
  getBucketTags,
  getBucketNotifications,
  getBucketObjectLock,
  getBucketReplication,
  getBucketVersioning,
  getBucketWebsite,
  getBucketAcl,
  getBucketLifecycle,
  getBucketPublicAccessBlock,
  listBuckets,
  putBucketTags,
  putBucketNotifications,
  putBucketReplication,
  putBucketWebsite,
  putBucketLifecycle,
  setBucketVersioning,
  updateBucketAcl,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
  updateBucketQuota,
} from "../../api/buckets";
import {
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketNotifications,
  deleteCephAdminBucketReplication,
  deleteCephAdminBucketTags,
  deleteCephAdminBucketWebsite,
  getCephAdminBucketAcl,
  getCephAdminBucketLifecycle,
  getCephAdminBucketNotifications,
  getCephAdminBucketObjectLock,
  getCephAdminBucketReplication,
  getCephAdminBucketVersioning,
  getCephAdminBucketPublicAccessBlock,
  getCephAdminBucketTags,
  getCephAdminBucketWebsite,
  listCephAdminBucketObjects,
  listCephAdminBuckets,
  putCephAdminBucketLifecycle,
  putCephAdminBucketNotifications,
  putCephAdminBucketReplication,
  putCephAdminBucketTags,
  putCephAdminBucketWebsite,
  setCephAdminBucketVersioning,
  updateCephAdminBucketAcl,
  updateCephAdminBucketObjectLock,
  updateCephAdminBucketQuota,
  updateCephAdminBucketPublicAccessBlock,
} from "../../api/cephAdmin";
import {
  listObjects,
  S3Object,
} from "../../api/objects";
import {
  getCephAdminBucketUsageStats,
  getManagerBucketUsageStats,
  streamCephAdminBucketUsageStatsForBucket,
  streamManagerBucketUsageStatsForBucket,
  type BucketUsageStatsSnapshot,
} from "../../api/bucketUsageStats";
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
  buildReplicationConfigurationFromGraphical,
  containsUnsupportedReplicationZone,
  createEmptyGraphicalReplicationRule,
  GraphicalReplicationRule,
  isReplicationConfigurationConfigured,
  normalizeReplicationConfiguration,
  parseReplicationConfigurationForGraphical,
  validateGraphicalReplication,
  validateJsonReplicationConfiguration,
} from "./bucketReplication";
import {
  BucketFeatureCard,
  BucketFeatureJsonExample,
  BucketFeatureModeToggle,
  buildPolicyExample,
  defaultCorsExample,
  defaultEncryptionExample,
  jsonTextSignature,
  isLifecycleSimpleDraftEmpty,
  normalizeAclDraft,
  normalizeBucketTagsDraft,
  normalizeNotificationConfiguration,
  normalizePublicAccessDraft,
  normalizeQuotaDraft,
  normalizeReplicationGraphicalDraft,
  resolveFeatureVisualState,
  stableBucketJsonSignature,
  useBucketAccessLoggingController,
  useBucketCorsController,
  useBucketEncryptionController,
  useBucketPolicyController,
} from "./bucketDetail";
import {
  buildBucketDetailBreadcrumbs,
  resolveBucketDetailSurface,
  resolveBucketDetailTabs,
  type BucketDetailTabId,
  type BucketDetailMode,
} from "./bucketDetail/bucketDetailSurface";
import { extractApiError, isApiFeatureNotImplemented } from "../../utils/apiError";
import { formatBytes } from "../../utils/format";
import { createUiDraftId } from "../../utils/uiDraftId";
import type { UiRole } from "../../api/users";

type ReplicationRuleDraft = GraphicalReplicationRule & { uiId: string };
type BucketTagDraft = BucketTag & { uiId: string };

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

function createReplicationRuleDraft(
  rule: GraphicalReplicationRule = createEmptyGraphicalReplicationRule()
): ReplicationRuleDraft {
  return { ...rule, uiId: createUiDraftId("replication-rule") };
}

function createBucketTagDraft(tag: BucketTag = { key: "", value: "" }): BucketTagDraft {
  return { ...tag, uiId: createUiDraftId("bucket-tag") };
}

function getUserRole(): UiRole | null {
  return readStoredUser()?.role ?? null;
}

function inferBucketAclPreset(acl: BucketAcl | null): string {
  if (!acl || !acl.grants || acl.grants.length === 0) return "private";
  const allUsersUri = "http://acs.amazonaws.com/groups/global/AllUsers";
  const authUsersUri = "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";
  const allUsersPerms = new Set(
    acl.grants.filter((grant) => grant.grantee?.uri === allUsersUri).map((grant) => grant.permission)
  );
  const authUsersPerms = new Set(
    acl.grants.filter((grant) => grant.grantee?.uri === authUsersUri).map((grant) => grant.permission)
  );
  if (allUsersPerms.has("READ") && allUsersPerms.has("WRITE")) return "public-read-write";
  if (allUsersPerms.has("READ")) return "public-read";
  if (authUsersPerms.has("READ")) return "authenticated-read";
  return "custom";
}

type Row =
  | { type: "prefix"; key: string; name: string }
  | { type: "object"; key: string; name: string; object: S3Object };

type PropertySummary = {
  label: string;
  state: string;
  tone: PropertySummaryTone;
};

type SimpleLifecycleRule = {
  id: string;
  prefix: string;
  expirationDays: string;
  noncurrentDays: string;
  multipartDays: string;
  tagKey: string;
  tagValue: string;
  deleteExpiredMarkers: boolean;
  status: "Enabled" | "Disabled";
};

type LifecycleRuleStatus = "Enabled" | "Disabled";
type LifecycleTagFilter = { Key?: unknown; Value?: unknown };
type LifecycleAndFilter = { Prefix?: unknown; Tags?: unknown };
type LifecycleFilter = { Prefix?: unknown; Tag?: LifecycleTagFilter; And?: LifecycleAndFilter };
type LifecycleRuleRecord = Record<string, unknown> & {
  ID?: unknown;
  Prefix?: unknown;
  Status?: unknown;
  Filter?: LifecycleFilter;
};

const defaultPublicAccessBlock: BucketPublicAccessBlock = {
  block_public_acls: false,
  ignore_public_acls: false,
  block_public_policy: false,
  restrict_public_buckets: false,
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

const publicAccessKeys = publicAccessOptions.map((option) => option.key);
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

const isPublicAccessFullyEnabled = (config?: BucketPublicAccessBlock | null) =>
  Boolean(config) && publicAccessKeys.every((key) => (config as Record<string, boolean | null | undefined>)[key] === true);

const defaultNotificationTemplate = '{\n  "TopicConfigurations": []\n}';
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

const bucketAclOptions = [
  { value: "private", label: "Private (bucket owner full control)" },
  { value: "public-read", label: "Public read" },
  { value: "public-read-write", label: "Public read/write" },
  { value: "authenticated-read", label: "Authenticated users read" },
  { value: "bucket-owner-read", label: "Bucket owner read" },
  { value: "bucket-owner-full-control", label: "Bucket owner full control" },
  { value: "log-delivery-write", label: "Log delivery write" },
  { value: "custom", label: "Custom canned ACL" },
];

function randomLifecycleId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return `rule-${crypto.randomUUID()}`;
    } catch {
      // ignore and fallback
    }
  }
  return `rule-${Math.random().toString(36).slice(2, 10)}`;
}

function lifecycleRuleId(rule: LifecycleRuleRecord): string | null {
  return typeof rule.ID === "string" && rule.ID.trim() ? rule.ID.trim() : null;
}

function lifecycleRulePrefix(rule: LifecycleRuleRecord): string | null {
  return typeof rule.Prefix === "string" && rule.Prefix.trim() ? rule.Prefix.trim() : null;
}

function lifecycleRuleStatus(rule: LifecycleRuleRecord): LifecycleRuleStatus {
  return rule.Status === "Disabled" ? "Disabled" : "Enabled";
}

function lifecycleTagLabel(tag: LifecycleTagFilter): string | null {
  if (typeof tag.Key !== "string" || !tag.Key.trim()) return null;
  return `${tag.Key.trim()}=${typeof tag.Value === "string" ? tag.Value.trim() : ""}`;
}

function lifecycleFilterLabel(filter: LifecycleFilter | undefined): string {
  if (!filter) return "-";
  if (typeof filter.Prefix === "string" && filter.Prefix.trim()) {
    return `Prefix: ${filter.Prefix.trim()}`;
  }
  if (filter.Tag) {
    const tag = lifecycleTagLabel(filter.Tag);
    if (tag) return `Tag: ${tag}`;
  }
  if (filter.And) {
    const andPrefix =
      typeof filter.And.Prefix === "string" && filter.And.Prefix.trim()
        ? `Prefix: ${filter.And.Prefix.trim()}`
        : "";
    const tags = Array.isArray(filter.And.Tags)
      ? filter.And.Tags
          .filter((tag): tag is LifecycleTagFilter => Boolean(tag) && typeof tag === "object")
          .map(lifecycleTagLabel)
          .filter((tag): tag is string => Boolean(tag))
      : [];
    const andTags = tags.length > 0 ? `Tags: ${tags.join(", ")}` : "";
    return [andPrefix, andTags].filter(Boolean).join(" · ") || "Combined filter";
  }
  return "-";
}

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

export default function BucketDetailPage({
  mode = "manager",
  bucketNameOverride,
  accountIdOverride = null,
  hideQuotaTab = false,
  embedded = false,
  hideObjectsTab = false,
  bucketListPathOverride,
  onBackToBuckets,
}: BucketDetailPageProps) {
  const params = useParams<{ bucketName: string }>();
  const bucketName = bucketNameOverride ?? params.bucketName;
  const isCephAdmin = mode === "ceph-admin";
  const {
    accounts,
    selectedS3AccountId,
    accountIdForApi,
    requiresS3AccountSelection,
    accessMode,
    managerBucketQuotaEnabled,
  } = useS3AccountContext();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [loadingBucket, setLoadingBucket] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [versioningStatus, setVersioningStatus] = useState<string | null>(null);
  const [versioningLoading, setVersioningLoading] = useState(false);
  const [versioningLoadError, setVersioningLoadError] = useState<string | null>(null);
  const [versioningSaveError, setVersioningSaveError] = useState<string | null>(null);
  const [updatingVersioning, setUpdatingVersioning] = useState(false);
  const [versioningDraftEnabled, setVersioningDraftEnabled] = useState(false);
  const [publicAccessBlock, setPublicAccessBlock] = useState<BucketPublicAccessBlock>(defaultPublicAccessBlock);
  const [publicAccessError, setPublicAccessError] = useState<string | null>(null);
  const [publicAccessStatus, setPublicAccessStatus] = useState<string | null>(null);
  const [publicAccessLoading, setPublicAccessLoading] = useState(false);
  const [savingPublicAccess, setSavingPublicAccess] = useState(false);
  const [notificationText, setNotificationText] = useState(defaultNotificationTemplate);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsStatus, setNotificationsStatus] = useState<string | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [showNotificationExample, setShowNotificationExample] = useState(false);
  const [websiteConfig, setWebsiteConfig] = useState<BucketWebsiteConfiguration | null>(null);
  const [websiteMode, setWebsiteMode] = useState<"hosting" | "redirect">("hosting");
  const [websiteIndexDocument, setWebsiteIndexDocument] = useState("");
  const [websiteErrorDocument, setWebsiteErrorDocument] = useState("");
  const [websiteRedirectHost, setWebsiteRedirectHost] = useState("");
  const [websiteRedirectProtocol, setWebsiteRedirectProtocol] = useState("");
  const [websiteRoutingRules, setWebsiteRoutingRules] = useState("[]");
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [websiteStatus, setWebsiteStatus] = useState<string | null>(null);
  const [websiteLoading, setWebsiteLoading] = useState(false);
  const [savingWebsite, setSavingWebsite] = useState(false);
  const [clearingWebsite, setClearingWebsite] = useState(false);
  const [showWebsiteRulesExample, setShowWebsiteRulesExample] = useState(false);
  const [showEncryptionExample, setShowEncryptionExample] = useState(false);
  const [showLifecycleJsonExample, setShowLifecycleJsonExample] = useState(false);
  const [showReplicationExample, setShowReplicationExample] = useState(false);
  const [bucketAcl, setBucketAcl] = useState<BucketAcl | null>(null);
  const [bucketAclError, setBucketAclError] = useState<string | null>(null);
  const [bucketAclLoading, setBucketAclLoading] = useState(false);
  const [bucketAclStatus, setBucketAclStatus] = useState<string | null>(null);
  const [bucketAclPreset, setBucketAclPreset] = useState("private");
  const [bucketAclCustom, setBucketAclCustom] = useState("");
  const [savingBucketAcl, setSavingBucketAcl] = useState(false);
  const [lifecycle, setLifecycle] = useState<BucketLifecycleConfig>({ rules: [] });
  const [lifecycleText, setLifecycleText] = useState("[]");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleStatus, setLifecycleStatus] = useState<string | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState(false);
  const [savingLifecycle, setSavingLifecycle] = useState(false);
  const [lifecycleMode, setLifecycleMode] = useState<"simple" | "json">("json");
  const [simpleLifecycleRules, setSimpleLifecycleRules] = useState<SimpleLifecycleRule[]>([
    {
      id: "",
      prefix: "",
      expirationDays: "",
      noncurrentDays: "",
      multipartDays: "",
      tagKey: "",
      tagValue: "",
      deleteExpiredMarkers: false,
      status: "Enabled",
    },
  ]);
  const [simpleLifecycleWarning, setSimpleLifecycleWarning] = useState<string | null>(null);
  const [showLifecycleEditor, setShowLifecycleEditor] = useState(false);
  const [replicationConfig, setReplicationConfig] = useState<BucketReplicationConfiguration>({ configuration: {} });
  const [replicationMode, setReplicationMode] = useState<"graphical" | "json">("graphical");
  const [replicationText, setReplicationText] = useState("{}");
  const [replicationRole, setReplicationRole] = useState("");
  const [replicationRules, setReplicationRules] = useState<ReplicationRuleDraft[]>([createReplicationRuleDraft()]);
  const [replicationWarning, setReplicationWarning] = useState<string | null>(null);
  const [replicationError, setReplicationError] = useState<string | null>(null);
  const [replicationStatus, setReplicationStatus] = useState<string | null>(null);
  const [replicationLoading, setReplicationLoading] = useState(false);
  const [savingReplication, setSavingReplication] = useState(false);
  const [clearingReplication, setClearingReplication] = useState(false);
  const [bucketTags, setBucketTags] = useState<BucketTagDraft[]>([]);
  const [bucketTagsLoading, setBucketTagsLoading] = useState(false);
  const [bucketTagsError, setBucketTagsError] = useState<string | null>(null);
  const [bucketTagsStatus, setBucketTagsStatus] = useState<string | null>(null);
  const [savingBucketTags, setSavingBucketTags] = useState(false);
  const [deletingBucketTags, setDeletingBucketTags] = useState(false);
  const [pendingConfigurationDelete, setPendingConfigurationDelete] = useState<BucketConfigurationDeleteKind | null>(null);

  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [usageStatsSnapshot, setUsageStatsSnapshot] = useState<BucketUsageStatsSnapshot | null>(null);
  const [usageStatsLoading, setUsageStatsLoading] = useState(false);
  const [usageStatsError, setUsageStatsError] = useState<string | null>(null);
  const [usageStatsRecalculating, setUsageStatsRecalculating] = useState(false);
  const [activeTab, setActiveTab] = useState<BucketDetailTabId>("overview");
  const [currentPrefix, setCurrentPrefix] = useState<string>("");
  const [showPolicyExample, setShowPolicyExample] = useState(false);
  const [showCorsExample, setShowCorsExample] = useState(false);
  const [publicAccessSnapshot, setPublicAccessSnapshot] = useState<BucketPublicAccessBlock>(defaultPublicAccessBlock);
  const [notificationConfigSnapshot, setNotificationConfigSnapshot] = useState<Record<string, unknown>>({});
  const [bucketTagsSnapshot, setBucketTagsSnapshot] = useState<BucketTag[]>([]);
  const [quotaSizeGb, setQuotaSizeGb] = useState<string>("");
  const [quotaSizeUnit, setQuotaSizeUnit] = useState<"MiB" | "GiB" | "TiB">("GiB");
  const [quotaObjects, setQuotaObjects] = useState<string>("");
  const [quotaStatus, setQuotaStatus] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [updatingQuota, setUpdatingQuota] = useState(false);
  const [objectLockEnabled, setObjectLockEnabled] = useState<boolean | null>(null);
  const [objectLockMode, setObjectLockMode] = useState("");
  const [objectLockDays, setObjectLockDays] = useState("");
  const [objectLockYears, setObjectLockYears] = useState("");
  const [objectLockStatus, setObjectLockStatus] = useState<string | null>(null);
  const [objectLockError, setObjectLockError] = useState<string | null>(null);
  const [objectLockLoadError, setObjectLockLoadError] = useState<string | null>(null);
  const [objectLockLoading, setObjectLockLoading] = useState(false);
  const [savingObjectLock, setSavingObjectLock] = useState(false);
  const [objectLockConfig, setObjectLockConfig] = useState<BucketObjectLockConfiguration | null>(null);

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
  const quotaFeatureEnabled = isCephAdmin ? isCephEndpoint : Boolean(isCephEndpoint && managerBucketQuotaEnabled);
  const showQuotaTab = !hideQuotaTab && (isCephAdmin || Boolean(quotaFeatureEnabled && hasAccountContext));
  const showObjectsTab = !hideObjectsTab;
  const availableTabs = useMemo(() => {
    return resolveBucketDetailTabs({ mode, showObjectsTab, showQuotaTab });
  }, [mode, showObjectsTab, showQuotaTab]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0] ?? "overview");
    }
  }, [activeTab, availableTabs]);
  const staticWebsiteEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.static_website === true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.static_website === true;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
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
      setActiveTab("overview");
    }
  }, [activeTab, canViewBucketMetrics]);
  const notificationExample = `{
  "TopicConfigurations": [
    {
      "Id": "ObjectCreateAll",
      "TopicArn": "arn:aws:sns:default:${exampleS3AccountId}:example-topic",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            { "Name": "prefix", "Value": "uploads/" }
          ]
        }
      }
    }
  ]
}`;
  const userRole = getUserRole();
  const isAdmin = isAdminLikeRole(userRole);
  const canEditQuota =
    quotaFeatureEnabled &&
    ((isCephAdmin && isAdmin && hasCephContext) || (!isCephAdmin && hasAccountContext));
  const quotaSectionRestricted = quotaFeatureEnabled && !canEditQuota;
  const objectLockPersistentlyEnabled = (objectLockConfig?.enabled ?? null) === true;
  const objectLockActive = (objectLockEnabled ?? null) === true || objectLockPersistentlyEnabled;
  const versioningStatusRaw = (versioningStatus ?? "").trim();
  const versioningStatusNormalized = versioningStatusRaw.toLowerCase();
  const versioningIsEnabled = versioningStatusNormalized === "enabled";
  const versioningIsSuspended = versioningStatusNormalized === "suspended";
  const versioningDisableBlocked = objectLockActive && versioningIsEnabled;
  const objectLockFormId = "bucket-object-lock-form";
  const quotaFormId = "bucket-quota-form";

  useEffect(() => {
    setVersioningDraftEnabled(versioningIsEnabled);
  }, [versioningIsEnabled]);

  useEffect(() => {
    if (!bucket || !quotaFeatureEnabled) {
      setQuotaSizeGb("");
      setQuotaSizeUnit("GiB");
      setQuotaObjects("");
      setQuotaStatus(null);
      setQuotaError(null);
      return;
    }
    const toGbString = (bytes?: number | null) => {
      if (bytes === null || bytes === undefined || bytes <= 0) return "";
      const gb = bytes / (1024 ** 3);
      return gb % 1 === 0 ? String(gb) : gb.toFixed(1);
    };
    setQuotaSizeGb(toGbString(bucket.quota_max_size_bytes ?? null));
    setQuotaSizeUnit("GiB");
    const objects = bucket.quota_max_objects;
    setQuotaObjects(objects != null && objects > 0 ? String(objects) : "");
  }, [bucket, quotaFeatureEnabled]);

  const applyObjectLockState = useCallback((config?: BucketObjectLockConfiguration | null) => {
    if (!config) {
      setObjectLockEnabled(null);
      setObjectLockMode("");
      setObjectLockDays("");
      setObjectLockYears("");
      setObjectLockConfig(null);
      return;
    }
    setObjectLockEnabled(config.enabled ?? null);
    setObjectLockMode(config.mode ?? "");
    setObjectLockDays(config.days != null ? String(config.days) : "");
    setObjectLockYears(config.years != null ? String(config.years) : "");
    setObjectLockConfig(config);
  }, []);

  const applyWebsiteState = useCallback((config?: BucketWebsiteConfiguration | null) => {
    if (!config) {
      setWebsiteConfig(null);
      setWebsiteMode("hosting");
      setWebsiteIndexDocument("");
      setWebsiteErrorDocument("");
      setWebsiteRedirectHost("");
      setWebsiteRedirectProtocol("");
      setWebsiteRoutingRules("[]");
      return;
    }
    setWebsiteConfig(config);
    const redirect = config.redirect_all_requests_to ?? null;
    const redirectHost = redirect?.host_name ?? "";
    if (redirectHost) {
      setWebsiteMode("redirect");
      setWebsiteRedirectHost(redirectHost);
      setWebsiteRedirectProtocol(redirect?.protocol ?? "");
    } else {
      setWebsiteMode("hosting");
      setWebsiteRedirectHost("");
      setWebsiteRedirectProtocol("");
    }
    setWebsiteIndexDocument(config.index_document ?? "");
    setWebsiteErrorDocument(config.error_document ?? "");
    const rules = Array.isArray(config.routing_rules) ? config.routing_rules : [];
    setWebsiteRoutingRules(rules.length > 0 ? JSON.stringify(rules, null, 2) : "[]");
  }, []);

  const emptySimpleLifecycleRule = useCallback(
    (): SimpleLifecycleRule => ({
      id: "",
      prefix: "",
      expirationDays: "",
      noncurrentDays: "",
      multipartDays: "",
      tagKey: "",
      tagValue: "",
      deleteExpiredMarkers: false,
      status: "Enabled",
    }),
    []
  );

  const refreshBucketMeta = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setBucket(null);
      return;
    }
    setLoadingBucket(true);
    setBucketError(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) {
          setBucket(null);
          return;
        }
        const response = await listCephAdminBuckets(endpointId, {
          page: 1,
          page_size: 50,
          filter: bucketName,
          with_stats: usageFeatureEnabled,
        });
        const found = response.items.find((b) => b.name === bucketName) ?? null;
        setBucket(
          found
            ? {
                ...found,
                used_bytes: found.used_bytes ?? undefined,
                object_count: found.object_count ?? undefined,
              }
            : null,
        );
      } else {
        const data = await listBuckets(accountId, { with_stats: usageFeatureEnabled });
        const found = data.find((b) => b.name === bucketName) ?? null;
        setBucket(found);
      }
    } catch (err) {
      setBucketError(extractApiError(err, "Unable to load bucket details."));
    } finally {
      setLoadingBucket(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin, usageFeatureEnabled]);

  useEffect(() => {
    if (activeTab !== "overview" && activeTab !== "metrics") return;
    refreshBucketMeta();
  }, [activeTab, refreshBucketMeta]);

  const loadVersioning = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setVersioningStatus(null);
      setVersioningLoadError(null);
      setVersioningSaveError(null);
      return;
    }
    setVersioningLoading(true);
    setVersioningLoadError(null);
    setVersioningSaveError(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketVersioning(endpointId, bucketName)
          : { status: null, enabled: false }
        : await getBucketVersioning(accountId, bucketName);
      setVersioningStatus(data.status ?? null);
    } catch (err) {
      setVersioningStatus(null);
      setVersioningLoadError(extractApiError(err, "Unable to load bucket versioning."));
    } finally {
      setVersioningLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadObjectLock = useCallback(async () => {
    if (!bucketName || !hasContext) {
      applyObjectLockState(null);
      setObjectLockLoadError(null);
      setObjectLockError(null);
      setObjectLockStatus(null);
      return;
    }
    setObjectLockLoading(true);
    setObjectLockLoadError(null);
    setObjectLockError(null);
    setObjectLockStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketObjectLock(endpointId, bucketName)
          : null
        : await getBucketObjectLock(accountId, bucketName);
      applyObjectLockState(data);
    } catch (err) {
      applyObjectLockState(null);
      setObjectLockLoadError(extractApiError(err, "Unable to load Object Lock configuration."));
    } finally {
      setObjectLockLoading(false);
    }
  }, [accountId, applyObjectLockState, bucketName, endpointId, hasContext, isCephAdmin]);

  useEffect(() => {
    loadVersioning();
  }, [loadVersioning]);

  useEffect(() => {
    loadObjectLock();
  }, [loadObjectLock]);

  const loadLifecycle = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setLifecycle({ rules: [] });
      setLifecycleText("[]");
      setSimpleLifecycleRules([emptySimpleLifecycleRule()]);
      setSimpleLifecycleWarning(null);
      return;
    }
    setLifecycleLoading(true);
    setLifecycleError(null);
    setLifecycleStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketLifecycle(endpointId, bucketName)
          : { rules: [] }
        : await getBucketLifecycle(accountId, bucketName);
      const rules = data.rules ?? [];
      setLifecycle(data);
      setLifecycleText(rules.length > 0 ? JSON.stringify(rules, null, 2) : "[]");
      setSimpleLifecycleRules([emptySimpleLifecycleRule()]);
      setSimpleLifecycleWarning(
        rules.length > 0
          ? "Rules already exist. Use JSON mode to edit them. The form below only adds a new rule."
          : null
      );
    } catch (err) {
      setLifecycle({ rules: [] });
      setLifecycleText("");
      setSimpleLifecycleRules([emptySimpleLifecycleRule()]);
      setSimpleLifecycleWarning(null);
      setLifecycleError(extractApiError(err, "Unable to load lifecycle rules."));
    } finally {
      setLifecycleLoading(false);
    }
  }, [accountId, bucketName, emptySimpleLifecycleRule, endpointId, hasContext, isCephAdmin]);

  const loadPublicAccessBlock = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setPublicAccessBlock({ ...defaultPublicAccessBlock });
      setPublicAccessSnapshot({ ...defaultPublicAccessBlock });
      setPublicAccessError(null);
      setPublicAccessStatus(null);
      return;
    }
    setPublicAccessLoading(true);
    setPublicAccessError(null);
    setPublicAccessStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketPublicAccessBlock(endpointId, bucketName)
          : defaultPublicAccessBlock
        : await getBucketPublicAccessBlock(accountId, bucketName);
      setPublicAccessBlock({
        ...defaultPublicAccessBlock,
        block_public_acls: Boolean(data.block_public_acls),
        ignore_public_acls: Boolean(data.ignore_public_acls),
        block_public_policy: Boolean(data.block_public_policy),
        restrict_public_buckets: Boolean(data.restrict_public_buckets),
      });
      setPublicAccessSnapshot({
        ...defaultPublicAccessBlock,
        block_public_acls: Boolean(data.block_public_acls),
        ignore_public_acls: Boolean(data.ignore_public_acls),
        block_public_policy: Boolean(data.block_public_policy),
        restrict_public_buckets: Boolean(data.restrict_public_buckets),
      });
    } catch (err) {
      const message = extractApiError(err, "Unable to load public access block settings.");
      setPublicAccessError(message);
      setPublicAccessBlock({ ...defaultPublicAccessBlock });
      setPublicAccessSnapshot({ ...defaultPublicAccessBlock });
    } finally {
      setPublicAccessLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadNotifications = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setNotificationText(defaultNotificationTemplate);
      setNotificationConfigSnapshot({});
      return;
    }
    setNotificationsLoading(true);
    setNotificationsError(null);
    setNotificationsStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketNotifications(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketNotifications(accountId, bucketName);
      const rawConfig = data.configuration ?? {};
      const normalizedConfig = normalizeNotificationConfiguration(rawConfig);
      const hasConfig = Object.keys(normalizedConfig).length > 0;
      setNotificationText(hasConfig ? JSON.stringify(normalizedConfig, null, 2) : defaultNotificationTemplate);
      setNotificationConfigSnapshot(normalizedConfig);
    } catch (err) {
      setNotificationText(defaultNotificationTemplate);
      setNotificationConfigSnapshot({});
      setNotificationsError(extractApiError(err, "Unable to load bucket notifications."));
    } finally {
      setNotificationsLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadWebsite = useCallback(async () => {
    if (!bucketName || !hasContext || !staticWebsiteEnabled) {
      applyWebsiteState(null);
      setWebsiteError(null);
      setWebsiteStatus(null);
      return;
    }
    setWebsiteLoading(true);
    setWebsiteError(null);
    setWebsiteStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketWebsite(endpointId, bucketName)
          : null
        : await getBucketWebsite(accountId, bucketName);
      applyWebsiteState(data);
    } catch (err) {
      applyWebsiteState(null);
      setWebsiteError(extractApiError(err, "Unable to load bucket website configuration."));
    } finally {
      setWebsiteLoading(false);
    }
  }, [accountId, applyWebsiteState, bucketName, endpointId, hasContext, isCephAdmin, staticWebsiteEnabled]);

  const loadReplication = useCallback(async () => {
    if (!bucketName || !hasContext || !isCephEndpoint || !replicationFeatureEnabled) {
      setReplicationConfig({ configuration: {} });
      setReplicationText("{}");
      setReplicationRole("");
      setReplicationRules([createReplicationRuleDraft()]);
      setReplicationWarning(null);
      setReplicationError(null);
      setReplicationStatus(null);
      return;
    }
    setReplicationLoading(true);
    setReplicationError(null);
    setReplicationStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketReplication(endpointId, bucketName)
          : { configuration: {} }
        : await getBucketReplication(accountId, bucketName);
      const rawConfiguration = data.configuration;
      const configuration =
        rawConfiguration && typeof rawConfiguration === "object" && !Array.isArray(rawConfiguration)
          ? normalizeReplicationConfiguration(rawConfiguration as Record<string, unknown>)
          : {};
      setReplicationConfig({ configuration });
      setReplicationText(Object.keys(configuration).length > 0 ? JSON.stringify(configuration, null, 2) : "{}");
      const parsed = parseReplicationConfigurationForGraphical(configuration);
      setReplicationRole(parsed.role);
      setReplicationRules(parsed.rules.map((rule) => createReplicationRuleDraft(rule)));
      setReplicationWarning(
        parsed.hasAdvancedFields
          ? "This configuration has fields not covered by graphical mode. Use JSON mode to avoid losing data."
          : null
      );
    } catch (err) {
      setReplicationConfig({ configuration: {} });
      setReplicationText("{}");
      setReplicationRole("");
      setReplicationRules([createReplicationRuleDraft()]);
      setReplicationWarning(null);
      const message = extractApiError(err, "Unable to load bucket replication configuration.");
      setReplicationError(message);
    } finally {
      setReplicationLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin, isCephEndpoint, replicationFeatureEnabled]);

  const loadBucketAcl = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setBucketAcl(null);
      return;
    }
    setBucketAclLoading(true);
    setBucketAclError(null);
    setBucketAclStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketAcl(endpointId, bucketName)
          : null
        : await getBucketAcl(accountId, bucketName);
      setBucketAcl(data);
      const inferred = inferBucketAclPreset(data);
      setBucketAclPreset(inferred);
      setBucketAclCustom("");
    } catch (err) {
      setBucketAcl(null);
      setBucketAclError(extractApiError(err, "Unable to load bucket ACL."));
    } finally {
      setBucketAclLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadBucketTags = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setBucketTags([]);
      setBucketTagsSnapshot([]);
      setBucketTagsError(null);
      setBucketTagsStatus(null);
      return;
    }
    setBucketTagsLoading(true);
    setBucketTagsError(null);
    setBucketTagsStatus(null);
    try {
      const response = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketTags(endpointId, bucketName)
          : { tags: [] }
        : await getBucketTags(accountId, bucketName);
      const normalized = (response.tags ?? [])
        .map((tag) => ({
          key: String(tag.key ?? "").trim(),
          value: String(tag.value ?? ""),
        }))
        .filter((tag) => tag.key.length > 0);
      setBucketTags(normalized.map((tag) => createBucketTagDraft(tag)));
      setBucketTagsSnapshot(normalized);
    } catch (err) {
      const message = extractApiError(err, "Unable to load bucket tags.");
      setBucketTagsError(message);
      setBucketTags([]);
      setBucketTagsSnapshot([]);
    } finally {
      setBucketTagsLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadObjects = useCallback(
    async (prefix: string) => {
      if (!bucketName || !hasContext || (isCephAdmin && !endpointId)) return;
      setObjectsLoading(true);
      setObjectsError(null);
      try {
        const data = isCephAdmin
          ? await listCephAdminBucketObjects(endpointId!, bucketName, prefix)
          : await listObjects(accountId, bucketName, prefix);
        setObjects(
          data.objects.map((object) => ({
            ...object,
            last_modified: object.last_modified ?? undefined,
          }))
        );
        setPrefixes(data.prefixes);
      } catch (err) {
        setObjects([]);
        setPrefixes([]);
        setObjectsError(extractApiError(err, "Unable to list objects."));
      } finally {
        setObjectsLoading(false);
      }
    },
    [accountId, bucketName, endpointId, hasContext, isCephAdmin]
  );

  const loadUsageStats = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setUsageStatsSnapshot(null);
      setUsageStatsError(null);
      return;
    }
    setUsageStatsLoading(true);
    setUsageStatsError(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketUsageStats(endpointId, bucketName)
          : { snapshot: null }
        : await getManagerBucketUsageStats(accountId, bucketName);
      setUsageStatsSnapshot(data.snapshot ?? null);
    } catch (err) {
      setUsageStatsSnapshot(null);
      setUsageStatsError(extractApiError(err, "Unable to load bucket usage stats."));
    } finally {
      setUsageStatsLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const recalculateUsageStats = useCallback(async () => {
    if (!bucketName || !hasContext || usageStatsRecalculating) return;
    setUsageStatsRecalculating(true);
    setUsageStatsError(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await streamCephAdminBucketUsageStatsForBucket(endpointId, bucketName);
      } else {
        await streamManagerBucketUsageStatsForBucket(accountId, bucketName);
      }
      await loadUsageStats();
    } catch (err) {
      setUsageStatsError(extractApiError(err, "Unable to calculate bucket usage stats."));
    } finally {
      setUsageStatsRecalculating(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin, loadUsageStats, usageStatsRecalculating]);

  useEffect(() => {
    if (isCephAdmin) return;
    loadObjects(currentPrefix);
  }, [currentPrefix, isCephAdmin, loadObjects]);

  useEffect(() => {
    if (activeTab === "overview" || activeTab === "permissions") {
      loadPolicy();
      loadBucketAcl();
      loadPublicAccessBlock();
    }
    if (activeTab === "overview" || activeTab === "advanced") {
      loadCors();
      loadReplication();
    }
  }, [activeTab, loadBucketAcl, loadCors, loadPolicy, loadPublicAccessBlock, loadReplication]);

  useEffect(() => {
    if (activeTab === "properties") {
      loadLifecycle();
      loadBucketTags();
    }
  }, [activeTab, loadBucketTags, loadLifecycle]);

  useEffect(() => {
    if (activeTab === "usage-stats") {
      loadUsageStats();
    }
  }, [activeTab, loadUsageStats]);

  useEffect(() => {
    loadLifecycle();
  }, [loadLifecycle]);

  useEffect(() => {
    loadEncryption();
  }, [loadEncryption]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    loadAccessLogging();
  }, [loadAccessLogging]);

  useEffect(() => {
    loadWebsite();
  }, [loadWebsite]);

  useEffect(() => {
    loadReplication();
  }, [loadReplication]);

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
      ]);
      return;
    }
    if (activeTab === "metrics") {
      if (!canViewBucketMetrics) return;
      await refreshBucketMeta();
      return;
    }
    if (activeTab === "objects") {
      await loadObjects(currentPrefix);
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
    currentPrefix,
    loadAccessLogging,
    loadBucketAcl,
    loadBucketTags,
    loadCors,
    loadEncryption,
    loadLifecycle,
    loadUsageStats,
    loadNotifications,
    loadObjectLock,
    loadObjects,
    loadPolicy,
    loadPublicAccessBlock,
    loadReplication,
    loadVersioning,
    loadWebsite,
    refreshBucketMeta,
  ]);

  useEffect(() => {
    if (!hasContext || (isCephAdmin && activeTab !== "objects")) return;
    refreshActiveTab();
  }, [accessMode, activeTab, hasContext, isCephAdmin, refreshActiveTab]);

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

  const describeLifecycleActions = (rule: LifecycleRuleRecord): string => {
    const actions: string[] = [];
    const expiration = rule.Expiration as Record<string, unknown> | undefined;
    if (expiration?.Days != null) {
      actions.push(`Expire current objects after ${expiration.Days}d`);
    }
    if (expiration?.ExpiredObjectDeleteMarker) {
      actions.push("Delete expired delete markers");
    }
    const noncurrentExp = rule.NoncurrentVersionExpiration as Record<string, unknown> | undefined;
    if (noncurrentExp?.NoncurrentDays != null) {
      actions.push(`Expire noncurrent versions after ${noncurrentExp.NoncurrentDays}d`);
    }
    const multipart = rule.AbortIncompleteMultipartUpload as Record<string, unknown> | undefined;
    if (multipart?.DaysAfterInitiation != null) {
      actions.push(`Abort incomplete multipart uploads after ${multipart.DaysAfterInitiation}d`);
    }
    const transitions = Array.isArray(rule.Transitions) ? rule.Transitions : [];
    if (transitions.length > 0) {
      actions.push(`Transitions (${transitions.length})`);
    }
    const noncurrentTransitions = Array.isArray(rule.NoncurrentVersionTransitions) ? rule.NoncurrentVersionTransitions : [];
    if (noncurrentTransitions.length > 0) {
      actions.push(`Noncurrent transitions (${noncurrentTransitions.length})`);
    }
    if (actions.length === 0) return "No actions detected";
    return actions.join(" · ");
  };

  const persistLifecycleRules = useCallback(
    async (rules: Record<string, unknown>[]) => {
      if (!bucketName || !hasContext) return;
      setSavingLifecycle(true);
      setLifecycleError(null);
      setLifecycleStatus(null);
      try {
        if (rules.length === 0) {
          if (isCephAdmin) {
            if (!endpointId) return;
            await deleteCephAdminBucketLifecycle(endpointId, bucketName);
          } else {
            await deleteBucketLifecycle(accountId, bucketName);
          }
          setLifecycle({ rules: [] });
          setLifecycleText("[]");
          setSimpleLifecycleRules([emptySimpleLifecycleRule()]);
          setSimpleLifecycleWarning(null);
          setLifecycleStatus("Lifecycle deleted");
        } else {
          const saved = isCephAdmin
            ? endpointId
              ? await putCephAdminBucketLifecycle(endpointId, bucketName, rules)
              : { rules }
            : await putBucketLifecycle(accountId, bucketName, rules);
          const normalized = saved.rules ?? rules;
          setLifecycle({ rules: normalized });
          setLifecycleText(JSON.stringify(normalized, null, 2));
          setSimpleLifecycleRules([emptySimpleLifecycleRule()]);
          setSimpleLifecycleWarning(
            normalized.length > 0
              ? "Rules already exist. Use JSON mode to edit them. The form below only adds a new rule."
              : null
          );
          setLifecycleStatus("Lifecycle updated");
        }
      } catch (err) {
        const message = extractApiError(err, "Invalid or unsaved lifecycle.");
        setLifecycleError(message);
      } finally {
        setSavingLifecycle(false);
      }
    },
    [accountId, bucketName, emptySimpleLifecycleRule, endpointId, hasContext, isCephAdmin]
  );

  const updateLifecycleRules = async (updater: (rules: LifecycleRuleRecord[]) => LifecycleRuleRecord[]) => {
    if (!bucketName || !hasContext) return;
    const current = (lifecycle.rules ?? []) as LifecycleRuleRecord[];
    const next = updater(current);
    await persistLifecycleRules(next);
    await loadLifecycle();
  };

  const deleteRuleAt = async (index: number) => {
    await updateLifecycleRules((rules) => rules.filter((_, idx) => idx !== index));
  };

  const toggleRuleStatusAt = async (index: number) => {
    await updateLifecycleRules((rules) =>
      rules.map((rule, idx) => {
        if (idx !== index) return rule;
        const currentStatus = lifecycleRuleStatus(rule);
        return { ...rule, Status: currentStatus === "Enabled" ? "Disabled" : "Enabled" };
      })
    );
  };

  const handleAddExampleRule = async (rule: LifecycleRuleRecord) => {
    if (!bucketName || !hasContext) return;
    try {
      const current = lifecycle.rules ?? [];
      const ruleWithId = { ...rule, ID: lifecycleRuleId(rule) ?? randomLifecycleId() };
      const merged = [...current, ruleWithId];
      setLifecycleMode("json");
      setLifecycleText(JSON.stringify(merged, null, 2));
      await persistLifecycleRules(merged);
      setShowLifecycleEditor(true);
    } catch {
      setLifecycleError("Invalid or unreadable example.");
    }
  };

  const addExpirationExampleRule = () => {
    const currentDaysRaw = expireCurrentDays.trim();
    const noncurrentDaysRaw = expireNoncurrentDays.trim();
    if (!currentDaysRaw && !noncurrentDaysRaw) {
      setLifecycleError("Provide current or noncurrent expiration days.");
      return;
    }

    const rule: Record<string, unknown> = {
      Status: "Enabled",
      Filter: { Prefix: expirePrefix },
    };
    if (currentDaysRaw) {
      rule.Expiration = { Days: Number(currentDaysRaw) };
    }
    if (noncurrentDaysRaw) {
      rule.NoncurrentVersionExpiration = { NoncurrentDays: Number(noncurrentDaysRaw) };
    }
    void handleAddExampleRule(rule);
  };

  const [transitionCurrentDays, setTransitionCurrentDays] = useState("30");
  const [transitionNoncurrentDays, setTransitionNoncurrentDays] = useState("60");
  const [transitionStorageClass, setTransitionStorageClass] = useState("GLACIER");
  const [transitionPrefix, setTransitionPrefix] = useState("");
  const [expireCurrentDays, setExpireCurrentDays] = useState("");
  const [expireNoncurrentDays, setExpireNoncurrentDays] = useState("90");
  const [expirePrefix, setExpirePrefix] = useState("");

  const rowData: Row[] = useMemo(() => {
    const rows: Row[] = [];
    const normalizedPrefix = currentPrefix.endsWith("/") || currentPrefix === "" ? currentPrefix : `${currentPrefix}/`;
    prefixes.forEach((p) => {
      const name = p.slice(normalizedPrefix.length);
      rows.push({ type: "prefix", key: p, name: name || p });
    });
    objects.forEach((obj) => {
      rows.push({ type: "object", key: obj.key, name: obj.key.slice(normalizedPrefix.length), object: obj });
    });
    return rows;
  }, [currentPrefix, objects, prefixes]);

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

  const lifecycleRuleCount = lifecycle.rules?.length ?? 0;
  const hasLifecycleRules = lifecycleRuleCount > 0;
  const quotaConfigured = Boolean(
    (bucket?.quota_max_size_bytes ?? 0) > 0 || (bucket?.quota_max_objects ?? 0) > 0
  );
  const websiteRoutingRulesList = Array.isArray(websiteConfig?.routing_rules) ? websiteConfig?.routing_rules : [];
  const websiteConfigured = Boolean(
    (websiteConfig?.redirect_all_requests_to?.host_name ?? "").trim() ||
      (websiteConfig?.index_document ?? "").trim() ||
      websiteRoutingRulesList.length > 0
  );
  const replicationConfiguration = replicationConfig.configuration ?? {};
  const replicationConfigured = isReplicationConfigurationConfigured(replicationConfiguration);
  const replicationBusy = replicationLoading || savingReplication || clearingReplication;
  const replicationBlocked = !replicationFeatureEnabled;
  const publicAccessBlockConfig = publicAccessBlock;
  const publicAccessBlockEnabled = isPublicAccessFullyEnabled(publicAccessBlockConfig);
  const publicAccessBlockPartial =
    Boolean(publicAccessBlockConfig) &&
    !publicAccessBlockEnabled &&
    publicAccessKeys.some((key) => (publicAccessBlockConfig as Record<string, boolean | null | undefined>)[key] === true);
  const normalizedNotificationsSnapshot = normalizeNotificationConfiguration(notificationConfigSnapshot);
  const notificationsSnapshotSignature = stableBucketJsonSignature(normalizedNotificationsSnapshot);
  const notificationsDraftSignature = jsonTextSignature(
    notificationText,
    normalizedNotificationsSnapshot,
    normalizeNotificationConfiguration
  );
  const notificationsDirty = notificationsDraftSignature.signature !== notificationsSnapshotSignature;
  const notificationsConfigured = Object.keys(normalizedNotificationsSnapshot).length > 0;
  const websiteRoutingDraftSignature = jsonTextSignature(
    websiteRoutingRules,
    Array.isArray(websiteConfig?.routing_rules) ? websiteConfig?.routing_rules : []
  );
  const websiteDraftSignature = stableBucketJsonSignature({
    mode: websiteMode,
    index_document: websiteIndexDocument.trim(),
    error_document: websiteErrorDocument.trim(),
    redirect_host: websiteRedirectHost.trim(),
    redirect_protocol: websiteRedirectProtocol.trim(),
    routing_rules:
      websiteMode === "hosting" ? websiteRoutingDraftSignature.signature : stableBucketJsonSignature([] as Record<string, unknown>[]),
  });
  const websiteSnapshotSignature = stableBucketJsonSignature({
    mode: (websiteConfig?.redirect_all_requests_to?.host_name ?? "").trim() ? "redirect" : "hosting",
    index_document: (websiteConfig?.index_document ?? "").trim(),
    error_document: (websiteConfig?.error_document ?? "").trim(),
    redirect_host: (websiteConfig?.redirect_all_requests_to?.host_name ?? "").trim(),
    redirect_protocol: (websiteConfig?.redirect_all_requests_to?.protocol ?? "").trim(),
    routing_rules: stableBucketJsonSignature(Array.isArray(websiteConfig?.routing_rules) ? websiteConfig?.routing_rules : []),
  });
  const websiteDirty = websiteDraftSignature !== websiteSnapshotSignature;
  const replicationGraphicalSnapshot = parseReplicationConfigurationForGraphical(replicationConfiguration);
  const replicationJsonDraftSignature = jsonTextSignature(replicationText, replicationConfiguration);
  const replicationGraphicalDraftSignature = stableBucketJsonSignature(
    normalizeReplicationGraphicalDraft(replicationRole, replicationRules)
  );
  const replicationGraphicalSnapshotSignature = stableBucketJsonSignature(
    normalizeReplicationGraphicalDraft(
      replicationGraphicalSnapshot.role,
      replicationGraphicalSnapshot.rules
    )
  );
  const replicationDirty =
    replicationMode === "json"
      ? replicationJsonDraftSignature.signature !== stableBucketJsonSignature(replicationConfiguration)
      : replicationGraphicalDraftSignature !== replicationGraphicalSnapshotSignature;
  const lifecycleJsonDraftSignature = jsonTextSignature(lifecycleText, lifecycle.rules ?? []);
  const lifecycleJsonDirty = lifecycleJsonDraftSignature.signature !== stableBucketJsonSignature(lifecycle.rules ?? []);
  const lifecycleSimpleDraft = simpleLifecycleRules[0] ?? {
    id: "",
    prefix: "",
    expirationDays: "",
    noncurrentDays: "",
    multipartDays: "",
    tagKey: "",
    tagValue: "",
    deleteExpiredMarkers: false,
    status: "Enabled" as const,
  };
  const lifecycleSimpleDirty = !isLifecycleSimpleDraftEmpty(lifecycleSimpleDraft);
  const lifecycleDirty = lifecycleMode === "json" ? lifecycleJsonDirty : lifecycleSimpleDirty;
  const publicAccessDraftSignature = stableBucketJsonSignature(normalizePublicAccessDraft(publicAccessBlock));
  const publicAccessSnapshotSignature = stableBucketJsonSignature(normalizePublicAccessDraft(publicAccessSnapshot));
  const publicAccessDirty = publicAccessDraftSignature !== publicAccessSnapshotSignature;
  const aclDraftSignature = stableBucketJsonSignature(normalizeAclDraft(bucketAclPreset, bucketAclCustom));
  const aclSnapshotSignature = stableBucketJsonSignature(normalizeAclDraft(inferBucketAclPreset(bucketAcl), ""));
  const aclDirty = aclDraftSignature !== aclSnapshotSignature;
  const tagsDraftSignature = stableBucketJsonSignature(normalizeBucketTagsDraft(bucketTags));
  const tagsSnapshotSignature = stableBucketJsonSignature(normalizeBucketTagsDraft(bucketTagsSnapshot));
  const tagsDirty = tagsDraftSignature !== tagsSnapshotSignature;
  const objectLockDraftSignature = stableBucketJsonSignature({
    enabled: objectLockEnabled ?? null,
    mode: objectLockMode.trim(),
    days: objectLockDays.trim(),
    years: objectLockYears.trim(),
  });
  const objectLockSnapshotSignature = stableBucketJsonSignature({
    enabled: objectLockConfig?.enabled ?? null,
    mode: (objectLockConfig?.mode ?? "").trim(),
    days: objectLockConfig?.days != null ? String(objectLockConfig.days) : "",
    years: objectLockConfig?.years != null ? String(objectLockConfig.years) : "",
  });
  const objectLockDirty = objectLockDraftSignature !== objectLockSnapshotSignature;
  const quotaSnapshotSignature = stableBucketJsonSignature(
    normalizeQuotaDraft(
      (() => {
        const bytes = bucket?.quota_max_size_bytes ?? null;
        if (bytes == null || bytes <= 0) return "";
        const divider = quotaSizeUnit === "MiB" ? 1024 ** 2 : quotaSizeUnit === "GiB" ? 1024 ** 3 : 1024 ** 4;
        const value = bytes / divider;
        return value % 1 === 0 ? String(value) : value.toFixed(1);
      })(),
      quotaSizeUnit,
      (bucket?.quota_max_objects ?? 0) > 0 ? String(bucket?.quota_max_objects) : ""
    )
  );
  const quotaDraftSignature = stableBucketJsonSignature(normalizeQuotaDraft(quotaSizeGb, quotaSizeUnit, quotaObjects));
  const quotaDirty = quotaDraftSignature !== quotaSnapshotSignature;
  const versioningDirty = versioningDraftEnabled !== versioningIsEnabled;
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
    configured: bucketTags.length > 0,
    unsaved: tagsDirty,
  });
  const publicAccessCardState = resolveFeatureVisualState({
    disabled: publicAccessNotImplemented,
    configured: publicAccessBlockEnabled || publicAccessBlockPartial,
    unsaved: publicAccessDirty,
  });
  const aclCardState = resolveFeatureVisualState({
    disabled: aclNotImplemented,
    configured: inferBucketAclPreset(bucketAcl) !== "private",
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

  const handleTogglePublicAccessField = (key: keyof BucketPublicAccessBlock, value: boolean) => {
    setPublicAccessBlock((prev) => ({
      ...defaultPublicAccessBlock,
      ...prev,
      [key]: value,
    }));
  };

  const saveVersioning = async () => {
    if (!bucketName || !hasContext || versioningLoading || versioningLoadError) return;
    if (versioningDisableBlocked && !versioningDraftEnabled) return;
    if (versioningDraftEnabled === versioningIsEnabled) return;
    setUpdatingVersioning(true);
    setVersioningSaveError(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await setCephAdminBucketVersioning(endpointId, bucketName, versioningDraftEnabled);
      } else {
        await setBucketVersioning(accountId, bucketName, versioningDraftEnabled);
      }
      await loadVersioning();
    } catch (err) {
      setVersioningSaveError(extractApiError(err, "Failed to update versioning."));
    } finally {
      setUpdatingVersioning(false);
    }
  };

  const savePublicAccessBlock = async () => {
    if (!bucketName || !hasContext) return;
    setSavingPublicAccess(true);
    setPublicAccessError(null);
    setPublicAccessStatus(null);
    const payload: BucketPublicAccessBlock = {
      block_public_acls: Boolean(publicAccessBlock.block_public_acls),
      ignore_public_acls: Boolean(publicAccessBlock.ignore_public_acls),
      block_public_policy: Boolean(publicAccessBlock.block_public_policy),
      restrict_public_buckets: Boolean(publicAccessBlock.restrict_public_buckets),
    };
    try {
      const saved = isCephAdmin
        ? endpointId
          ? await updateCephAdminBucketPublicAccessBlock(endpointId, bucketName, payload)
          : payload
        : await updateBucketPublicAccessBlock(accountId, bucketName, payload);
      setPublicAccessBlock({
        ...defaultPublicAccessBlock,
        block_public_acls: Boolean(saved.block_public_acls),
        ignore_public_acls: Boolean(saved.ignore_public_acls),
        block_public_policy: Boolean(saved.block_public_policy),
        restrict_public_buckets: Boolean(saved.restrict_public_buckets),
      });
      setPublicAccessSnapshot({
        ...defaultPublicAccessBlock,
        block_public_acls: Boolean(saved.block_public_acls),
        ignore_public_acls: Boolean(saved.ignore_public_acls),
        block_public_policy: Boolean(saved.block_public_policy),
        restrict_public_buckets: Boolean(saved.restrict_public_buckets),
      });
      setPublicAccessStatus("Public access block updated.");
    } catch (err) {
      const message = extractApiError(err, "Unable to update public access block.");
      setPublicAccessError(message);
    } finally {
      setSavingPublicAccess(false);
    }
  };

  const updateBucketTag = (uiId: string, patch: Partial<BucketTag>) => {
    setBucketTags((prev) => prev.map((tag) => (tag.uiId === uiId ? { ...tag, ...patch } : tag)));
  };

  const addBucketTag = () => {
    setBucketTags((prev) => [...prev, createBucketTagDraft()]);
    setBucketTagsStatus(null);
    setBucketTagsError(null);
  };

  const removeBucketTag = (uiId: string) => {
    setBucketTags((prev) => prev.filter((tag) => tag.uiId !== uiId));
    setBucketTagsStatus(null);
    setBucketTagsError(null);
  };

  const saveBucketTags = async () => {
    if (!bucketName || !hasContext) return;
    setSavingBucketTags(true);
    setBucketTagsError(null);
    setBucketTagsStatus(null);
    try {
      const normalized = bucketTags.map((tag) => ({
        key: String(tag.key ?? "").trim(),
        value: String(tag.value ?? "").trim(),
      }));
      const hasKeylessValue = normalized.some((tag) => !tag.key && tag.value.length > 0);
      if (hasKeylessValue) {
        throw new Error("Tag key is required when a value is provided.");
      }
      const filtered = normalized.filter((tag) => tag.key.length > 0);
      const seen = new Set<string>();
      for (const tag of filtered) {
        if (seen.has(tag.key)) {
          throw new Error(`Duplicate tag key: ${tag.key}`);
        }
        seen.add(tag.key);
      }

      if (filtered.length === 0) {
        if (isCephAdmin) {
          if (!endpointId) return;
          await deleteCephAdminBucketTags(endpointId, bucketName);
        } else {
          await deleteBucketTags(accountId, bucketName);
        }
        setBucketTags([]);
        setBucketTagsSnapshot([]);
        setBucketTagsStatus("Bucket tags cleared.");
      } else {
        if (isCephAdmin) {
          if (!endpointId) return;
          await putCephAdminBucketTags(endpointId, bucketName, filtered);
        } else {
          await putBucketTags(accountId, bucketName, filtered);
        }
        setBucketTags(filtered.map((tag) => createBucketTagDraft(tag)));
        setBucketTagsSnapshot(filtered);
        setBucketTagsStatus("Bucket tags updated.");
      }
    } catch (err) {
      const message = extractApiError(err, "Unable to update bucket tags.");
      setBucketTagsError(message);
    } finally {
      setSavingBucketTags(false);
    }
  };

  const clearBucketTags = async () => {
    if (!bucketName || !hasContext) return;
    setDeletingBucketTags(true);
    setBucketTagsError(null);
    setBucketTagsStatus(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketTags(endpointId, bucketName);
      } else {
        await deleteBucketTags(accountId, bucketName);
      }
      setBucketTags([]);
      setBucketTagsSnapshot([]);
      setBucketTagsStatus("Bucket tags cleared.");
    } catch (err) {
      const message = extractApiError(err, "Unable to clear bucket tags.");
      setBucketTagsError(message);
    } finally {
      setDeletingBucketTags(false);
    }
  };

  const saveNotifications = async () => {
    if (!bucketName || !hasContext) return;
    let parsed: Record<string, unknown>;
    setNotificationsError(null);
    setNotificationsStatus(null);
    try {
      parsed = notificationText.trim() ? JSON.parse(notificationText) : {};
    } catch {
      setNotificationsError("Notifications must be valid JSON.");
      return;
    }
    setSavingNotifications(true);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await putCephAdminBucketNotifications(endpointId, bucketName, parsed);
      } else {
        await putBucketNotifications(accountId, bucketName, parsed);
      }
      setNotificationsStatus("Notifications updated.");
      await loadNotifications();
    } catch (err) {
      setNotificationsError(extractApiError(err, "Unable to update bucket notifications."));
    } finally {
      setSavingNotifications(false);
    }
  };

  const clearNotifications = async () => {
    if (!bucketName || !hasContext) return;
    setClearingNotifications(true);
    setNotificationsError(null);
    setNotificationsStatus(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketNotifications(endpointId, bucketName);
      } else {
        await deleteBucketNotifications(accountId, bucketName);
      }
      await loadNotifications();
      setNotificationsStatus("Notifications cleared.");
    } catch (err) {
      setNotificationsError(extractApiError(err, "Unable to delete bucket notifications."));
    } finally {
      setClearingNotifications(false);
    }
  };

  const updateReplicationRule = (uiId: string, patch: Partial<GraphicalReplicationRule>) => {
    setReplicationRules((prev) =>
      prev.map((rule) => (rule.uiId === uiId ? { ...rule, ...patch } : rule))
    );
    setReplicationStatus(null);
  };

  const addReplicationRule = () => {
    setReplicationRules((prev) => [...prev, createReplicationRuleDraft()]);
    setReplicationStatus(null);
  };

  const removeReplicationRule = (uiId: string) => {
    setReplicationRules((prev) => {
      const next = prev.filter((rule) => rule.uiId !== uiId);
      return next.length > 0 ? next : [createReplicationRuleDraft()];
    });
    setReplicationStatus(null);
  };

  const saveReplication = async () => {
    if (!bucketName || !hasContext || !isCephEndpoint || !replicationFeatureEnabled) return;
    setReplicationError(null);
    setReplicationStatus(null);

    let configuration: Record<string, unknown>;
    if (replicationMode === "graphical") {
      const validationError = validateGraphicalReplication(replicationRole, replicationRules);
      if (validationError) {
        setReplicationError(validationError);
        return;
      }
      configuration = buildReplicationConfigurationFromGraphical(replicationRole, replicationRules);
    } else {
      let parsed: unknown;
      try {
        parsed = replicationText.trim() ? JSON.parse(replicationText) : {};
      } catch {
        setReplicationError("Replication configuration JSON is invalid.");
        return;
      }
      const validationError = validateJsonReplicationConfiguration(parsed);
      if (validationError) {
        setReplicationError(validationError);
        return;
      }
      configuration = parsed as Record<string, unknown>;
    }

    setSavingReplication(true);
    try {
      const saved = isCephAdmin
        ? endpointId
          ? await putCephAdminBucketReplication(endpointId, bucketName, configuration)
          : { configuration }
        : await putBucketReplication(accountId, bucketName, configuration);
      const rawConfiguration = saved.configuration;
      const normalizedConfiguration =
        rawConfiguration && typeof rawConfiguration === "object" && !Array.isArray(rawConfiguration)
          ? normalizeReplicationConfiguration(rawConfiguration as Record<string, unknown>)
          : {};
      setReplicationConfig({ configuration: normalizedConfiguration });
      setReplicationText(
        Object.keys(normalizedConfiguration).length > 0 ? JSON.stringify(normalizedConfiguration, null, 2) : "{}"
      );
      const parsed = parseReplicationConfigurationForGraphical(normalizedConfiguration);
      setReplicationRole(parsed.role);
      setReplicationRules(parsed.rules.map((rule) => createReplicationRuleDraft(rule)));
      setReplicationWarning(
        parsed.hasAdvancedFields
          ? "This configuration has fields not covered by graphical mode. Use JSON mode to avoid losing data."
          : null
      );
      setReplicationStatus("Replication configuration updated.");
    } catch (err) {
      const message = extractApiError(err, "Unable to update bucket replication configuration.");
      setReplicationError(message);
    } finally {
      setSavingReplication(false);
    }
  };

  const clearReplication = async () => {
    if (!bucketName || !hasContext || !isCephEndpoint || !replicationFeatureEnabled) return;
    setClearingReplication(true);
    setReplicationError(null);
    setReplicationStatus(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketReplication(endpointId, bucketName);
      } else {
        await deleteBucketReplication(accountId, bucketName);
      }
      setReplicationConfig({ configuration: {} });
      setReplicationText("{}");
      setReplicationRole("");
      setReplicationRules([createReplicationRuleDraft()]);
      setReplicationWarning(null);
      setReplicationStatus("Replication configuration cleared.");
    } catch (err) {
      const message = extractApiError(err, "Unable to clear bucket replication configuration.");
      setReplicationError(message);
    } finally {
      setClearingReplication(false);
    }
  };

  const saveBucketAcl = async () => {
    if (!bucketName || !hasContext) return;
    const aclValue = bucketAclPreset === "custom" ? bucketAclCustom.trim() : bucketAclPreset;
    if (!aclValue) {
      setBucketAclError("ACL value is required.");
      return;
    }
    setSavingBucketAcl(true);
    setBucketAclError(null);
    setBucketAclStatus(null);
    try {
      const updated = isCephAdmin
        ? endpointId
          ? await updateCephAdminBucketAcl(endpointId, bucketName, aclValue)
          : null
        : await updateBucketAcl(accountId, bucketName, aclValue);
      setBucketAcl(updated);
      setBucketAclStatus("Bucket ACL updated.");
      const inferred = inferBucketAclPreset(updated);
      setBucketAclPreset(inferred);
      if (inferred !== "custom") {
        setBucketAclCustom("");
      }
    } catch (err) {
      const message = extractApiError(err, "Unable to update bucket ACL.");
      setBucketAclError(message);
    } finally {
      setSavingBucketAcl(false);
    }
  };

  const saveWebsite = async () => {
    if (!bucketName || !hasContext || !staticWebsiteEnabled) return;
    setWebsiteError(null);
    setWebsiteStatus(null);

    const mode = websiteMode;
    const indexDocument = websiteIndexDocument.trim();
    const errorDocument = websiteErrorDocument.trim();
    const redirectHost = websiteRedirectHost.trim();
    const redirectProtocol = websiteRedirectProtocol.trim();

    if (mode === "redirect" && !redirectHost) {
      setWebsiteError("Redirect hostname is required.");
      return;
    }
    if (mode === "hosting" && !indexDocument) {
      setWebsiteError("Index document is required.");
      return;
    }

    let routingRules: Record<string, unknown>[] = [];
    if (mode === "hosting") {
      if (websiteRoutingRules.trim()) {
        try {
          const parsed = JSON.parse(websiteRoutingRules);
          if (!Array.isArray(parsed)) {
            setWebsiteError("Routing rules must be a JSON array.");
            return;
          }
          routingRules = parsed as Record<string, unknown>[];
        } catch {
          setWebsiteError("Routing rules must be valid JSON.");
          return;
        }
      }
    }

    setSavingWebsite(true);
    try {
      const payload: BucketWebsiteConfiguration = {
        index_document: mode === "hosting" ? indexDocument : null,
        error_document: mode === "hosting" ? (errorDocument || null) : null,
        redirect_all_requests_to:
          mode === "redirect"
            ? {
                host_name: redirectHost,
                protocol: redirectProtocol || undefined,
              }
            : null,
        routing_rules: mode === "hosting" ? routingRules : [],
      };
      const saved = isCephAdmin
        ? endpointId
          ? await putCephAdminBucketWebsite(endpointId, bucketName, payload)
          : payload
        : await putBucketWebsite(accountId, bucketName, payload);
      applyWebsiteState(saved);
      setWebsiteStatus("Website configuration updated.");
    } catch (err) {
      const message = extractApiError(err, "Unable to update website configuration.");
      setWebsiteError(message);
    } finally {
      setSavingWebsite(false);
    }
  };

  const clearWebsite = async () => {
    if (!bucketName || !hasContext || !staticWebsiteEnabled) return;
    setClearingWebsite(true);
    setWebsiteError(null);
    setWebsiteStatus(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketWebsite(endpointId, bucketName);
      } else {
        await deleteBucketWebsite(accountId, bucketName);
      }
      applyWebsiteState(null);
      setWebsiteStatus("Website configuration cleared.");
    } catch (err) {
      setWebsiteError(extractApiError(err, "Unable to delete website configuration."));
    } finally {
      setClearingWebsite(false);
    }
  };

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

  const saveLifecycle = async () => {
    if (!bucketName || !hasContext) return;
    try {
      let payloadRules: Record<string, unknown>[] = [];
      if (lifecycleMode === "json") {
        const parsed = lifecycleText.trim() ? JSON.parse(lifecycleText) : [];
        if (!Array.isArray(parsed)) {
          throw new Error("JSON must be an array of rules.");
        }
        payloadRules = parsed as Record<string, unknown>[];
      } else {
        const rule = simpleLifecycleRules[0];
        const hasExpiration = rule.expirationDays.trim() !== "";
        const hasNoncurrent = rule.noncurrentDays.trim() !== "";
        const hasMultipart = rule.multipartDays.trim() !== "";
        const hasDeleteMarkers = rule.deleteExpiredMarkers;
        if (!hasExpiration && !hasNoncurrent && !hasMultipart && !hasDeleteMarkers) {
          throw new Error("Add at least one action (expiration, noncurrent, multipart, delete marker).");
        }
        if (hasDeleteMarkers && (hasExpiration || hasNoncurrent || hasMultipart)) {
          throw new Error("Deleting markers cannot be combined with other actions in simple mode.");
        }

        const tagKey = rule.tagKey.trim();
        const tagValue = rule.tagValue.trim();
        if ((tagKey && !tagValue) || (!tagKey && tagValue)) {
          throw new Error("Fill both the tag key and value or leave both empty.");
        }

        const days = hasExpiration ? Number(rule.expirationDays) : null;
        const noncurrentDays = hasNoncurrent ? Number(rule.noncurrentDays) : null;
        const multipartDays = hasMultipart ? Number(rule.multipartDays) : null;
        if ((days !== null && (Number.isNaN(days) || days <= 0)) || (noncurrentDays !== null && (Number.isNaN(noncurrentDays) || noncurrentDays <= 0))) {
          throw new Error("Invalid expiration duration: provide a number of days > 0.");
        }
        if (multipartDays !== null && (Number.isNaN(multipartDays) || multipartDays <= 0)) {
          throw new Error("Multipart upload duration must be > 0.");
        }

        const filterPrefix = rule.prefix ?? "";
        let filter: Record<string, unknown> | undefined;
        if (tagKey && tagValue && filterPrefix) {
          filter = { And: { Prefix: filterPrefix, Tags: [{ Key: tagKey, Value: tagValue }] } };
        } else if (tagKey && tagValue) {
          filter = { Tag: { Key: tagKey, Value: tagValue } };
        } else if (filterPrefix) {
          filter = { Prefix: filterPrefix };
        } else {
          filter = { Prefix: "" };
        }

        const normalized: Record<string, unknown> = {
          Status: rule.status,
          Filter: filter,
        };
        if (days !== null) {
          normalized.Expiration = { Days: days };
        }
        if (noncurrentDays !== null) {
          normalized.NoncurrentVersionExpiration = { NoncurrentDays: noncurrentDays };
        }
        if (multipartDays !== null) {
          normalized.AbortIncompleteMultipartUpload = { DaysAfterInitiation: multipartDays };
        }
        if (hasDeleteMarkers) {
          normalized.Expiration = { ExpiredObjectDeleteMarker: true };
        }
        if (rule.id.trim()) {
          normalized.ID = rule.id.trim();
        }

        const existing = lifecycle.rules ?? [];
        payloadRules = [...existing, normalized];
      }
      await persistLifecycleRules(payloadRules);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid or unsaved lifecycle.";
      setLifecycleError(message);
    }
  };

  const parentPrefix = useMemo(() => {
    if (!currentPrefix) return "";
    const parts = currentPrefix.split("/").filter(Boolean);
    parts.pop();
    return parts.length > 0 ? parts.join("/") + "/" : "";
  }, [currentPrefix]);

  const handleUpdateQuota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bucketName || !canEditQuota) return;
    setUpdatingQuota(true);
    setQuotaStatus(null);
    setQuotaError(null);
    try {
      const maxSizeGb = quotaSizeGb.trim() === "" ? null : Number(quotaSizeGb);
      const maxObjects = quotaObjects.trim() === "" ? null : Number(quotaObjects);
      if (
        (maxSizeGb !== null && Number.isNaN(maxSizeGb)) ||
        (maxObjects !== null && Number.isNaN(maxObjects)) ||
        (maxSizeGb !== null && maxSizeGb < 0) ||
        (maxObjects !== null && maxObjects < 0)
      ) {
        setQuotaError("Invalid quota values.");
        setUpdatingQuota(false);
        return;
      }
      const payload = {
        max_size_gb: maxSizeGb ?? undefined,
        max_size_unit: maxSizeGb != null ? quotaSizeUnit : undefined,
        max_objects: maxObjects ?? undefined,
      };
      if (isCephAdmin) {
        if (!endpointId) return;
        await updateCephAdminBucketQuota(endpointId, bucketName, payload);
      } else {
        if (!accountId) return;
        await updateBucketQuota(accountId, bucketName, payload);
      }
      setQuotaStatus("Quota updated");
      await refreshBucketMeta();
    } catch (err) {
      setQuotaError(extractApiError(err, "Unable to update the quota."));
    } finally {
      setUpdatingQuota(false);
    }
  };

  const handleSaveObjectLock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bucketName || !hasContext || objectLockLoading || objectLockLoadError) return;
    setSavingObjectLock(true);
    setObjectLockStatus(null);
    setObjectLockError(null);
    const parsedDays = objectLockDays.trim() === "" ? null : Number(objectLockDays);
    const parsedYears = objectLockYears.trim() === "" ? null : Number(objectLockYears);
    if ((parsedDays !== null && Number.isNaN(parsedDays)) || (parsedYears !== null && Number.isNaN(parsedYears))) {
      setObjectLockError("Invalid default retention values.");
      setSavingObjectLock(false);
      return;
    }
    if (parsedDays !== null && parsedYears !== null) {
      setObjectLockError("Choose days or years, not both.");
      setSavingObjectLock(false);
      return;
    }
    if ((parsedDays !== null || parsedYears !== null) && !objectLockMode) {
      setObjectLockError("Mode is required to define the default retention.");
      setSavingObjectLock(false);
      return;
    }
    if (objectLockMode && parsedDays === null && parsedYears === null) {
      setObjectLockError("Provide a duration (days or years) or clear the mode to remove the rule.");
      setSavingObjectLock(false);
      return;
    }
    try {
      const enablingObjectLock = objectLockEnabled === true;
      if (enablingObjectLock && !versioningIsEnabled) {
        if (isCephAdmin) {
          if (!endpointId) {
            setObjectLockError("Select a Ceph endpoint before saving Object Lock.");
            return;
          }
          await setCephAdminBucketVersioning(endpointId, bucketName, true);
        } else {
          await setBucketVersioning(accountId, bucketName, true);
        }
        setVersioningDraftEnabled(true);
        setVersioningStatus("Enabled");
      }

      const payload = {
        enabled: objectLockEnabled,
        mode: objectLockMode || null,
        days: parsedDays,
        years: parsedYears,
      };
      const updated = isCephAdmin
        ? endpointId
          ? await updateCephAdminBucketObjectLock(endpointId, bucketName, payload)
          : null
        : await updateBucketObjectLock(accountId, bucketName, payload);
      if (!updated) {
        setObjectLockError("Unable to update the Object Lock configuration.");
        return;
      }
      applyObjectLockState(updated);
      setObjectLockStatus("Object Lock updated");
      await Promise.all([loadVersioning(), loadObjectLock()]);
    } catch (err) {
      setObjectLockError(extractApiError(err, "Unable to update the Object Lock configuration."));
    } finally {
      setSavingObjectLock(false);
    }
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
    <div className="space-y-4">
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
        onChange={(id) => setActiveTab(id as BucketDetailTabId)}
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
                <header className="space-y-1">
                  <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {bucketName ? `Bucket ${bucketName}` : "Bucket overview"}
                  </h3>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{bucketOwner ?? (loadingBucket || bucketAclLoading ? "Loading..." : "Unknown")}</span>
                  </p>
                </header>
                <div className="grid gap-3 md:grid-cols-2">
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
                    <div className="space-y-1">
                      <button
                        className={`flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption ${
                          currentPrefix === ""
                            ? "bg-primary-100/70 text-primary-800 dark:bg-primary-500/20 dark:text-primary-100"
                            : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                        }`}
                        onClick={() => setCurrentPrefix("")}
                      >
                        <span>(root)</span>
                      </button>
                      {parentPrefix !== "" && (
                        <button
                          className="flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left ui-caption text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
                          onClick={() => setCurrentPrefix(parentPrefix)}
                        >
                          <span>⬆️ Up</span>
                          <span className="ui-caption text-slate-500 dark:text-slate-400">{parentPrefix || "/"}</span>
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
                            onClick={() => setCurrentPrefix(prefix)}
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
                      <div className="space-y-1">
                        <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Path</p>
                        <div className="ui-caption text-slate-500 dark:text-slate-300">
                          {bucketName}/{currentPrefix || "(root)"}
                        </div>
                        <div className="ui-caption text-slate-500 dark:text-slate-400">
                          {isCephAdmin
                            ? "Read-only preview using the selected endpoint's Ceph Admin credentials."
                            : "Read-only preview. Use the main Browser page for object operations."}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadObjects(currentPrefix)}
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
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Name
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Size
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Last modified
                            </th>
                            <th className="px-4 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              Storage class
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                          {objectsLoading && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                Loading objects...
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && rowData.length === 0 && (
                            <tr>
                              <td colSpan={4} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                No objects in this prefix.
                              </td>
                            </tr>
                          )}
                          {!objectsLoading &&
                            rowData.map((row) => {
                              if (row.type === "prefix") {
                                return (
                                  <tr
                                    key={row.key}
                                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    onClick={() => setCurrentPrefix(row.key)}
                                  >
                                    <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                      📁 {row.name}
                                    </td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                  </tr>
                                );
                              }
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">{row.name}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{formatBytes(row.object.size)}</td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">
                                    {row.object.last_modified ? new Date(row.object.last_modified).toLocaleString() : "-"}
                                  </td>
                                  <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{row.object.storage_class ?? "-"}</td>
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
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
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
                        onClick={saveVersioning}
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
                    <div className="space-y-2">
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
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
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
                            onChange={(checked) => {
                              setVersioningDraftEnabled(checked);
                              setVersioningSaveError(null);
                            }}
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
                      <div className="flex gap-2">
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
                        <span className="ui-caption text-slate-500 dark:text-slate-400">
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
                          onClick={() => applyObjectLockState(objectLockConfig)}
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
                    <div className="space-y-2">
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
                      <form id={objectLockFormId} className="space-y-2" onSubmit={handleSaveObjectLock}>
                        <div className="flex items-start justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Enable Object Lock</p>
                            <p className="ui-caption text-slate-500 dark:text-slate-400">
                              Write-once retention controls for bucket objects.
                            </p>
                          </div>
                          <PortalSettingsSwitch
                            checked={objectLockEnabled ?? false}
                            disabled={objectLockPersistentlyEnabled || objectLockLoading || Boolean(objectLockLoadError) || objectLockNotImplemented}
                            ariaLabel="Enable object lock"
                            onChange={(checked) => {
                              if (objectLockPersistentlyEnabled) return;
                              setObjectLockEnabled(checked);
                              if (checked) {
                                setVersioningDraftEnabled(true);
                              }
                            }}
                          />
                        </div>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Enabling Object Lock automatically enables bucket versioning.
                        </p>
                        {objectLockPersistentlyEnabled && (
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
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
                              onChange={(e) => setObjectLockMode(e.target.value)}
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
                              onChange={(e) => setObjectLockDays(e.target.value)}
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
                              onChange={(e) => setObjectLockYears(e.target.value)}
                              className={bucketFeatureInputClass}
                              placeholder="e.g. 1"
                              disabled={objectLockNotImplemented}
                            />
                          </label>
                        </div>
                        {objectLockConfig?.mode && (objectLockConfig.days != null || objectLockConfig.years != null) && (
                          <p className="ui-caption text-slate-600 dark:text-slate-300">
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
                          <span className="ui-caption text-slate-500 dark:text-slate-400">{(lifecycle.rules ?? []).length} rule(s)</span>
                          <button
                            type="button"
                            onClick={() => setShowLifecycleEditor((prev) => !prev)}
                            className={bucketFeatureSecondaryActionClass}
                            disabled={lifecycleNotImplemented}
                          >
                            {showLifecycleEditor ? "Hide editor" : "Show editor"}
                          </button>
                          <button
                            type="button"
                            onClick={saveLifecycle}
                            disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
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
                        {(lifecycle.rules?.length ?? 0) === 0 ? (
                          <p className="ui-caption text-slate-600 dark:text-slate-300">No rules configured on this bucket.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className={cx(uiDataTableClass, "min-w-full ui-caption")}>
                              <thead>
                                <tr>
                                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    ID
                                  </th>
                                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Status
                                  </th>
                                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Filter
                                  </th>
                                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Actions
                                  </th>
                                  <th className="px-3 py-2 text-left ui-caption font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                    Manage
                                  </th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                {lifecycle.rules?.map((rawRule, idx) => {
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
                                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">
                                        <button
                                          type="button"
                                          onClick={() => toggleRuleStatusAt(idx)}
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
                                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{filterLabel}</td>
                                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{describeLifecycleActions(rule)}</td>
                                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => deleteRuleAt(idx)}
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
                              onChange={(value) => setLifecycleMode(value)}
                              disabled={lifecycleNotImplemented}
                            />
                          </div>
                          {lifecycleMode === "simple" ? (
                            <div className="mt-3 space-y-3">
                              {simpleLifecycleWarning && (
                                <UiInlineMessage tone="warning">{simpleLifecycleWarning}</UiInlineMessage>
                              )}
                              <p className="ui-caption text-slate-600 dark:text-slate-300">
                                Quickly add one of the preconfigured rules below (appended to the existing configuration).
                              </p>
                              <div className="space-y-3">
                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">
                                    Rule 1: noncurrent 90d + multipart 30d + delete markers (explicit)
                                  </p>
                                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                                    Cleans noncurrent versions after 90d, removes incomplete multipart uploads after 30d, and deletes expired delete markers.
                                  </p>
                                  <div className="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddExampleRule({
                                          Status: "Enabled",
                                          Filter: { Prefix: "" },
                                          NoncurrentVersionExpiration: { NoncurrentDays: 90 },
                                          AbortIncompleteMultipartUpload: { DaysAfterInitiation: 30 },
                                          Expiration: { ExpiredObjectDeleteMarker: true },
                                        })
                                      }
                                      className="ui-caption font-semibold text-primary hover:text-primary-600 disabled:opacity-60"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">Rule 2: current/noncurrent transitions</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className="flex flex-col gap-1">
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={transitionCurrentDays}
                                        onChange={(e) => setTransitionCurrentDays(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={transitionNoncurrentDays}
                                        onChange={(e) => setTransitionNoncurrentDays(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-28")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Storage class
                                      <input
                                        type="text"
                                        value={transitionStorageClass}
                                        onChange={(e) => setTransitionStorageClass(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="GLACIER"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={transitionPrefix}
                                        onChange={(e) => setTransitionPrefix(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="logs/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddExampleRule({
                                          Status: "Enabled",
                                          Filter: { Prefix: transitionPrefix },
                                          Transitions: [
                                            { Days: Number(transitionCurrentDays) || 0, StorageClass: transitionStorageClass || "GLACIER" },
                                          ],
                                          NoncurrentVersionTransitions: [
                                            {
                                              NoncurrentDays: Number(transitionNoncurrentDays) || 0,
                                              StorageClass: transitionStorageClass || "GLACIER",
                                            },
                                          ],
                                        })
                                      }
                                      className="ui-caption font-semibold text-primary hover:text-primary-600 disabled:opacity-60"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className={cx(uiCardMutedClass, "px-3 py-2")}>
                                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">Rule 3: current/noncurrent expiration</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className="flex flex-col gap-1">
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={expireCurrentDays}
                                        onChange={(e) => setExpireCurrentDays(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={expireNoncurrentDays}
                                        onChange={(e) => setExpireNoncurrentDays(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={expirePrefix}
                                        onChange={(e) => setExpirePrefix(e.target.value)}
                                        className={cx(bucketFeatureInputClass, "w-32")}
                                        placeholder="archive/"
                                        disabled={lifecycleNotImplemented}
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={addExpirationExampleRule}
                                      className="ui-caption font-semibold text-primary hover:text-primary-600 disabled:opacity-60"
                                      disabled={lifecycleNotImplemented || savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>
                              </div>
                              <p className="ui-caption text-slate-500 dark:text-slate-400">
                                Use JSON mode to customize or edit rules.
                              </p>
                            </div>
                          ) : (
                            <div className="mt-3 space-y-2">
                              <p className="ui-caption text-slate-500 dark:text-slate-400">
                                Paste a JSON array that matches the S3 API (<code>Rules</code>). Existing rules are listed above.
                              </p>
                              <textarea
                                value={lifecycleText}
                                onChange={(e) => setLifecycleText(e.target.value)}
                                rows={10}
                                className={cx(bucketFeatureJsonInputClass, "w-full rounded-lg bg-slate-50 dark:bg-slate-900")}
                                disabled={lifecycleNotImplemented}
                              />
                              <BucketFeatureJsonExample
                                show={showLifecycleJsonExample}
                                onToggle={() => setShowLifecycleJsonExample((prev) => !prev)}
                                example={defaultLifecycleJsonExample}
                                onUseExample={() => setLifecycleText(defaultLifecycleJsonExample)}
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
                        <div className="flex flex-wrap gap-2">
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
                        <div className="space-y-2">
                          {bucketTags.length === 0 && (
                            <p className="ui-caption text-slate-500 dark:text-slate-400">No tags configured on this bucket.</p>
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
                            <p className="ui-caption text-slate-500 dark:text-slate-400">
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
              <div className="space-y-4">
                <BucketFeatureCard
                  title="Block public access"
                  description="Manage the four S3 public access block flags. Configure each option below."
                  mode="graphical"
                  visualState={publicAccessCardState}
                  testId="bucket-feature-block-public-access"
                  className="space-y-3"
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
                  <div className="grid gap-3 md:grid-cols-2">
                    {publicAccessOptions.map((option) => (
                      <label
                        key={option.key}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-body text-slate-700 hover:border-primary dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100"
                      >
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-slate-50">{option.label}</p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">{option.description}</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={Boolean(publicAccessBlock[option.key])}
                          onChange={(e) => handleTogglePublicAccessField(option.key, e.target.checked)}
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
                  className="space-y-3"
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className={bucketFeatureLabelClass}>
                      Canned ACL
                      <select
                        value={bucketAclPreset}
                        onChange={(e) => {
                          setBucketAclPreset(e.target.value);
                          setBucketAclStatus(null);
                          setBucketAclError(null);
                        }}
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
                          onChange={(e) => {
                            setBucketAclCustom(e.target.value);
                            setBucketAclStatus(null);
                          }}
                          className={bucketFeatureInputClass}
                          placeholder="e.g. private"
                          disabled={aclNotImplemented || bucketAclLoading || savingBucketAcl}
                        />
                      </label>
                    )}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Saving a canned ACL replaces the current ACL grants.
                  </p>
                  {bucketAclLoading ? (
                    <UiInlineMessage>Loading ACL...</UiInlineMessage>
                  ) : (
                    <div className="space-y-3">
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{bucketAcl?.owner ?? "Unknown"}</span>
                      </p>
                      {(bucketAcl?.grants?.length ?? 0) > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                            <thead className="bg-slate-50 ui-caption uppercase tracking-wide text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                              <tr>
                                <th className="px-3 py-2 text-left">Grantee</th>
                                <th className="px-3 py-2 text-left">Type</th>
                                <th className="px-3 py-2 text-left">Permission</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
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
                  className="space-y-4"
                  actions={
                    <div className="flex gap-2">
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
                  className="space-y-3"
                  actions={
                    <div className="flex gap-2">
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
              <div className="space-y-3">
                <BucketFeatureCard
                  title="Static website"
                  description="Host a static website from this bucket or redirect all requests."
                  mode="hybrid"
                  visualState={websiteCardState}
                  testId="bucket-feature-website"
                  className="space-y-3"
                  actions={
                    <div className="flex flex-wrap gap-2">
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                      <input
                        type="radio"
                        checked={websiteMode === "hosting"}
                        onChange={() => {
                          setWebsiteMode("hosting");
                          setWebsiteStatus(null);
                          setWebsiteError(null);
                        }}
                        disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Host a website</p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Serve index and error documents from this bucket.
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-slate-200 px-3 py-2 ui-caption text-slate-700 dark:border-slate-700 dark:text-slate-100">
                      <input
                        type="radio"
                        checked={websiteMode === "redirect"}
                        onChange={() => {
                          setWebsiteMode("redirect");
                          setWebsiteStatus(null);
                          setWebsiteError(null);
                        }}
                        disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                        className="mt-0.5 h-4 w-4 text-primary focus:ring-primary"
                      />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100">Redirect all requests</p>
                        <p className="ui-caption text-slate-500 dark:text-slate-400">
                          Point every request to another host or domain.
                        </p>
                      </div>
                    </label>
                  </div>
                  {websiteMode === "hosting" ? (
                    <div className="space-y-3">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className={bucketFeatureLabelClass}>
                          Index document
                          <input
                            type="text"
                            value={websiteIndexDocument}
                            onChange={(e) => {
                              setWebsiteIndexDocument(e.target.value);
                              setWebsiteStatus(null);
                            }}
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
                            onChange={(e) => {
                              setWebsiteErrorDocument(e.target.value);
                              setWebsiteStatus(null);
                            }}
                            className={bucketFeatureInputClass}
                            placeholder="error.html"
                            disabled={websiteNotImplemented || websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                          />
                        </label>
                      </div>
                      <div className="space-y-2">
                        <label className="ui-caption font-medium text-slate-700 dark:text-slate-200">
                          Routing rules (JSON array)
                        </label>
                        <textarea
                          value={websiteRoutingRules}
                          onChange={(e) => {
                            setWebsiteRoutingRules(e.target.value);
                            setWebsiteStatus(null);
                          }}
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
                            onUseExample={() => {
                              setWebsiteRoutingRules(defaultWebsiteRoutingRulesExample);
                              setWebsiteStatus(null);
                              setWebsiteError(null);
                            }}
                            disabled={websiteNotImplemented}
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={bucketFeatureLabelClass}>
                        Redirect hostname
                        <input
                          type="text"
                          value={websiteRedirectHost}
                          onChange={(e) => {
                            setWebsiteRedirectHost(e.target.value);
                            setWebsiteStatus(null);
                          }}
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
                          onChange={(e) => {
                            setWebsiteRedirectProtocol(e.target.value);
                            setWebsiteStatus(null);
                          }}
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
                    className="space-y-3"
                    actions={
                      <div className="flex flex-wrap gap-2">
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
                      onChange={(value) => {
                        setReplicationMode(value);
                        setReplicationStatus(null);
                        setReplicationError(null);
                      }}
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
                      <div className="space-y-3">
                        <label className={bucketFeatureLabelClass}>
                          Role ARN
                          <input
                            type="text"
                            value={replicationRole}
                            onChange={(e) => {
                              setReplicationRole(e.target.value);
                              setReplicationStatus(null);
                            }}
                            className={bucketFeatureInputClass}
                            placeholder="arn:aws:iam::123456789012:role/replication-role"
                            disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                          />
                        </label>
                        <div className="space-y-3">
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
                              <div className="grid gap-3 md:grid-cols-2">
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
                      <div className="space-y-2">
                        <textarea
                          value={replicationText}
                          onChange={(e) => {
                            setReplicationText(e.target.value);
                            setReplicationStatus(null);
                          }}
                          rows={14}
                          className={cx(bucketFeatureJsonInputClass, "w-full")}
                          spellCheck={false}
                          disabled={replicationBlocked || replicationNotImplemented || replicationBusy}
                        />
                        {containsUnsupportedReplicationZone(replicationConfiguration) && (
                          <p className="ui-caption text-rose-700 dark:text-rose-200">
                            Destination.Zone is not supported in V1 and must be removed before saving.
                          </p>
                        )}
                        <BucketFeatureJsonExample
                          show={showReplicationExample}
                          onToggle={() => setShowReplicationExample((prev) => !prev)}
                          example={defaultReplicationJsonExample}
                          onUseExample={() => {
                            setReplicationText(defaultReplicationJsonExample);
                            setReplicationStatus(null);
                            setReplicationError(null);
                          }}
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
                  className="space-y-3"
                  actions={
                    <div className="flex flex-wrap gap-2">
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
                  <div className="grid gap-3 md:grid-cols-2">
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
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
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
                  className="space-y-3"
                  actions={
                    <div className="flex flex-wrap gap-2">
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
                    onChange={(e) => {
                      setNotificationText(e.target.value);
                      if (notificationsStatus) {
                        setNotificationsStatus(null);
                      }
                    }}
                    className={cx(bucketFeatureJsonInputClass, "h-64 w-full")}
                    placeholder={defaultNotificationTemplate}
                    spellCheck={false}
                    disabled={notificationsNotImplemented}
                  />
                  <BucketFeatureJsonExample
                    show={showNotificationExample}
                    onToggle={() => setShowNotificationExample((prev) => !prev)}
                    example={notificationExample}
                    onUseExample={() => {
                      setNotificationText(notificationExample);
                      setNotificationsStatus(null);
                    }}
                    disabled={notificationsNotImplemented}
                    helperText={
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        Need a topic? Create it in the Topics section.
                      </span>
                    }
                  />
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
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
              <div className="space-y-4">
                <MetricsCard
                  title="Current usage and quota"
                  description="Live usage, quotas, and traffic sourced from backend metrics."
                >
                  <div className="grid gap-3 md:grid-cols-2">
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
                    <div className="space-y-3">
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
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={quotaSizeGb}
                            onChange={(e) => setQuotaSizeGb(e.target.value)}
                            className={cx(bucketFeatureInputClass, "flex-1")}
                            placeholder="e.g. 100"
                            disabled={!canEditQuota}
                          />
                          <select
                            value={quotaSizeUnit}
                            onChange={(e) => setQuotaSizeUnit(e.target.value as "MiB" | "GiB" | "TiB")}
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
                          onChange={(e) => setQuotaObjects(e.target.value)}
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
