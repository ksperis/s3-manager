import type { ManagerToolAccess } from "../../api/users";

export type PortalAccountRole = "portal_user" | "portal_manager" | "account_administrator";
export type ManagerToolKey = keyof ManagerToolAccess;

export type ManagerToolDefinition = {
  key: ManagerToolKey;
  title: string;
  description: string;
  enabled: boolean;
};

export const DEFAULT_MANAGER_TOOL_ACCESS: ManagerToolAccess = {
  bucket_compare: false,
  bucket_integrity_check: false,
  bucket_migration: false,
  bucket_purge: false,
  feature_rules: false,
  bucket_quota: false,
  ceph_s3_user_keys: false,
};

export const PORTAL_ROLE_OPTIONS: { value: PortalAccountRole; label: string }[] = [
  { value: "portal_user", label: "Portal user" },
  { value: "portal_manager", label: "Portal manager" },
  { value: "account_administrator", label: "Account administrator" },
];

export function normalizePortalRole(value?: string | null): PortalAccountRole {
  if (value === "portal_user" || value === "portal_manager" || value === "account_administrator") return value;
  return "portal_user";
}

export function normalizeManagerToolAccess(access?: ManagerToolAccess | null): ManagerToolAccess {
  return {
    bucket_compare: Boolean(access?.bucket_compare),
    bucket_integrity_check: Boolean(access?.bucket_integrity_check),
    bucket_migration: Boolean(access?.bucket_migration),
    bucket_purge: Boolean(access?.bucket_purge),
    feature_rules: Boolean(access?.feature_rules),
    bucket_quota: Boolean(access?.bucket_quota),
    ceph_s3_user_keys: Boolean(access?.ceph_s3_user_keys),
  };
}

export function buildManagerToolDefinitions(settings: {
  bucket_compare_enabled?: boolean | null;
  bucket_integrity_check_enabled?: boolean | null;
  bucket_migration_enabled?: boolean | null;
  bucket_purge_enabled?: boolean | null;
  manager_ceph_s3_user_keys_enabled?: boolean | null;
}): ManagerToolDefinition[] {
  return [
    {
      key: "bucket_compare",
      title: "Bucket compare",
      description: "Allow access to Manager > Tools > Compare.",
      enabled: Boolean(settings.bucket_compare_enabled),
    },
    {
      key: "bucket_integrity_check",
      title: "Bucket integrity check",
      description: "Allow access to Manager > Tools > Integrity.",
      enabled: Boolean(settings.bucket_integrity_check_enabled),
    },
    {
      key: "bucket_migration",
      title: "Bucket migration",
      description: "Allow access to Manager > Tools > Migration.",
      enabled: Boolean(settings.bucket_migration_enabled),
    },
    {
      key: "bucket_purge",
      title: "Bucket purge",
      description: "Allow access to Manager > Tools > Purge.",
      enabled: Boolean(settings.bucket_purge_enabled),
    },
    {
      key: "feature_rules",
      title: "Feature rule inventory",
      description: "Allow access to Manager > Tools > Feature rules.",
      enabled: true,
    },
    {
      key: "bucket_quota",
      title: "Bucket quota management",
      description: "Allow privileged Ceph bucket quota updates in Manager and Storage Ops.",
      enabled: true,
    },
    {
      key: "ceph_s3_user_keys",
      title: "Ceph S3 User keys",
      description: "Allow access to Manager > Ceph > Access keys.",
      enabled: Boolean(settings.manager_ceph_s3_user_keys_enabled),
    },
  ];
}
