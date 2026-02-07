/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import axios from "axios";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  Bucket,
  BucketAcl,
  BucketCors,
  BucketLifecycleConfig,
  BucketLoggingConfiguration,
  BucketNotificationConfiguration,
  BucketObjectLockConfiguration,
  BucketPolicy,
  BucketProperties,
  BucketPublicAccessBlock,
  BucketWebsiteConfiguration,
  deleteBucketCors,
  deleteBucketLogging,
  deleteBucketNotifications,
  deleteBucketPolicyApi,
  deleteBucketWebsite,
  deleteBucketLifecycle,
  getBucketCors,
  getBucketLogging,
  getBucketNotifications,
  getBucketPolicy,
  getBucketProperties,
  getBucketWebsite,
  getBucketAcl,
  getBucketLifecycle,
  getBucketPublicAccessBlock,
  listBuckets,
  putBucketCors,
  putBucketLogging,
  putBucketNotifications,
  putBucketPolicy,
  putBucketWebsite,
  putBucketLifecycle,
  setBucketVersioning,
  updateBucketAcl,
  updateBucketQuota,
  updateBucketObjectLock,
  updateBucketPublicAccessBlock,
} from "../../api/buckets";
import {
  deleteCephAdminBucketCors,
  deleteCephAdminBucketLifecycle,
  deleteCephAdminBucketLogging,
  deleteCephAdminBucketNotifications,
  deleteCephAdminBucketPolicy,
  deleteCephAdminBucketWebsite,
  getCephAdminBucketAcl,
  getCephAdminBucketCors,
  getCephAdminBucketLifecycle,
  getCephAdminBucketLogging,
  getCephAdminBucketNotifications,
  getCephAdminBucketPolicy,
  getCephAdminBucketProperties,
  getCephAdminBucketPublicAccessBlock,
  getCephAdminBucketWebsite,
  listCephAdminBuckets,
  putCephAdminBucketCors,
  putCephAdminBucketLifecycle,
  putCephAdminBucketLogging,
  putCephAdminBucketNotifications,
  putCephAdminBucketPolicy,
  putCephAdminBucketWebsite,
  setCephAdminBucketVersioning,
  updateCephAdminBucketAcl,
  updateCephAdminBucketObjectLock,
  updateCephAdminBucketPublicAccessBlock,
} from "../../api/cephAdmin";
import {
  createFolder,
  deleteObjects,
  getObjectDownloadUrl,
  listObjects,
  S3Object,
  uploadObject,
} from "../../api/objects";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import SplitView from "../../components/SplitView";
import UsageTile from "../../components/UsageTile";
import Modal from "../../components/Modal";
import { formatCompactNumber } from "../../utils/format";
import { useS3AccountContext } from "./S3AccountContext";
import TrafficAnalytics from "./TrafficAnalytics";
import PropertySummaryChip, { PropertySummaryTone } from "../../components/PropertySummaryChip";
import { useCephAdminEndpoint } from "../cephAdmin/CephAdminEndpointContext";

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

function formatBytes(value?: number | null) {
  if (value === undefined || value === null) return "-";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const decimals = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(decimals)} ${units[idx]}`;
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

type FeatureState = "enabled" | "disabled" | "unknown";

const bucketCardClass =
  "rounded-2xl border border-slate-200/80 bg-white px-4 py-3 shadow-sm dark:border-slate-800 dark:bg-slate-900";

const featureStateChipClasses: Record<FeatureState, string> = {
  enabled: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  disabled: "bg-amber-50 text-amber-700 dark:bg-amber-900/40 dark:text-amber-100",
  unknown: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
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

const isPublicAccessFullyEnabled = (config?: BucketPublicAccessBlock | null) =>
  Boolean(config) && publicAccessKeys.every((key) => (config as Record<string, boolean | null | undefined>)[key] === true);

const defaultNotificationTemplate = '{\n  "TopicConfigurations": []\n}';

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

type BucketDetailMode = "manager" | "ceph-admin";

export default function BucketDetailPage({ mode = "manager" }: { mode?: BucketDetailMode }) {
  const { bucketName } = useParams<{ bucketName: string }>();
  const isCephAdmin = mode === "ceph-admin";
  const { accounts, selectedS3AccountId, accountIdForApi, requiresS3AccountSelection } = useS3AccountContext();
  const { selectedEndpointId, selectedEndpoint } = useCephAdminEndpoint();
  const [bucket, setBucket] = useState<Bucket | null>(null);
  const [loadingBucket, setLoadingBucket] = useState(false);
  const [bucketError, setBucketError] = useState<string | null>(null);
  const [properties, setProperties] = useState<BucketProperties | null>(null);
  const [propsError, setPropsError] = useState<string | null>(null);
  const [propsLoading, setPropsLoading] = useState(false);
  const [updatingVersioning, setUpdatingVersioning] = useState(false);
  const [policy, setPolicy] = useState<BucketPolicy | null>(null);
  const [policyText, setPolicyText] = useState("");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [deletingPolicy, setDeletingPolicy] = useState(false);
  const [publicAccessBlock, setPublicAccessBlock] = useState<BucketPublicAccessBlock>(defaultPublicAccessBlock);
  const [publicAccessError, setPublicAccessError] = useState<string | null>(null);
  const [publicAccessStatus, setPublicAccessStatus] = useState<string | null>(null);
  const [publicAccessLoading, setPublicAccessLoading] = useState(false);
  const [savingPublicAccess, setSavingPublicAccess] = useState(false);
  const [cors, setCors] = useState<BucketCors | null>(null);
  const [corsText, setCorsText] = useState("");
  const [corsError, setCorsError] = useState<string | null>(null);
  const [corsLoading, setCorsLoading] = useState(false);
  const [savingCors, setSavingCors] = useState(false);
  const [deletingCors, setDeletingCors] = useState(false);
  const [notificationText, setNotificationText] = useState(defaultNotificationTemplate);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [notificationsStatus, setNotificationsStatus] = useState<string | null>(null);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [clearingNotifications, setClearingNotifications] = useState(false);
  const [showNotificationExample, setShowNotificationExample] = useState(false);
  const [accessLoggingConfig, setAccessLoggingConfig] = useState<BucketLoggingConfiguration | null>(null);
  const [accessLoggingEnabled, setAccessLoggingEnabled] = useState(false);
  const [accessLoggingTargetBucket, setAccessLoggingTargetBucket] = useState("");
  const [accessLoggingTargetPrefix, setAccessLoggingTargetPrefix] = useState("");
  const [accessLoggingError, setAccessLoggingError] = useState<string | null>(null);
  const [accessLoggingStatus, setAccessLoggingStatus] = useState<string | null>(null);
  const [accessLoggingLoading, setAccessLoggingLoading] = useState(false);
  const [savingAccessLogging, setSavingAccessLogging] = useState(false);
  const [clearingAccessLogging, setClearingAccessLogging] = useState(false);
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
  const [deletingLifecycle, setDeletingLifecycle] = useState(false);
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

  const [objects, setObjects] = useState<S3Object[]>([]);
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [objectsError, setObjectsError] = useState<string | null>(null);
  const [objectsLoading, setObjectsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [currentPrefix, setCurrentPrefix] = useState<string>("");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showPolicyExample, setShowPolicyExample] = useState(false);
  const [showCorsExample, setShowCorsExample] = useState(false);
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
  const [savingObjectLock, setSavingObjectLock] = useState(false);
  const [objectLockConfig, setObjectLockConfig] = useState<BucketObjectLockConfiguration | null>(null);

  const availableTabs = useMemo(() => {
    if (isCephAdmin) {
      return ["overview", "properties", "permissions", "advanced", "metrics", "ceph"];
    }
    return ["overview", "objects", "properties", "permissions", "advanced", "metrics", "ceph"];
  }, [isCephAdmin]);

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0]);
    }
  }, [activeTab, availableTabs]);
  const selectedS3Account = useMemo(() => {
    if (isCephAdmin) return null;
    if (selectedS3AccountId) {
      return accounts.find((account) => account.id === selectedS3AccountId) ?? null;
    }
    if (!requiresS3AccountSelection && accounts.length > 0) {
      return accounts[0];
    }
    return null;
  }, [accounts, isCephAdmin, requiresS3AccountSelection, selectedS3AccountId]);
  const staticWebsiteEnabled = useMemo(() => {
    if (isCephAdmin) {
      return selectedEndpoint?.capabilities?.static_website ?? true;
    }
    return selectedS3Account?.storage_endpoint_capabilities?.static_website ?? false;
  }, [isCephAdmin, selectedEndpoint, selectedS3Account]);
  const accountId = accountIdForApi ?? null;
  const hasAccountContext = !requiresS3AccountSelection || accountId !== null;
  const endpointId = selectedEndpointId ?? null;
  const hasCephContext = Boolean(endpointId);
  const hasContext = isCephAdmin ? hasCephContext : hasAccountContext;
  const staticWebsiteBlocked = !staticWebsiteEnabled;
  const exampleS3AccountId = selectedS3Account?.rgw_account_id || "RGW00000000000000001";
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
  const isAdmin = false;
  const objectLockPersistentlyEnabled =
    (objectLockConfig?.enabled ?? null) === true || (properties?.object_lock_enabled ?? null) === true;
  const objectLockActive = (objectLockEnabled ?? null) === true || objectLockPersistentlyEnabled;
  const versioningStatusRaw = (properties?.versioning_status ?? "").trim();
  const versioningIsEnabled = versioningStatusRaw.toLowerCase() === "enabled";
  const versioningHasExplicitStatus = versioningStatusRaw.length > 0 && versioningStatusRaw.toLowerCase() !== "unknown";
  const versioningStatusLabel = versioningIsEnabled
    ? "Enabled"
    : versioningHasExplicitStatus
      ? versioningStatusRaw
      : "Disabled";
  const versioningChipState: FeatureState = versioningIsEnabled ? "enabled" : "disabled";
  const objectLockStatusLabel = objectLockPersistentlyEnabled ? "Enabled" : "Disabled";
  const objectLockChipState: FeatureState = objectLockPersistentlyEnabled ? "enabled" : "disabled";

  useEffect(() => {
    if (!bucket) {
      setQuotaSizeGb("");
      setQuotaSizeUnit("GiB");
      setQuotaObjects("");
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
  }, [bucket]);

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

  const applyAccessLoggingState = useCallback((config?: BucketLoggingConfiguration | null) => {
    if (!config || !config.enabled) {
      setAccessLoggingConfig(config ?? null);
      setAccessLoggingEnabled(false);
      setAccessLoggingTargetBucket("");
      setAccessLoggingTargetPrefix("");
      return;
    }
    setAccessLoggingConfig(config);
    setAccessLoggingEnabled(Boolean(config.enabled));
    setAccessLoggingTargetBucket(config.target_bucket ?? "");
    setAccessLoggingTargetPrefix(config.target_prefix ?? "");
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
          with_stats: true,
        });
        const found = response.items.find((b) => b.name === bucketName) ?? null;
        setBucket(found ?? null);
      } else {
        const data = await listBuckets(accountId);
        const found = data.find((b) => b.name === bucketName) ?? null;
        setBucket(found);
      }
    } catch (err) {
      setBucketError("Unable to load bucket details.");
    } finally {
      setLoadingBucket(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  useEffect(() => {
    if (activeTab !== "overview" && activeTab !== "metrics") return;
    refreshBucketMeta();
  }, [activeTab, refreshBucketMeta]);

  const loadProperties = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setProperties(null);
      applyObjectLockState(null);
      return;
    }
    setPropsLoading(true);
    setPropsError(null);
    setObjectLockError(null);
    setObjectLockStatus(null);
    try {
      let data: BucketProperties;
      if (isCephAdmin) {
        if (!endpointId) {
          setProperties(null);
          applyObjectLockState(null);
          return;
        }
        data = await getCephAdminBucketProperties(endpointId, bucketName);
      } else {
        data = await getBucketProperties(accountId, bucketName);
      }
      setProperties(data);
      const lockConfig = data.object_lock ?? (data.object_lock_enabled !== undefined ? { enabled: data.object_lock_enabled } : null);
      applyObjectLockState(lockConfig);
    } catch (err) {
      setProperties(null);
      setPropsError("Unable to load bucket properties.");
      applyObjectLockState(null);
    } finally {
      setPropsLoading(false);
    }
  }, [accountId, applyObjectLockState, bucketName, endpointId, hasContext, isCephAdmin]);

  useEffect(() => {
    loadProperties();
  }, [loadProperties]);

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
      setLifecycleError("Unable to load lifecycle rules.");
    } finally {
      setLifecycleLoading(false);
    }
  }, [accountId, bucketName, emptySimpleLifecycleRule, endpointId, hasContext, isCephAdmin]);

  const loadPolicy = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setPolicy(null);
      setPolicyText("");
      return;
    }
    setPolicyLoading(true);
    setPolicyError(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketPolicy(endpointId, bucketName)
          : { policy: null }
        : await getBucketPolicy(accountId, bucketName);
      setPolicy(data);
      setPolicyText(data.policy ? JSON.stringify(data.policy, null, 2) : "");
    } catch (err) {
      setPolicyError("Unable to load the bucket policy.");
      setPolicy(null);
      setPolicyText("");
    } finally {
      setPolicyLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadCors = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setCors(null);
      setCorsText("");
      return;
    }
    setCorsLoading(true);
    setCorsError(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketCors(endpointId, bucketName)
          : { rules: [] }
        : await getBucketCors(accountId, bucketName);
      setCors(data);
      setCorsText(data.rules && data.rules.length > 0 ? JSON.stringify(data.rules, null, 2) : "[]");
    } catch (err) {
      setCorsError("Unable to load the CORS configuration.");
      setCors(null);
      setCorsText("");
    } finally {
      setCorsLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadPublicAccessBlock = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setPublicAccessBlock({ ...defaultPublicAccessBlock });
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
    } catch (err) {
      const message =
        (axios.isAxiosError(err) && ((err.response?.data as { detail?: string })?.detail || err.message)) ||
        "Unable to load public access block settings.";
      setPublicAccessError(message);
      setPublicAccessBlock({ ...defaultPublicAccessBlock });
    } finally {
      setPublicAccessLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadNotifications = useCallback(async () => {
    if (!bucketName || !hasContext) {
      setNotificationText(defaultNotificationTemplate);
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
      const config = data.configuration ?? {};
      const hasConfig = Object.keys(config).length > 0;
      setNotificationText(hasConfig ? JSON.stringify(config, null, 2) : defaultNotificationTemplate);
    } catch (err) {
      setNotificationText(defaultNotificationTemplate);
      setNotificationsError("Unable to load bucket notifications.");
    } finally {
      setNotificationsLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadAccessLogging = useCallback(async () => {
    if (!bucketName || !hasContext) {
      applyAccessLoggingState(null);
      setAccessLoggingError(null);
      setAccessLoggingStatus(null);
      return;
    }
    setAccessLoggingLoading(true);
    setAccessLoggingError(null);
    setAccessLoggingStatus(null);
    try {
      const data = isCephAdmin
        ? endpointId
          ? await getCephAdminBucketLogging(endpointId, bucketName)
          : { enabled: false }
        : await getBucketLogging(accountId, bucketName);
      applyAccessLoggingState(data);
    } catch (err) {
      applyAccessLoggingState(null);
      setAccessLoggingError("Unable to load bucket access logging.");
    } finally {
      setAccessLoggingLoading(false);
    }
  }, [accountId, applyAccessLoggingState, bucketName, endpointId, hasContext, isCephAdmin]);

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
      setWebsiteError("Unable to load bucket website configuration.");
    } finally {
      setWebsiteLoading(false);
    }
  }, [accountId, applyWebsiteState, bucketName, endpointId, hasContext, isCephAdmin, staticWebsiteEnabled]);

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
      setBucketAclError("Unable to load bucket ACL.");
    } finally {
      setBucketAclLoading(false);
    }
  }, [accountId, bucketName, endpointId, hasContext, isCephAdmin]);

  const loadObjects = useCallback(
    async (prefix: string) => {
      if (isCephAdmin || !bucketName || !hasAccountContext) return;
      setObjectsLoading(true);
      setObjectsError(null);
      setActionMessage(null);
      try {
        const data = await listObjects(accountId, bucketName, prefix);
        setObjects(data.objects);
        setPrefixes(data.prefixes);
      } catch (err) {
        setObjects([]);
        setPrefixes([]);
        setObjectsError("Unable to list objects (check the backend/RGW).");
      } finally {
        setObjectsLoading(false);
      }
    },
    [accountId, bucketName, hasAccountContext, isCephAdmin]
  );

  useEffect(() => {
    setSelectedKeys([]);
    if (isCephAdmin) return;
    loadObjects(currentPrefix);
  }, [currentPrefix, isCephAdmin, loadObjects]);

  useEffect(() => {
    if (activeTab === "overview" || activeTab === "permissions") {
      loadPolicy();
      loadCors();
      loadBucketAcl();
    }
    if (activeTab === "permissions") {
      loadPublicAccessBlock();
    }
  }, [activeTab, loadBucketAcl, loadCors, loadPolicy, loadPublicAccessBlock]);

  useEffect(() => {
    if (activeTab === "properties") {
      loadLifecycle();
    }
  }, [activeTab, loadLifecycle]);

  useEffect(() => {
    loadLifecycle();
  }, [loadLifecycle]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    loadAccessLogging();
  }, [loadAccessLogging]);

  useEffect(() => {
    loadWebsite();
  }, [loadWebsite]);

  const updateSimpleLifecycleRule = (index: number, patch: Partial<SimpleLifecycleRule>) => {
    setSimpleLifecycleRules((prev) => prev.map((rule, idx) => (idx === index ? { ...rule, ...patch } : rule)));
  };

  const describeLifecycleActions = (rule: Record<string, unknown>): string => {
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
        await loadProperties();
      } catch (err) {
        const message = axios.isAxiosError(err)
          ? ((err.response?.data as { detail?: string })?.detail || err.message || "Invalid or unsaved lifecycle.")
          : err instanceof Error
            ? err.message
            : "Invalid or unsaved lifecycle.";
        setLifecycleError(message);
      } finally {
        setSavingLifecycle(false);
      }
    },
    [accountId, bucketName, emptySimpleLifecycleRule, endpointId, hasContext, isCephAdmin, loadProperties]
  );

  const updateLifecycleRules = async (updater: (rules: Record<string, unknown>[]) => Record<string, unknown>[]) => {
    if (!bucketName || !hasContext) return;
    const current = lifecycle.rules ?? [];
    const next = updater(current);
    await persistLifecycleRules(next);
    await loadLifecycle();
  };

  const disableRuleAt = async (index: number) => {
    await updateLifecycleRules((rules) =>
      rules.map((rule, idx) => (idx === index ? { ...rule, Status: "Disabled" } : rule))
    );
  };

  const deleteRuleAt = async (index: number) => {
    await updateLifecycleRules((rules) => rules.filter((_, idx) => idx !== index));
  };

  const toggleRuleStatusAt = async (index: number) => {
    await updateLifecycleRules((rules) =>
      rules.map((rule, idx) => {
        if (idx !== index) return rule;
        const currentStatus = (rule as any).Status === "Disabled" ? "Disabled" : "Enabled"; // eslint-disable-line @typescript-eslint/no-explicit-any
        return { ...rule, Status: currentStatus === "Enabled" ? "Disabled" : "Enabled" };
      })
    );
  };

  const handleAddExampleRule = async (rule: Record<string, unknown>) => {
    if (!bucketName || !hasContext) return;
    try {
      const current = lifecycle.rules ?? [];
      const ruleWithId = { ID: (rule as any).ID || randomLifecycleId(), ...rule }; // eslint-disable-line @typescript-eslint/no-explicit-any
      const merged = [...current, ruleWithId];
      setLifecycleMode("json");
      setLifecycleText(JSON.stringify(merged, null, 2));
      await persistLifecycleRules(merged as Record<string, unknown>[]);
      setShowLifecycleEditor(true);
    } catch {
      setLifecycleError("Invalid or unreadable example.");
    }
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

  const objectRows = useMemo(
    () => rowData.filter((r): r is Extract<Row, { type: "object" }> => r.type === "object"),
    [rowData]
  );

  const toggleSelection = (key: string) => {
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

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
  const policyConfigured = Boolean(policy?.policy && Object.keys(policy.policy).length > 0);
  const corsConfigured = Boolean(cors?.rules && cors.rules.length > 0);
  const accessLoggingConfigured = Boolean(
    accessLoggingConfig?.enabled && (accessLoggingConfig.target_bucket ?? "").trim().length > 0
  );
  const websiteRoutingRulesList = Array.isArray(websiteConfig?.routing_rules) ? websiteConfig?.routing_rules : [];
  const websiteConfigured = Boolean(
    (websiteConfig?.redirect_all_requests_to?.host_name ?? "").trim() ||
      (websiteConfig?.index_document ?? "").trim() ||
      websiteRoutingRulesList.length > 0
  );
  const publicAccessBlockConfig = properties?.public_access_block;
  const publicAccessBlockEnabled = isPublicAccessFullyEnabled(publicAccessBlockConfig);
  const publicAccessBlockPartial =
    Boolean(publicAccessBlockConfig) &&
    !publicAccessBlockEnabled &&
    publicAccessKeys.some((key) => (publicAccessBlockConfig as Record<string, boolean | null | undefined>)[key] === true);

  const propertySummary = useMemo<PropertySummary[]>(() => {
    const versioningState = propsLoading
      ? "Loading..."
      : propsError
        ? "Unavailable"
        : properties?.versioning_status ?? "Disabled";
    const versioningNormalized = String(versioningState || "").trim().toLowerCase();
    const versioningTone: PropertySummary["tone"] =
      propsLoading || propsError ? "unknown" : versioningIsEnabled ? "active" : versioningNormalized === "suspended" ? "unknown" : "inactive";

    const hasObjectLockData = !(propsLoading || propsError);
    let objectLockState = "Disabled";
    let objectLockTone: PropertySummary["tone"] = "inactive";
    if (!hasObjectLockData) {
      objectLockState = propsLoading ? "Loading..." : "Unavailable";
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

    const accessLoggingState = accessLoggingLoading
      ? "Loading..."
      : accessLoggingError
        ? "Unavailable"
        : accessLoggingConfigured
          ? "Enabled"
          : "Disabled";
    const accessLoggingTone: PropertySummary["tone"] =
      accessLoggingLoading || accessLoggingError ? "unknown" : accessLoggingConfigured ? "active" : "inactive";

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

    const publicAccessState = propsLoading
      ? "Loading..."
      : propsError
        ? "Unavailable"
        : publicAccessBlockEnabled
          ? "Enabled"
          : publicAccessBlockPartial
            ? "Partial"
            : "Disabled";
    const publicAccessTone: PropertySummary["tone"] =
      propsLoading || propsError ? "unknown" : publicAccessBlockEnabled || publicAccessBlockPartial ? "active" : "inactive";

    const summary: PropertySummary[] = [
      { label: "Versioning", state: versioningState, tone: versioningTone },
      { label: "Object Lock", state: objectLockState, tone: objectLockTone },
      { label: "Block public access", state: publicAccessState, tone: publicAccessTone },
      { label: "Lifecycle rules", state: lifecycleState, tone: lifecycleTone },
      { label: "Bucket policy", state: policyState, tone: policyTone },
      { label: "CORS", state: corsState, tone: corsTone },
    ];

    summary.splice(4, 0, { label: "Static website", state: websiteState, tone: websiteTone });
    summary.splice(5, 0, { label: "Quota", state: quotaState, tone: quotaTone });
    summary.push({ label: "Access logging", state: accessLoggingState, tone: accessLoggingTone });

    return summary;
  }, [
    bucket,
    accessLoggingConfigured,
    accessLoggingError,
    accessLoggingLoading,
    hasLifecycleRules,
    corsConfigured,
    corsError,
    corsLoading,
    lifecycleError,
    lifecycleLoading,
    objectLockPersistentlyEnabled,
    policyConfigured,
    policyError,
    policyLoading,
    properties,
    propsError,
    propsLoading,
    quotaConfigured,
    publicAccessBlockEnabled,
    publicAccessBlockPartial,
    versioningIsEnabled,
    staticWebsiteEnabled,
    websiteConfigured,
    websiteError,
    websiteLoading,
  ]);

  const basePath = isCephAdmin ? "/ceph-admin/buckets" : "/manager/buckets";
  const rootPath = isCephAdmin ? "/ceph-admin" : "/manager";
  const rootLabel = isCephAdmin ? "Ceph Admin" : "Manager";
  const breadcrumbs = [
    { label: rootLabel, to: rootPath },
    { label: "Buckets", to: basePath },
    { label: bucketName ?? "" },
  ];

  const handleNewFolder = async () => {
    if (isCephAdmin || !bucketName || !hasAccountContext) return;
    const name = window.prompt("Folder name (no trailing slash):");
    if (!name) return;
    const prefix = `${currentPrefix}${name}`.replace(/\/+$/, "");
    setObjectsLoading(true);
    setObjectsError(null);
    try {
      await createFolder(accountId, bucketName, `${prefix}/`);
      setActionMessage(`Folder '${name}' created`);
      await loadObjects(currentPrefix);
    } catch (err) {
      setObjectsError("Unable to create the folder.");
    } finally {
      setObjectsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (isCephAdmin || !bucketName || !hasAccountContext || selectedKeys.length === 0) return;
    const confirmDelete = window.confirm(`Delete ${selectedKeys.length} object(s)?`);
    if (!confirmDelete) return;
    setObjectsLoading(true);
    setObjectsError(null);
    try {
      await deleteObjects(accountId, bucketName, selectedKeys);
      setActionMessage(`Deleted ${selectedKeys.length} object(s)`);
      setSelectedKeys([]);
      await loadObjects(currentPrefix);
    } catch (err) {
      setObjectsError("Unable to delete the objects.");
    } finally {
      setObjectsLoading(false);
    }
  };

  const handleTogglePublicAccessField = (key: keyof BucketPublicAccessBlock, value: boolean) => {
    setPublicAccessBlock((prev) => ({
      ...defaultPublicAccessBlock,
      ...prev,
      [key]: value,
    }));
  };

  const handleDownload = async () => {
    if (isCephAdmin || !bucketName || !hasAccountContext || selectedKeys.length === 0) {
      setObjectsError("Select a single object to download.");
      return;
    }
    if (selectedKeys.length > 1) {
      setObjectsError("Please select only one object to download.");
      return;
    }
    setObjectsError(null);
    try {
      const { url } = await getObjectDownloadUrl(accountId, bucketName, selectedKeys[0]);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setObjectsError("Unable to generate the download link.");
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCephAdmin || !bucketName || !hasAccountContext || !uploadFile) {
      setUploadError("Choose a file before uploading.");
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const normalizedPrefix = currentPrefix;
      await uploadObject(accountId, bucketName, uploadFile, normalizedPrefix);
      setActionMessage(`Upload successful: ${uploadFile.name}`);
      setShowUpload(false);
      setUploadFile(null);
      await loadObjects(currentPrefix);
    } catch (err) {
      setUploadError("Upload failed (check the backend/RGW).");
    } finally {
      setUploading(false);
    }
  };

  const toggleVersioning = async () => {
    if (!bucketName || !hasContext || !properties) return;
    if (versioningIsEnabled && objectLockActive) return;
    setUpdatingVersioning(true);
    setPropsError(null);
    try {
      const enabled = (properties.versioning_status ?? "").toLowerCase() !== "enabled";
      if (isCephAdmin) {
        if (!endpointId) return;
        await setCephAdminBucketVersioning(endpointId, bucketName, enabled);
      } else {
        await setBucketVersioning(accountId, bucketName, enabled);
      }
      await loadProperties();
    } catch (err) {
      setPropsError("Failed to update versioning.");
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
      setPublicAccessStatus("Public access block updated.");
      await loadProperties();
    } catch (err) {
      const message =
        (axios.isAxiosError(err) && ((err.response?.data as { detail?: string })?.detail || err.message)) ||
        "Unable to update public access block.";
      setPublicAccessError(message);
    } finally {
      setSavingPublicAccess(false);
    }
  };

  const savePolicy = async () => {
    if (!bucketName || !hasContext) return;
    setSavingPolicy(true);
    setPolicyError(null);
    try {
      const parsed = policyText.trim() ? JSON.parse(policyText) : {};
      const saved = isCephAdmin
        ? endpointId
          ? await putCephAdminBucketPolicy(endpointId, bucketName, parsed)
          : { policy: parsed }
        : await putBucketPolicy(accountId, bucketName, parsed);
      setPolicy(saved);
      setPolicyText(JSON.stringify(saved.policy ?? parsed, null, 2));
    } catch (err) {
      setPolicyError("Invalid or unsaved policy (JSON required).");
    } finally {
      setSavingPolicy(false);
    }
  };

  const saveCors = async () => {
    if (!bucketName || !hasContext) return;
    setSavingCors(true);
    setCorsError(null);
    try {
      const parsed = corsText.trim() ? JSON.parse(corsText) : [];
      if (!Array.isArray(parsed)) {
        throw new Error("CORS must be an array of rules.");
      }
      const saved = isCephAdmin
        ? endpointId
          ? await putCephAdminBucketCors(endpointId, bucketName, parsed as Record<string, unknown>[])
          : { rules: parsed as Record<string, unknown>[] }
        : await putBucketCors(accountId, bucketName, parsed as Record<string, unknown>[]);
      setCors(saved);
      setCorsText(JSON.stringify(saved.rules ?? parsed, null, 2));
    } catch (err) {
      setCorsError("Invalid or unsaved CORS (JSON array required).");
    } finally {
      setSavingCors(false);
    }
  };

  const removeCors = async () => {
    if (!bucketName || !hasContext) return;
    const confirmDelete = window.confirm("Delete the CORS configuration?");
    if (!confirmDelete) return;
    setDeletingCors(true);
    setCorsError(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketCors(endpointId, bucketName);
      } else {
        await deleteBucketCors(accountId, bucketName);
      }
      setCors({ rules: [] });
      setCorsText("[]");
    } catch (err) {
      setCorsError("Unable to delete the CORS configuration.");
    } finally {
      setDeletingCors(false);
    }
  };

  const saveAccessLogging = async () => {
    if (!bucketName || !hasContext) return;
    setAccessLoggingError(null);
    setAccessLoggingStatus(null);
    if (accessLoggingEnabled && !accessLoggingTargetBucket.trim()) {
      setAccessLoggingError("Target bucket is required to enable access logging.");
      return;
    }
    setSavingAccessLogging(true);
    try {
      const payload: BucketLoggingConfiguration = {
        enabled: accessLoggingEnabled,
        target_bucket: accessLoggingTargetBucket.trim() || null,
        target_prefix: accessLoggingTargetPrefix.trim() || null,
      };
      const saved = isCephAdmin
        ? endpointId
          ? await putCephAdminBucketLogging(endpointId, bucketName, payload)
          : payload
        : await putBucketLogging(accountId, bucketName, payload);
      applyAccessLoggingState(saved);
      setAccessLoggingStatus(accessLoggingEnabled ? "Access logging updated." : "Access logging disabled.");
    } catch (err) {
      setAccessLoggingError("Unable to update access logging.");
    } finally {
      setSavingAccessLogging(false);
    }
  };

  const clearAccessLogging = async () => {
    if (!bucketName || !hasContext) return;
    setClearingAccessLogging(true);
    setAccessLoggingError(null);
    setAccessLoggingStatus(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketLogging(endpointId, bucketName);
      } else {
        await deleteBucketLogging(accountId, bucketName);
      }
      applyAccessLoggingState({ enabled: false });
      setAccessLoggingStatus("Access logging disabled.");
    } catch (err) {
      setAccessLoggingError("Unable to disable access logging.");
    } finally {
      setClearingAccessLogging(false);
    }
  };

  const saveNotifications = async () => {
    if (!bucketName || !hasContext) return;
    let parsed: Record<string, unknown>;
    setNotificationsError(null);
    setNotificationsStatus(null);
    try {
      parsed = notificationText.trim() ? JSON.parse(notificationText) : {};
    } catch (err) {
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
      setNotificationsError("Unable to update bucket notifications.");
    } finally {
      setSavingNotifications(false);
    }
  };

  const clearNotifications = async () => {
    if (!bucketName || !hasContext) return;
    const confirmDelete = window.confirm("Delete the notification configuration?");
    if (!confirmDelete) return;
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
      setNotificationsError("Unable to delete bucket notifications.");
    } finally {
      setClearingNotifications(false);
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
      const message =
        (axios.isAxiosError(err) && ((err.response?.data as { detail?: string })?.detail || err.message)) ||
        "Unable to update bucket ACL.";
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
        } catch (err) {
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
      const message = axios.isAxiosError(err)
        ? ((err.response?.data as { detail?: string })?.detail || err.message || "Unable to update website configuration.")
        : err instanceof Error
          ? err.message
          : "Unable to update website configuration.";
      setWebsiteError(message);
    } finally {
      setSavingWebsite(false);
    }
  };

  const clearWebsite = async () => {
    if (!bucketName || !hasContext || !staticWebsiteEnabled) return;
    const confirmDelete = window.confirm("Delete the static website configuration?");
    if (!confirmDelete) return;
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
      setWebsiteError("Unable to delete website configuration.");
    } finally {
      setClearingWebsite(false);
    }
  };

  const removePolicy = async () => {
    if (!bucketName || !hasContext) return;
    const confirmDelete = window.confirm("Delete the bucket policy?");
    if (!confirmDelete) return;
    setDeletingPolicy(true);
    setPolicyError(null);
    try {
      if (isCephAdmin) {
        if (!endpointId) return;
        await deleteCephAdminBucketPolicy(endpointId, bucketName);
      } else {
        await deleteBucketPolicyApi(accountId, bucketName);
      }
      setPolicy({ policy: null });
      setPolicyText("");
    } catch (err) {
      setPolicyError("Unable to delete the bucket policy.");
    } finally {
      setDeletingPolicy(false);
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
    if (isCephAdmin || !bucketName || !hasAccountContext) return;
    setUpdatingQuota(true);
    setQuotaStatus(null);
    setQuotaError(null);
    try {
      const maxSizeGb = quotaSizeGb.trim() === "" ? null : Number(quotaSizeGb);
      const maxObjects = quotaObjects.trim() === "" ? null : Number(quotaObjects);
      if ((maxSizeGb !== null && Number.isNaN(maxSizeGb)) || (maxObjects !== null && Number.isNaN(maxObjects))) {
        setQuotaError("Invalid quota values.");
        setUpdatingQuota(false);
        return;
      }
      await updateBucketQuota(accountId, bucketName, {
        max_size_gb: maxSizeGb ?? undefined,
        max_size_unit: maxSizeGb != null ? quotaSizeUnit : undefined,
        max_objects: maxObjects ?? undefined,
      });
      setQuotaStatus("Quota updated");
      await refreshBucketMeta();
    } catch (err) {
      setQuotaError("Unable to update the quota.");
    } finally {
      setUpdatingQuota(false);
    }
  };

  const handleSaveObjectLock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bucketName || !hasContext) return;
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
      applyObjectLockState(updated);
      setProperties((prev) =>
        prev
          ? {
              ...prev,
              object_lock: updated,
              object_lock_enabled: updated.enabled ?? prev.object_lock_enabled,
            }
          : prev
      );
      setObjectLockStatus("Object Lock updated");
      await loadProperties();
    } catch (err) {
      setObjectLockError("Unable to update the Object Lock configuration.");
    } finally {
      setSavingObjectLock(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={bucketName ?? "Bucket"}
        description={
          bucketError ||
          (isCephAdmin
            ? "Bucket configuration and permissions (Admin Ops + S3)."
            : "Bucket overview, objects, properties, permissions, metrics.")
        }
        breadcrumbs={breadcrumbs}
        actions={[{ label: "← Back to buckets", to: basePath, variant: "ghost" }]}
      />

      {isCephAdmin && !endpointId && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
          Select a Ceph endpoint before managing this bucket.
        </div>
      )}

      {loadingBucket && (
        <div className="rounded-md bg-slate-100 px-4 py-3 ui-body text-slate-600 dark:bg-slate-800 dark:text-slate-200">
          Loading bucket...
        </div>
      )}
      {bucketError && (
        <div className="rounded-md bg-rose-50 px-4 py-3 ui-body text-rose-700 dark:bg-rose-900/40 dark:text-rose-100">
          {bucketError}
        </div>
      )}

      <PageTabs
        activeTab={activeTab}
        onChange={setActiveTab}
        tabs={[
          {
            id: "overview",
            label: "Overview",
            content: (
              <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                <header className="space-y-1">
                  <p className="ui-caption font-semibold uppercase tracking-wide text-primary">Overview</p>
                  <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">
                    {bucketName ? `Bucket ${bucketName}` : "Bucket overview"}
                  </h3>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Owner: <span className="font-semibold text-slate-700 dark:text-slate-200">{bucketOwner ?? (loadingBucket || bucketAclLoading ? "Loading..." : "Unknown")}</span>
                  </p>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    High-level usage and which advanced properties are currently active.
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
                <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Bucket properties</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">Summary of enabled features.</p>
                    </div>
                    {(propsLoading || lifecycleLoading) && (
                      <span className="ui-caption font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-200">Updating…</span>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {propertySummary.map((item) => (
                      <PropertySummaryChip key={item.label} label={item.label} state={item.state} tone={item.tone} />
                    ))}
                  </div>
                </div>
              </section>
            ),
          },
          ...(!isCephAdmin
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
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body ${
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
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"
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
                            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ui-body ${
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
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => loadObjects(currentPrefix)}
                          className="rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Refresh
                        </button>
                        <button
                          type="button"
                          disabled={selectedKeys.length !== 1}
                          onClick={handleDownload}
                          className="rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 transition hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          Download
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowUpload(true)}
                          className="rounded-lg bg-primary px-3 py-2 ui-body font-semibold text-white shadow-sm hover:bg-primary-600"
                        >
                          Upload
                        </button>
                        <button
                          type="button"
                          onClick={handleNewFolder}
                          className="rounded-lg border border-slate-200 px-3 py-2 ui-body font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        >
                          New folder
                        </button>
                        <button
                          type="button"
                          disabled={selectedKeys.length === 0}
                          onClick={handleDelete}
                          className="rounded-lg border border-rose-200 px-3 py-2 ui-body font-semibold text-rose-700 transition hover:border-rose-300 hover:text-rose-800 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-700 dark:hover:text-rose-100"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    {actionMessage && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                        {actionMessage}
                      </div>
                    )}
                    {objectsError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                        {objectsError}
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-200 dark:border-slate-800">
                      <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                        <thead className="bg-slate-50 dark:bg-slate-900/50">
                          <tr>
                            <th className="px-4 py-2 text-left">
                              <input
                                type="checkbox"
                                checked={selectedKeys.length > 0 && selectedKeys.length === objectRows.length}
                                onChange={(e) =>
                                  setSelectedKeys(e.target.checked ? objectRows.map((r) => r.key) : [])
                                }
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                            </th>
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
                              <td colSpan={5} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
                                Loading objects...
                              </td>
                            </tr>
                          )}
                          {!objectsLoading && rowData.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-4 py-3 ui-body text-slate-500 dark:text-slate-400">
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
                                    <td className="px-4 py-2" />
                                    <td className="px-4 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                      📁 {row.name}
                                    </td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                    <td className="px-4 py-2 text-slate-600 dark:text-slate-300">—</td>
                                  </tr>
                                );
                              }
                              const isSelected = selectedKeys.includes(row.key);
                              return (
                                <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                  <td className="px-4 py-2">
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelection(row.key)}
                                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                                    />
                                  </td>
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
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">RGW status</p>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">Versioning, Object Lock, lifecycle.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      loadProperties();
                      loadLifecycle();
                      loadWebsite();
                    }}
                    className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                  >
                    Refresh
                  </button>
                </div>
                {propsLoading && (
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-body text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                    Loading properties...
                  </div>
                )}
                {propsError && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                    {propsError}
                  </div>
                )}
                {properties && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className={bucketCardClass}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Versioning</p>
                            <p className="ui-caption text-slate-500 dark:text-slate-400">Status returned by RGW.</p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 ui-caption font-semibold ${featureStateChipClasses[versioningChipState]}`}
                          >
                            {versioningStatusLabel}
                          </span>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            Keeps object history for restores and is required for Object Lock.
                          </p>
                          <button
                            type="button"
                            onClick={toggleVersioning}
                            disabled={updatingVersioning || (versioningIsEnabled && objectLockActive)}
                            title={
                              versioningIsEnabled && objectLockActive ? "Disable Object Lock to change versioning." : undefined
                            }
                            className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                          >
                            {updatingVersioning
                              ? "Updating..."
                              : (properties.versioning_status ?? "").toLowerCase() === "enabled"
                                ? "Disable"
                                : "Enable"}
                          </button>
                        </div>
                        {versioningIsEnabled && objectLockActive && (
                          <p className="mt-2 ui-caption text-slate-500 dark:text-slate-400">
                            Versioning cannot be disabled while Object Lock is enabled.
                          </p>
                        )}
                      </div>
                      <div className={bucketCardClass}>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Object Lock</p>
                            <p className="ui-caption text-slate-500 dark:text-slate-400">
                              WORM / default retention (bucket created with the Object Lock option).
                            </p>
                          </div>
                          <span
                            className={`rounded-full px-3 py-1 ui-caption font-semibold ${featureStateChipClasses[objectLockChipState]}`}
                          >
                            {objectLockStatusLabel}
                          </span>
                        </div>
                        <div className="mt-3 space-y-2">
                          {objectLockError && (
                            <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                              {objectLockError}
                            </div>
                          )}
                          {objectLockStatus && (
                            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 ui-caption font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                              {objectLockStatus}
                            </div>
                          )}
                          <form className="space-y-2" onSubmit={handleSaveObjectLock}>
                            <label className="flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                              <input
                                type="checkbox"
                                checked={objectLockEnabled ?? false}
                                onChange={(e) => {
                                  if (objectLockPersistentlyEnabled) return;
                                  setObjectLockEnabled(e.target.checked);
                                }}
                                disabled={objectLockPersistentlyEnabled}
                                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                              />
                              Enable Object Lock
                            </label>
                            {objectLockPersistentlyEnabled && (
                              <p className="ui-caption text-slate-500 dark:text-slate-400">
                                Object Lock cannot be disabled once it has been enabled on the bucket. Update only the default retention below.
                              </p>
                            )}
                            {objectLockActive && (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                                Warning: while Object Lock is enabled, objects cannot be deleted until the specified retention period ends. Review mode and retention before saving changes.
                              </div>
                            )}
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                              <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                                Mode
                                <select
                                  value={objectLockMode}
                                  onChange={(e) => setObjectLockMode(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                >
                                  <option value="">(none)</option>
                                  <option value="GOVERNANCE">Governance</option>
                                  <option value="COMPLIANCE">Compliance</option>
                                </select>
                              </label>
                              <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                                Retention (days)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={objectLockDays}
                                  onChange={(e) => setObjectLockDays(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  placeholder="e.g. 30"
                                />
                              </label>
                              <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                                Retention (years)
                                <input
                                  type="number"
                                  min={0}
                                  step="1"
                                  value={objectLockYears}
                                  onChange={(e) => setObjectLockYears(e.target.value)}
                                  className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  placeholder="e.g. 1"
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
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => applyObjectLockState(objectLockConfig)}
                                className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                                disabled={propsLoading || savingObjectLock}
                              >
                                Reset
                              </button>
                              <button
                                type="submit"
                                disabled={savingObjectLock || propsLoading}
                                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                              >
                                {savingObjectLock ? "Updating..." : "Save"}
                              </button>
                            </div>
                          </form>
                        </div>
                        <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                          Choose a mode plus days or years. Leave it empty to remove the default retention (Object Lock must already be enabled on the bucket).
                        </p>
                      </div>
                    </div>
                    <div className={bucketCardClass}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Lifecycle rules</p>
                          <p className="ui-caption text-slate-500 dark:text-slate-400">
                            S3-side expiration/clean-up (JSON first, simple editor to add a rule).
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="ui-caption text-slate-500 dark:text-slate-400">{(lifecycle.rules ?? []).length} rule(s)</span>
                          <button
                            type="button"
                            onClick={() => setShowLifecycleEditor((prev) => !prev)}
                            className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                          >
                            {showLifecycleEditor ? "Hide editor" : "Show editor"}
                          </button>
                        </div>
                      </div>
                      {lifecycleLoading && (
                        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-body text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                          Loading lifecycle rules...
                        </div>
                      )}
                      {lifecycleError && (
                        <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                          {lifecycleError}
                        </div>
                      )}
                      {lifecycleStatus && (
                        <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                          {lifecycleStatus}
                        </div>
                      )}
                      <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
                        {(lifecycle.rules?.length ?? 0) === 0 ? (
                          <p className="ui-caption text-slate-600 dark:text-slate-300">No rules configured on this bucket.</p>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="min-w-full divide-y divide-slate-200 ui-body dark:divide-slate-800">
                              <thead className="bg-slate-100 dark:bg-slate-900/60">
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
                                {lifecycle.rules?.map((rule, idx) => {
                                  const filter = (rule as any).Filter as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
                                  let filterLabel = "-";
                                  if (filter?.Prefix) filterLabel = `Prefix: ${filter.Prefix}`;
                                  if (filter?.Tag) filterLabel = `Tag: ${filter.Tag.Key}=${filter.Tag.Value}`;
                                  if (filter?.And) {
                                    const andPrefix = filter.And.Prefix ? `Prefix: ${filter.And.Prefix}` : "";
                                    const andTags =
                                      Array.isArray(filter.And.Tags) && filter.And.Tags.length > 0
                                        ? `Tags: ${filter.And.Tags.map((t: any) => `${t.Key}=${t.Value}`).join(", ")}`
                                        : "";
                                    filterLabel = [andPrefix, andTags].filter(Boolean).join(" · ") || "Combined filter";
                                  }
                                  return (
                                    <tr
                                      key={`${(rule as any).ID ?? (rule as any).Prefix ?? "rule"}-${idx}`}
                                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50"
                                    >
                                      <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">
                                        {(rule as any).ID ?? "(no ID)"}
                                      </td>
                                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                                        <button
                                          type="button"
                                          onClick={() => toggleRuleStatusAt(idx)}
                                          className={`flex items-center gap-2 rounded-full px-3 py-1 ui-caption font-semibold ${
                                            (rule as any).Status === "Disabled"
                                              ? "border border-slate-300 text-slate-600 dark:border-slate-700 dark:text-slate-200"
                                              : "border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-100"
                                          }`}
                                          disabled={savingLifecycle || lifecycleLoading}
                                        >
                                          {(rule as any).Status === "Disabled" ? "Disabled" : "Enabled"}
                                        </button>
                                      </td>
                                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{filterLabel}</td>
                                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{describeLifecycleActions(rule as any)}</td>
                                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => deleteRuleAt(idx)}
                                            className="rounded border border-rose-200 px-2 py-1 ui-caption font-semibold text-rose-700 hover:border-rose-300 hover:text-rose-800 dark:border-rose-900/40 dark:text-rose-100"
                                            disabled={savingLifecycle || lifecycleLoading}
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
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <div className="flex overflow-hidden rounded-lg border border-slate-200 ui-caption font-semibold dark:border-slate-700">
                              <button
                                type="button"
                                onClick={() => setLifecycleMode("json")}
                                className={`px-3 py-1 ${lifecycleMode === "json" ? "bg-primary text-white" : "bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"}`}
                              >
                                JSON
                              </button>
                              <button
                                type="button"
                                onClick={() => setLifecycleMode("simple")}
                                className={`px-3 py-1 ${lifecycleMode === "simple" ? "bg-primary text-white" : "bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800/60"}`}
                              >
                                Quick add
                              </button>
                            </div>
                          </div>
                          {lifecycleMode === "simple" ? (
                            <div className="mt-3 space-y-3">
                              {simpleLifecycleWarning && (
                                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/50 dark:text-amber-100">
                                  {simpleLifecycleWarning}
                                </div>
                              )}
                              <p className="ui-caption text-slate-600 dark:text-slate-300">
                                Quickly add one of the preconfigured rules below (appended to the existing configuration).
                              </p>
                              <div className="space-y-3">
                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
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
                                      disabled={savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">Rule 2: current/noncurrent transitions</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className="flex flex-col gap-1">
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={transitionCurrentDays}
                                        onChange={(e) => setTransitionCurrentDays(e.target.value)}
                                        className="w-28 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={transitionNoncurrentDays}
                                        onChange={(e) => setTransitionNoncurrentDays(e.target.value)}
                                        className="w-28 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Storage class
                                      <input
                                        type="text"
                                        value={transitionStorageClass}
                                        onChange={(e) => setTransitionStorageClass(e.target.value)}
                                        className="w-32 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                        placeholder="GLACIER"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={transitionPrefix}
                                        onChange={(e) => setTransitionPrefix(e.target.value)}
                                        className="w-32 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                        placeholder="logs/"
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
                                      disabled={savingLifecycle || lifecycleLoading}
                                    >
                                      Add
                                    </button>
                                  </div>
                                </div>

                                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                  <p className="ui-caption font-semibold text-slate-700 dark:text-slate-100">Rule 3: current/noncurrent expiration</p>
                                  <div className="mt-2 flex flex-wrap items-end gap-3 ui-caption">
                                    <label className="flex flex-col gap-1">
                                      Current versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={expireCurrentDays}
                                        onChange={(e) => setExpireCurrentDays(e.target.value)}
                                        className="w-32 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Noncurrent versions expiration (days)
                                      <input
                                        type="number"
                                        min={0}
                                        value={expireNoncurrentDays}
                                        onChange={(e) => setExpireNoncurrentDays(e.target.value)}
                                        className="w-32 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                      />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                      Prefix (optional)
                                      <input
                                        type="text"
                                        value={expirePrefix}
                                        onChange={(e) => setExpirePrefix(e.target.value)}
                                        className="w-32 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                        placeholder="archive/"
                                      />
                                    </label>
                                  </div>
                                  <div className="mt-2 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddExampleRule({
                                          Status: "Enabled",
                                          Filter: { Prefix: expirePrefix },
                                          Expiration: { Days: Number(expireCurrentDays) || 0 },
                                          NoncurrentVersionExpiration: { NoncurrentDays: Number(expireNoncurrentDays) || 0 },
                                        })
                                      }
                                      className="ui-caption font-semibold text-primary hover:text-primary-600 disabled:opacity-60"
                                      disabled={savingLifecycle || lifecycleLoading}
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
                                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                              />
                            </div>
                          )}
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={loadLifecycle}
                                disabled={lifecycleLoading || savingLifecycle}
                                className="rounded-md border border-slate-200 px-3 py-1 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                              >
                                Reload
                              </button>
                              <button
                                type="button"
                                onClick={saveLifecycle}
                                disabled={savingLifecycle || lifecycleLoading}
                                className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                              >
                                {savingLifecycle ? "Saving..." : "Save"}
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                    <div className={`${bucketCardClass} space-y-3 ${staticWebsiteBlocked ? "opacity-60" : ""}`}>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Static website</p>
                            <p className="ui-caption text-slate-500 dark:text-slate-400">
                              Host a static website from this bucket or redirect all requests.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={loadWebsite}
                              className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                              disabled={websiteLoading || staticWebsiteBlocked}
                            >
                              {websiteLoading ? "Loading..." : "Refresh"}
                            </button>
                            <button
                              type="button"
                              onClick={saveWebsite}
                              disabled={savingWebsite || websiteLoading || staticWebsiteBlocked}
                              className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                            >
                              {savingWebsite ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={clearWebsite}
                              disabled={clearingWebsite || staticWebsiteBlocked}
                              className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                            >
                              {clearingWebsite ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        </div>
                        {staticWebsiteBlocked && (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 ui-caption text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-100">
                            Static website is disabled for this endpoint. Enable it in the Ceph endpoint configuration.
                          </div>
                        )}
                        {websiteError && (
                          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                            {websiteError}
                          </div>
                        )}
                        {websiteStatus && (
                          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                            {websiteStatus}
                          </div>
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
                              disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
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
                              disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
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
                              <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                                Index document
                                <input
                                  type="text"
                                  value={websiteIndexDocument}
                                  onChange={(e) => {
                                    setWebsiteIndexDocument(e.target.value);
                                    setWebsiteStatus(null);
                                  }}
                                  className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  placeholder="index.html"
                                  disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                                />
                              </label>
                              <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                                Error document (optional)
                                <input
                                  type="text"
                                  value={websiteErrorDocument}
                                  onChange={(e) => {
                                    setWebsiteErrorDocument(e.target.value);
                                    setWebsiteStatus(null);
                                  }}
                                  className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                  placeholder="error.html"
                                  disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
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
                                className="w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                placeholder="[]"
                                spellCheck={false}
                                disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                              />
                              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                                <button
                                  type="button"
                                  onClick={() => setShowWebsiteRulesExample((prev) => !prev)}
                                  className="ui-caption font-semibold text-primary hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
                                >
                                  {showWebsiteRulesExample ? "Hide example" : "Show example"}
                                </button>
                                {showWebsiteRulesExample && (
                                  <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">
{`[
  {
    "Condition": { "KeyPrefixEquals": "docs/" },
    "Redirect": { "ReplaceKeyPrefixWith": "documents/" }
  },
  {
    "Condition": { "HttpErrorCodeReturnedEquals": "404" },
    "Redirect": { "ReplaceKeyWith": "error.html" }
  }
]`}
                                  </pre>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-2">
                            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                              Redirect hostname
                              <input
                                type="text"
                                value={websiteRedirectHost}
                                onChange={(e) => {
                                  setWebsiteRedirectHost(e.target.value);
                                  setWebsiteStatus(null);
                                }}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                placeholder="www.example.com"
                                disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                              />
                            </label>
                            <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                              Protocol (optional)
                              <input
                                type="text"
                                value={websiteRedirectProtocol}
                                onChange={(e) => {
                                  setWebsiteRedirectProtocol(e.target.value);
                                  setWebsiteStatus(null);
                                }}
                                className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                                placeholder="https"
                                disabled={websiteLoading || savingWebsite || clearingWebsite || staticWebsiteBlocked}
                              />
                            </label>
                            <p className="md:col-span-2 ui-caption text-slate-500 dark:text-slate-400">
                              All requests will redirect to the host above. Index and routing rules are ignored.
                            </p>
                          </div>
                        )}
                      </div>
                  </>
                )}
              </div>
            ),
          },
          {
            id: "permissions",
            label: "Permissions",
            content: (
              <div className="space-y-4">
                <div className={`space-y-3 ${bucketCardClass}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Block public access</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Manage the four S3 public access block flags. Configure each option below.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {publicAccessStatus && (
                        <span className="ui-caption font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-200">
                          {publicAccessStatus}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={loadPublicAccessBlock}
                        disabled={publicAccessLoading || savingPublicAccess}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-60 dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                      >
                        {publicAccessLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={savePublicAccessBlock}
                        disabled={publicAccessLoading || savingPublicAccess}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {savingPublicAccess ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                  {publicAccessError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {publicAccessError}
                    </div>
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
                          disabled={publicAccessLoading || savingPublicAccess}
                          className="h-5 w-5 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <div className={`space-y-3 ${bucketCardClass}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Access control list</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Configure a canned ACL and review resulting grants.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={loadBucketAcl}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        disabled={bucketAclLoading}
                      >
                        {bucketAclLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={saveBucketAcl}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                        disabled={savingBucketAcl || bucketAclLoading}
                      >
                        {savingBucketAcl ? "Saving..." : "Save ACL"}
                      </button>
                    </div>
                  </div>
                  {bucketAclError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {bucketAclError}
                    </div>
                  )}
                  {bucketAclStatus && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                      {bucketAclStatus}
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                      Canned ACL
                      <select
                        value={bucketAclPreset}
                        onChange={(e) => {
                          setBucketAclPreset(e.target.value);
                          setBucketAclStatus(null);
                          setBucketAclError(null);
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        disabled={bucketAclLoading || savingBucketAcl}
                      >
                        {bucketAclOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {bucketAclPreset === "custom" && (
                      <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                        Custom ACL
                        <input
                          type="text"
                          value={bucketAclCustom}
                          onChange={(e) => {
                            setBucketAclCustom(e.target.value);
                            setBucketAclStatus(null);
                          }}
                          className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="e.g. private"
                          disabled={bucketAclLoading || savingBucketAcl}
                        />
                      </label>
                    )}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Saving a canned ACL replaces the current ACL grants.
                  </p>
                  {bucketAclLoading ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-body text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200">
                      Loading ACL...
                    </div>
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
                </div>

                <div className={`space-y-4 ${bucketCardClass}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Bucket policy</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">IAM-like JSON applied directly on the bucket.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          loadPolicy();
                          loadCors();
                        }}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        disabled={policyLoading}
                      >
                        {policyLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={savePolicy}
                        disabled={savingPolicy || policyLoading}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {savingPolicy ? "Saving..." : "Save policy"}
                      </button>
                      <button
                        type="button"
                        onClick={removePolicy}
                        disabled={deletingPolicy}
                        className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                      >
                        {deletingPolicy ? "Deleting..." : "Delete policy"}
                      </button>
                    </div>
                  </div>
                  {policyError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {policyError}
                    </div>
                  )}
                  <textarea
                    value={policyText}
                    onChange={(e) => setPolicyText(e.target.value)}
                    className="h-72 w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder='{"Version":"2012-10-17","Statement":[...]}'
                    spellCheck={false}
                  />
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={() => setShowPolicyExample((prev) => !prev)}
                      className="ui-caption font-semibold text-primary hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
                    >
                      {showPolicyExample ? "Hide example" : "Show example"}
                    </button>
                    {showPolicyExample && (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">
{`{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${bucketName || "bucket"}/*"
    }
  ]
}`}
                      </pre>
                    )}
                  </div>
                </div>

                <div className={`space-y-3 ${bucketCardClass}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">CORS</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">CORS rules in AWS format (CORSRules).</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={loadCors}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        disabled={corsLoading}
                      >
                        {corsLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={saveCors}
                        disabled={savingCors || corsLoading}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {savingCors ? "Saving..." : "Save CORS"}
                      </button>
                      <button
                        type="button"
                        onClick={removeCors}
                        disabled={deletingCors}
                        className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                      >
                        {deletingCors ? "Deleting..." : "Delete CORS"}
                      </button>
                    </div>
                  </div>
                  {corsError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {corsError}
                    </div>
                  )}
                  <textarea
                    value={corsText}
                    onChange={(e) => setCorsText(e.target.value)}
                    className="h-56 w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder='[{"AllowedMethods":["GET"],"AllowedOrigins":["*"]}]'
                    spellCheck={false}
                  />
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                    <button
                      type="button"
                      onClick={() => setShowCorsExample((prev) => !prev)}
                      className="ui-caption font-semibold text-primary hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
                    >
                      {showCorsExample ? "Hide example" : "Show example"}
                    </button>
                    {showCorsExample && (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">
{`[
  {
    "AllowedMethods": ["GET", "PUT"],
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedHeaders": ["*"]
  }
]`}
                      </pre>
                    )}
                  </div>
                </div>

              </div>
            ),
          },
          {
            id: "advanced",
            label: "Advanced",
            content: (
              <div className="space-y-3">
                <div className={`${bucketCardClass} space-y-3`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Server access logging</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        Deliver S3 server access logs to another bucket.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={loadAccessLogging}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        disabled={accessLoggingLoading}
                      >
                        {accessLoggingLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={saveAccessLogging}
                        disabled={savingAccessLogging || accessLoggingLoading}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {savingAccessLogging ? "Saving..." : "Save"}
                      </button>
                      <button
                        type="button"
                        onClick={clearAccessLogging}
                        disabled={clearingAccessLogging}
                        className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                      >
                        {clearingAccessLogging ? "Disabling..." : "Disable"}
                      </button>
                    </div>
                  </div>
                  {accessLoggingError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {accessLoggingError}
                    </div>
                  )}
                  {accessLoggingStatus && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                      {accessLoggingStatus}
                    </div>
                  )}
                  <label className="flex items-center gap-2 ui-caption font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      checked={accessLoggingEnabled}
                      onChange={(e) => {
                        setAccessLoggingEnabled(e.target.checked);
                        setAccessLoggingStatus(null);
                        setAccessLoggingError(null);
                      }}
                      disabled={accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary dark:border-slate-600"
                    />
                    Enable server access logging
                  </label>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                      Target bucket
                      <input
                        type="text"
                        value={accessLoggingTargetBucket}
                        onChange={(e) => {
                          setAccessLoggingTargetBucket(e.target.value);
                          setAccessLoggingStatus(null);
                          setAccessLoggingError(null);
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="logs-bucket"
                        disabled={accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      />
                    </label>
                    <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                      Target prefix (optional)
                      <input
                        type="text"
                        value={accessLoggingTargetPrefix}
                        onChange={(e) => {
                          setAccessLoggingTargetPrefix(e.target.value);
                          setAccessLoggingStatus(null);
                          setAccessLoggingError(null);
                        }}
                        className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        placeholder="access-logs/"
                        disabled={accessLoggingLoading || savingAccessLogging || clearingAccessLogging}
                      />
                    </label>
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    The target bucket must allow log delivery (e.g., ACL <code className="font-mono ui-caption">log-delivery-write</code>
                    or an equivalent policy).
                  </p>
                </div>
                <div className={`${bucketCardClass} space-y-3`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="ui-body font-semibold text-slate-900 dark:text-slate-50">Notifications / SNS topics</p>
                      <p className="ui-caption text-slate-500 dark:text-slate-400">
                        JSON payload forwarded to <code className="font-mono ui-caption">put_bucket_notification_configuration</code>.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={loadNotifications}
                        className="rounded-md border border-slate-200 px-3 py-1.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100 dark:hover:border-primary-500 dark:hover:text-primary-100"
                        disabled={notificationsLoading}
                      >
                        {notificationsLoading ? "Loading..." : "Refresh"}
                      </button>
                      <button
                        type="button"
                        onClick={saveNotifications}
                        disabled={savingNotifications || notificationsLoading}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                      >
                        {savingNotifications ? "Saving..." : "Save notifications"}
                      </button>
                      <button
                        type="button"
                        onClick={clearNotifications}
                        disabled={clearingNotifications}
                        className="rounded-md border border-rose-200 px-3 py-1.5 ui-caption font-semibold text-rose-700 hover:border-rose-400 hover:text-rose-800 disabled:opacity-60 dark:border-rose-900/50 dark:text-rose-200 dark:hover:border-rose-800"
                      >
                        {clearingNotifications ? "Clearing..." : "Clear"}
                      </button>
                    </div>
                  </div>
                  {notificationsError && (
                    <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                      {notificationsError}
                    </div>
                  )}
                  {notificationsStatus && (
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 ui-body font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                      {notificationsStatus}
                    </div>
                  )}
                  <textarea
                    value={notificationText}
                    onChange={(e) => {
                      setNotificationText(e.target.value);
                      if (notificationsStatus) {
                        setNotificationsStatus(null);
                      }
                    }}
                    className="h-64 w-full rounded-md border border-slate-200 px-3 py-2 font-mono ui-caption text-slate-800 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    placeholder={defaultNotificationTemplate}
                    spellCheck={false}
                  />
                  <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 ui-caption text-slate-600 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-300">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowNotificationExample((prev) => !prev)}
                        className="ui-caption font-semibold text-primary hover:text-primary-700 dark:text-primary-200 dark:hover:text-primary-100"
                      >
                        {showNotificationExample ? "Hide example" : "Show example"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setNotificationText(notificationExample);
                          setNotificationsStatus(null);
                        }}
                        className="rounded-full border border-slate-200 px-2 py-0.5 ui-caption font-semibold text-slate-700 hover:border-primary hover:text-primary dark:border-slate-700 dark:text-slate-100"
                      >
                        Use example
                      </button>
                      <span className="ui-caption text-slate-500 dark:text-slate-400">
                        Need a topic? Create it in the Topics section.
                      </span>
                    </div>
                    {showNotificationExample && (
                      <pre className="mt-2 whitespace-pre-wrap rounded bg-slate-900 px-3 py-2 ui-caption text-slate-100">
                        {notificationExample}
                      </pre>
                    )}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">
                    Only topic-based notifications are supported. Each entry should include{" "}
                    <code className="font-mono ui-caption">TopicArn</code>, <code className="font-mono ui-caption">Events</code>, and
                    an optional filter.
                  </p>
                </div>
              </div>
            ),
          },
          {
            id: "metrics",
            label: "Metrics",
            content: (
              <div className="space-y-4">
                <section className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <header className="space-y-1">
                    <p className="ui-caption font-semibold uppercase tracking-wide text-primary">RGW Stats</p>
                    <h3 className="ui-subtitle font-semibold text-slate-900 dark:text-slate-100">Current Usage and Quota</h3>
                    <p className="ui-caption text-slate-500 dark:text-slate-400">
                      Live usage, quotas, and traffic sourced from RGW logs.
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
                </section>
                {hasAccountContext && bucketName ? (
                  <TrafficAnalytics accountId={accountIdForApi} bucketName={bucketName} enabled={hasAccountContext} />
                ) : (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 ui-body text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
                    Select an account and a bucket to view detailed metrics.
                  </div>
                )}
              </div>
            ),
          },
          {
            id: "ceph",
            label: "Ceph",
            content: (
              <div className="space-y-3">
                <div className={`${bucketCardClass} opacity-50 pointer-events-none`}>
                  <div className="flex items-center justify-between">
                    <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">Quota</p>
                    {!isAdmin && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        Restricted
                      </span>
                    )}
                  </div>
                  <p className="ui-caption text-slate-500 dark:text-slate-400">Allowed bucket size and object count.</p>
                  <form className={`mt-2 space-y-2 ${!isAdmin ? "pointer-events-none" : ""}`} onSubmit={handleUpdateQuota}>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                        Size
                        <div className="flex gap-2">
                          <input
                            type="number"
                            min={0}
                            step="0.1"
                            value={quotaSizeGb}
                            onChange={(e) => setQuotaSizeGb(e.target.value)}
                            className="flex-1 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            placeholder="e.g. 100"
                            disabled={!isAdmin}
                          />
                          <select
                            value={quotaSizeUnit}
                            onChange={(e) => setQuotaSizeUnit(e.target.value as "MiB" | "GiB" | "TiB")}
                            className="w-20 rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                            disabled={!isAdmin}
                          >
                            <option value="MiB">MiB</option>
                            <option value="GiB">GiB</option>
                            <option value="TiB">TiB</option>
                          </select>
                        </div>
                      </label>
                      <label className="flex flex-col gap-1 ui-caption font-medium text-slate-700 dark:text-slate-200">
                        Object count
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={quotaObjects}
                          onChange={(e) => setQuotaObjects(e.target.value)}
                          className="rounded-md border border-slate-200 px-2 py-1 ui-body focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                          placeholder="e.g. 1000000"
                          disabled={!isAdmin}
                        />
                      </label>
                    </div>
                    {quotaStatus && (
                      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 ui-caption font-semibold text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/60 dark:text-emerald-100">
                        {quotaStatus}
                      </div>
                    )}
                    {quotaError && (
                      <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 ui-caption font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                        {quotaError}
                      </div>
                    )}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={updatingQuota || !isAdmin}
                        className="rounded-md bg-primary px-3 py-1.5 ui-caption font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
                        title={!isAdmin ? "Admins only" : undefined}
                      >
                        {updatingQuota ? "Updating..." : "Save"}
                      </button>
                    </div>
                  </form>
                  <p className="mt-1 ui-caption text-slate-500 dark:text-slate-400">
                    Leave empty to remove the quota. {isAdmin ? "" : "(Read-only for this role.)"}
                  </p>
                </div>
                <InfoCard
                  title="Replication / multisite"
                  description="Set up inter-cluster replication."
                  disabled
                />
              </div>
            ),
          },
        ]}
      />

      {showUpload && (
        <Modal title="Upload object" onClose={() => setShowUpload(false)}>
          <form className="space-y-4" onSubmit={handleUpload}>
            <div className="space-y-1">
              <p className="ui-body font-semibold text-slate-800 dark:text-slate-100">Destination</p>
              <p className="ui-caption text-slate-500 dark:text-slate-400">
                {bucketName}/{currentPrefix || "(root)"}
              </p>
            </div>
            <div className="space-y-2">
              <label className="ui-body font-medium text-slate-700 dark:text-slate-200">File</label>
              <input
                type="file"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-md border border-slate-200 px-3 py-2 ui-body dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </div>
            {uploadError && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 ui-body text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/60 dark:text-rose-100">
                {uploadError}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowUpload(false)}
                className="rounded-md border border-slate-200 px-4 py-2 ui-body font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={uploading}
                className="rounded-md bg-primary px-4 py-2 ui-body font-semibold text-white shadow-sm transition hover:bg-primary-600 disabled:opacity-60"
              >
                {uploading ? "Uploading..." : "Upload"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function InfoCard({ title, description, badge, disabled }: { title: string; description: string; badge?: string; disabled?: boolean }) {
  return (
    <div className={`${bucketCardClass} ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <div className="flex items-center gap-2">
        <p className="ui-body font-semibold text-slate-900 dark:text-slate-100">{title}</p>
        {badge && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 ui-caption font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {badge}
          </span>
        )}
      </div>
      <p className="ui-body text-slate-600 dark:text-slate-300">{description}</p>
    </div>
  );
}
