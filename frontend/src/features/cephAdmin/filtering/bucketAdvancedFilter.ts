export type FeatureTriState = "any" | "true" | "false";
export type NumericComparisonOpUi = "=" | "!=" | ">" | ">=" | "<" | "<=";
export type LifecycleRuleNameMode = "any" | "has_named" | "has_not_named";
export type PresenceMode = "any" | "has" | "has_not";
export type LifecycleRuleTypeValue =
  | ""
  | "expiration"
  | "delete_markers"
  | "noncurrent_expiration"
  | "abort_multipart"
  | "transition"
  | "noncurrent_transition";

export type FeatureDetailFilters = {
  lifecycleRuleNameMode: LifecycleRuleNameMode;
  lifecycleRuleName: string;
  lifecycleRuleTypeMode: PresenceMode;
  lifecycleRuleTypeValue: LifecycleRuleTypeValue;
  lifecycleExpirationDaysOp: NumericComparisonOpUi;
  lifecycleExpirationDays: string;
  lifecycleNoncurrentExpirationDaysOp: NumericComparisonOpUi;
  lifecycleNoncurrentExpirationDays: string;
  lifecycleTransitionDaysOp: NumericComparisonOpUi;
  lifecycleTransitionDays: string;
  lifecycleAbortDaysOp: NumericComparisonOpUi;
  lifecycleAbortDays: string;
  objectLockMode: "" | "GOVERNANCE" | "COMPLIANCE";
  objectLockRetentionOp: NumericComparisonOpUi;
  objectLockRetentionDays: string;
  bpaBlockPublicAcls: FeatureTriState;
  bpaIgnorePublicAcls: FeatureTriState;
  bpaBlockPublicPolicy: FeatureTriState;
  bpaRestrictPublicBuckets: FeatureTriState;
  corsMethodMode: PresenceMode;
  corsMethodValue: string;
  corsOriginMode: PresenceMode;
  corsOriginValue: string;
  loggingEnabled: FeatureTriState;
  loggingTargetBucket: string;
  websiteIndexPresent: FeatureTriState;
  websiteRedirectHostPresent: FeatureTriState;
  policyStatementOp: NumericComparisonOpUi;
  policyStatementCount: string;
  policyHasConditions: FeatureTriState;
};
export type FeatureDetailFilterKey = keyof FeatureDetailFilters;

export const defaultFeatureDetailFilters: FeatureDetailFilters = {
  lifecycleRuleNameMode: "any",
  lifecycleRuleName: "",
  lifecycleRuleTypeMode: "any",
  lifecycleRuleTypeValue: "",
  lifecycleExpirationDaysOp: "=",
  lifecycleExpirationDays: "",
  lifecycleNoncurrentExpirationDaysOp: "=",
  lifecycleNoncurrentExpirationDays: "",
  lifecycleTransitionDaysOp: "=",
  lifecycleTransitionDays: "",
  lifecycleAbortDaysOp: "=",
  lifecycleAbortDays: "",
  objectLockMode: "",
  objectLockRetentionOp: ">=",
  objectLockRetentionDays: "",
  bpaBlockPublicAcls: "any",
  bpaIgnorePublicAcls: "any",
  bpaBlockPublicPolicy: "any",
  bpaRestrictPublicBuckets: "any",
  corsMethodMode: "any",
  corsMethodValue: "",
  corsOriginMode: "any",
  corsOriginValue: "",
  loggingEnabled: "any",
  loggingTargetBucket: "",
  websiteIndexPresent: "any",
  websiteRedirectHostPresent: "any",
  policyStatementOp: ">=",
  policyStatementCount: "",
  policyHasConditions: "any",
};

const NUMERIC_UI_TO_RULE_OP: Record<NumericComparisonOpUi, "eq" | "neq" | "gt" | "gte" | "lt" | "lte"> = {
  "=": "eq",
  "!=": "neq",
  ">": "gt",
  ">=": "gte",
  "<": "lt",
  "<=": "lte",
};

const TRI_STATES: FeatureTriState[] = ["any", "true", "false"];
const LIFECYCLE_NAME_MODES: LifecycleRuleNameMode[] = ["any", "has_named", "has_not_named"];
const PRESENCE_MODES: PresenceMode[] = ["any", "has", "has_not"];
const NUMERIC_UI_OPS: NumericComparisonOpUi[] = ["=", "!=", ">", ">=", "<", "<="];
const LIFECYCLE_RULE_TYPES: Exclude<LifecycleRuleTypeValue, "">[] = [
  "expiration",
  "delete_markers",
  "noncurrent_expiration",
  "abort_multipart",
  "transition",
  "noncurrent_transition",
];
const LIFECYCLE_RULE_TYPE_LABELS: Record<Exclude<LifecycleRuleTypeValue, "">, string> = {
  expiration: "Expiration (current versions)",
  delete_markers: "Expired object delete markers",
  noncurrent_expiration: "Expiration (noncurrent versions)",
  abort_multipart: "Abort incomplete multipart uploads",
  transition: "Transitions",
  noncurrent_transition: "Noncurrent transitions",
};

const asString = (value: unknown) => (typeof value === "string" ? value : "");

export const sanitizeFeatureDetailFilters = (value: unknown): FeatureDetailFilters => {
  if (!value || typeof value !== "object") return { ...defaultFeatureDetailFilters };
  const raw = value as Partial<FeatureDetailFilters>;
  const lifecycleRuleNameMode = LIFECYCLE_NAME_MODES.includes(raw.lifecycleRuleNameMode as LifecycleRuleNameMode)
    ? (raw.lifecycleRuleNameMode as LifecycleRuleNameMode)
    : defaultFeatureDetailFilters.lifecycleRuleNameMode;
  const lifecycleRuleTypeMode = PRESENCE_MODES.includes(raw.lifecycleRuleTypeMode as PresenceMode)
    ? (raw.lifecycleRuleTypeMode as PresenceMode)
    : defaultFeatureDetailFilters.lifecycleRuleTypeMode;
  const lifecycleRuleTypeValue = LIFECYCLE_RULE_TYPES.includes(raw.lifecycleRuleTypeValue as Exclude<LifecycleRuleTypeValue, "">)
    ? (raw.lifecycleRuleTypeValue as Exclude<LifecycleRuleTypeValue, "">)
    : defaultFeatureDetailFilters.lifecycleRuleTypeValue;
  const lifecycleExpirationDaysOp = NUMERIC_UI_OPS.includes(raw.lifecycleExpirationDaysOp as NumericComparisonOpUi)
    ? (raw.lifecycleExpirationDaysOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.lifecycleExpirationDaysOp;
  const lifecycleNoncurrentExpirationDaysOp = NUMERIC_UI_OPS.includes(
    raw.lifecycleNoncurrentExpirationDaysOp as NumericComparisonOpUi
  )
    ? (raw.lifecycleNoncurrentExpirationDaysOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.lifecycleNoncurrentExpirationDaysOp;
  const lifecycleTransitionDaysOp = NUMERIC_UI_OPS.includes(raw.lifecycleTransitionDaysOp as NumericComparisonOpUi)
    ? (raw.lifecycleTransitionDaysOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.lifecycleTransitionDaysOp;
  const lifecycleAbortDaysOp = NUMERIC_UI_OPS.includes(raw.lifecycleAbortDaysOp as NumericComparisonOpUi)
    ? (raw.lifecycleAbortDaysOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.lifecycleAbortDaysOp;
  const objectLockMode = raw.objectLockMode === "GOVERNANCE" || raw.objectLockMode === "COMPLIANCE" ? raw.objectLockMode : "";
  const objectLockRetentionOp = NUMERIC_UI_OPS.includes(raw.objectLockRetentionOp as NumericComparisonOpUi)
    ? (raw.objectLockRetentionOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.objectLockRetentionOp;
  const corsMethodMode = PRESENCE_MODES.includes(raw.corsMethodMode as PresenceMode)
    ? (raw.corsMethodMode as PresenceMode)
    : defaultFeatureDetailFilters.corsMethodMode;
  const corsOriginMode = PRESENCE_MODES.includes(raw.corsOriginMode as PresenceMode)
    ? (raw.corsOriginMode as PresenceMode)
    : defaultFeatureDetailFilters.corsOriginMode;
  const loggingEnabled = TRI_STATES.includes(raw.loggingEnabled as FeatureTriState)
    ? (raw.loggingEnabled as FeatureTriState)
    : defaultFeatureDetailFilters.loggingEnabled;
  const websiteIndexPresent = TRI_STATES.includes(raw.websiteIndexPresent as FeatureTriState)
    ? (raw.websiteIndexPresent as FeatureTriState)
    : defaultFeatureDetailFilters.websiteIndexPresent;
  const websiteRedirectHostPresent = TRI_STATES.includes(raw.websiteRedirectHostPresent as FeatureTriState)
    ? (raw.websiteRedirectHostPresent as FeatureTriState)
    : defaultFeatureDetailFilters.websiteRedirectHostPresent;
  const policyStatementOp = NUMERIC_UI_OPS.includes(raw.policyStatementOp as NumericComparisonOpUi)
    ? (raw.policyStatementOp as NumericComparisonOpUi)
    : defaultFeatureDetailFilters.policyStatementOp;
  const policyHasConditions = TRI_STATES.includes(raw.policyHasConditions as FeatureTriState)
    ? (raw.policyHasConditions as FeatureTriState)
    : defaultFeatureDetailFilters.policyHasConditions;

  const sanitizeTriState = (candidate: unknown): FeatureTriState =>
    TRI_STATES.includes(candidate as FeatureTriState) ? (candidate as FeatureTriState) : "any";

  return {
    lifecycleRuleNameMode,
    lifecycleRuleName: asString(raw.lifecycleRuleName),
    lifecycleRuleTypeMode,
    lifecycleRuleTypeValue,
    lifecycleExpirationDaysOp,
    lifecycleExpirationDays: asString(raw.lifecycleExpirationDays),
    lifecycleNoncurrentExpirationDaysOp,
    lifecycleNoncurrentExpirationDays: asString(raw.lifecycleNoncurrentExpirationDays),
    lifecycleTransitionDaysOp,
    lifecycleTransitionDays: asString(raw.lifecycleTransitionDays),
    lifecycleAbortDaysOp,
    lifecycleAbortDays: asString(raw.lifecycleAbortDays),
    objectLockMode,
    objectLockRetentionOp,
    objectLockRetentionDays: asString(raw.objectLockRetentionDays),
    bpaBlockPublicAcls: sanitizeTriState(raw.bpaBlockPublicAcls),
    bpaIgnorePublicAcls: sanitizeTriState(raw.bpaIgnorePublicAcls),
    bpaBlockPublicPolicy: sanitizeTriState(raw.bpaBlockPublicPolicy),
    bpaRestrictPublicBuckets: sanitizeTriState(raw.bpaRestrictPublicBuckets),
    corsMethodMode,
    corsMethodValue: asString(raw.corsMethodValue),
    corsOriginMode,
    corsOriginValue: asString(raw.corsOriginValue),
    loggingEnabled,
    loggingTargetBucket: asString(raw.loggingTargetBucket),
    websiteIndexPresent,
    websiteRedirectHostPresent,
    policyStatementOp,
    policyStatementCount: asString(raw.policyStatementCount),
    policyHasConditions,
  };
};

const pushTriStateRule = (
  rules: Array<Record<string, unknown>>,
  triState: FeatureTriState,
  feature: string,
  param: string
) => {
  if (triState === "any") return;
  rules.push({ feature, param, op: "eq", value: triState === "true" });
};

export const buildFeatureDetailRules = (filters: FeatureDetailFilters): Array<Record<string, unknown>> => {
  const rules: Array<Record<string, unknown>> = [];
  const lifecycleRuleName = filters.lifecycleRuleName.trim();
  if (filters.lifecycleRuleNameMode !== "any" && lifecycleRuleName) {
    const rule: Record<string, unknown> = {
      feature: "lifecycle_rules",
      param: "lifecycle_rule_id",
      op: "eq",
      value: lifecycleRuleName,
    };
    if (filters.lifecycleRuleNameMode === "has_not_named") {
      rule.quantifier = "none";
    }
    rules.push(rule);
  }

  if (filters.lifecycleRuleTypeMode !== "any" && filters.lifecycleRuleTypeValue) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_rule_type",
      op: filters.lifecycleRuleTypeMode === "has" ? "has" : "has_not",
      value: filters.lifecycleRuleTypeValue,
    });
  }

  const lifecycleExpirationDaysRaw = filters.lifecycleExpirationDays.trim();
  const lifecycleExpirationDays = Number(lifecycleExpirationDaysRaw);
  if (lifecycleExpirationDaysRaw && Number.isFinite(lifecycleExpirationDays)) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_expiration_days",
      op: NUMERIC_UI_TO_RULE_OP[filters.lifecycleExpirationDaysOp],
      value: lifecycleExpirationDays,
    });
  }

  const lifecycleNoncurrentExpirationDaysRaw = filters.lifecycleNoncurrentExpirationDays.trim();
  const lifecycleNoncurrentExpirationDays = Number(lifecycleNoncurrentExpirationDaysRaw);
  if (lifecycleNoncurrentExpirationDaysRaw && Number.isFinite(lifecycleNoncurrentExpirationDays)) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_noncurrent_expiration_days",
      op: NUMERIC_UI_TO_RULE_OP[filters.lifecycleNoncurrentExpirationDaysOp],
      value: lifecycleNoncurrentExpirationDays,
    });
  }

  const lifecycleTransitionDaysRaw = filters.lifecycleTransitionDays.trim();
  const lifecycleTransitionDays = Number(lifecycleTransitionDaysRaw);
  if (lifecycleTransitionDaysRaw && Number.isFinite(lifecycleTransitionDays)) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_transition_days",
      op: NUMERIC_UI_TO_RULE_OP[filters.lifecycleTransitionDaysOp],
      value: lifecycleTransitionDays,
    });
  }

  const lifecycleAbortDaysRaw = filters.lifecycleAbortDays.trim();
  const lifecycleAbortDays = Number(lifecycleAbortDaysRaw);
  if (lifecycleAbortDaysRaw && Number.isFinite(lifecycleAbortDays)) {
    rules.push({
      feature: "lifecycle_rules",
      param: "lifecycle_abort_multipart_days",
      op: NUMERIC_UI_TO_RULE_OP[filters.lifecycleAbortDaysOp],
      value: lifecycleAbortDays,
    });
  }

  if (filters.objectLockMode) {
    rules.push({
      feature: "object_lock",
      param: "object_lock_mode",
      op: "eq",
      value: filters.objectLockMode,
    });
  }
  const objectLockRetentionDaysRaw = filters.objectLockRetentionDays.trim();
  const objectLockRetentionDays = Number(objectLockRetentionDaysRaw);
  if (objectLockRetentionDaysRaw && Number.isFinite(objectLockRetentionDays)) {
    rules.push({
      feature: "object_lock",
      param: "object_lock_retention_days",
      op: NUMERIC_UI_TO_RULE_OP[filters.objectLockRetentionOp],
      value: objectLockRetentionDays,
    });
  }

  pushTriStateRule(rules, filters.bpaBlockPublicAcls, "block_public_access", "bpa_block_public_acls");
  pushTriStateRule(rules, filters.bpaIgnorePublicAcls, "block_public_access", "bpa_ignore_public_acls");
  pushTriStateRule(rules, filters.bpaBlockPublicPolicy, "block_public_access", "bpa_block_public_policy");
  pushTriStateRule(rules, filters.bpaRestrictPublicBuckets, "block_public_access", "bpa_restrict_public_buckets");

  const corsMethodValue = filters.corsMethodValue.trim();
  if (filters.corsMethodMode !== "any" && corsMethodValue) {
    rules.push({
      feature: "cors",
      param: "cors_allowed_method",
      op: filters.corsMethodMode === "has" ? "has" : "has_not",
      value: corsMethodValue,
    });
  }
  const corsOriginValue = filters.corsOriginValue.trim();
  if (filters.corsOriginMode !== "any" && corsOriginValue) {
    rules.push({
      feature: "cors",
      param: "cors_allowed_origin",
      op: filters.corsOriginMode === "has" ? "has" : "has_not",
      value: corsOriginValue,
    });
  }

  if (filters.loggingEnabled !== "any") {
    rules.push({
      feature: "access_logging",
      param: "logging_enabled",
      op: "eq",
      value: filters.loggingEnabled === "true",
    });
  }

  const loggingTargetBucket = filters.loggingTargetBucket.trim();
  if (loggingTargetBucket) {
    rules.push({
      feature: "access_logging",
      param: "logging_target_bucket",
      op: "eq",
      value: loggingTargetBucket,
    });
  }

  pushTriStateRule(rules, filters.websiteIndexPresent, "static_website", "website_index_present");
  pushTriStateRule(rules, filters.websiteRedirectHostPresent, "static_website", "website_redirect_host_present");

  const policyStatementCountRaw = filters.policyStatementCount.trim();
  const policyStatementCount = Number(policyStatementCountRaw);
  if (policyStatementCountRaw && Number.isFinite(policyStatementCount)) {
    rules.push({
      feature: "bucket_policy",
      param: "policy_statement_count",
      op: NUMERIC_UI_TO_RULE_OP[filters.policyStatementOp],
      value: policyStatementCount,
    });
  }

  if (filters.policyHasConditions !== "any") {
    rules.push({
      feature: "bucket_policy",
      param: "policy_has_conditions",
      op: "eq",
      value: filters.policyHasConditions === "true",
    });
  }

  return rules;
};

export const hasFeatureDetailFilters = (filters: FeatureDetailFilters): boolean => {
  if (buildFeatureDetailRules(filters).length > 0) return true;
  return false;
};

export const featureDetailSummaryItems = (
  filters: FeatureDetailFilters
): Array<{ field: FeatureDetailFilterKey; label: string }> => {
  const summary: Array<{ field: FeatureDetailFilterKey; label: string }> = [];
  const lifecycleRuleName = filters.lifecycleRuleName.trim();
  if (filters.lifecycleRuleNameMode === "has_named" && lifecycleRuleName) {
    summary.push({ field: "lifecycleRuleName", label: `Lifecycle rule name: ${lifecycleRuleName}` });
  }
  if (filters.lifecycleRuleNameMode === "has_not_named" && lifecycleRuleName) {
    summary.push({ field: "lifecycleRuleName", label: `Lifecycle rule name absent: ${lifecycleRuleName}` });
  }
  if (filters.lifecycleRuleTypeMode !== "any" && filters.lifecycleRuleTypeValue) {
    const typeLabel = LIFECYCLE_RULE_TYPE_LABELS[filters.lifecycleRuleTypeValue] ?? filters.lifecycleRuleTypeValue;
    summary.push({
      field: "lifecycleRuleTypeValue",
      label: `Lifecycle rule type ${filters.lifecycleRuleTypeMode}: ${typeLabel}`,
    });
  }
  if (filters.lifecycleAbortDays.trim()) {
    summary.push({
      field: "lifecycleAbortDays",
      label: `Lifecycle abort days ${filters.lifecycleAbortDaysOp} ${filters.lifecycleAbortDays.trim()}`,
    });
  }
  if (filters.lifecycleExpirationDays.trim()) {
    summary.push({
      field: "lifecycleExpirationDays",
      label: `Lifecycle expiration days ${filters.lifecycleExpirationDaysOp} ${filters.lifecycleExpirationDays.trim()}`,
    });
  }
  if (filters.lifecycleNoncurrentExpirationDays.trim()) {
    summary.push({
      field: "lifecycleNoncurrentExpirationDays",
      label: `Lifecycle noncurrent expiration days ${filters.lifecycleNoncurrentExpirationDaysOp} ${filters.lifecycleNoncurrentExpirationDays.trim()}`,
    });
  }
  if (filters.lifecycleTransitionDays.trim()) {
    summary.push({
      field: "lifecycleTransitionDays",
      label: `Lifecycle transition days ${filters.lifecycleTransitionDaysOp} ${filters.lifecycleTransitionDays.trim()}`,
    });
  }
  if (filters.objectLockMode) summary.push({ field: "objectLockMode", label: `Object Lock mode: ${filters.objectLockMode}` });
  if (filters.objectLockRetentionDays.trim()) {
    summary.push({
      field: "objectLockRetentionDays",
      label: `Object Lock retention days ${filters.objectLockRetentionOp} ${filters.objectLockRetentionDays.trim()}`,
    });
  }
  if (filters.bpaBlockPublicAcls !== "any") {
    summary.push({ field: "bpaBlockPublicAcls", label: `BPA block public ACLs: ${filters.bpaBlockPublicAcls}` });
  }
  if (filters.bpaIgnorePublicAcls !== "any") {
    summary.push({ field: "bpaIgnorePublicAcls", label: `BPA ignore public ACLs: ${filters.bpaIgnorePublicAcls}` });
  }
  if (filters.bpaBlockPublicPolicy !== "any") {
    summary.push({ field: "bpaBlockPublicPolicy", label: `BPA block public policy: ${filters.bpaBlockPublicPolicy}` });
  }
  if (filters.bpaRestrictPublicBuckets !== "any") {
    summary.push({ field: "bpaRestrictPublicBuckets", label: `BPA restrict public buckets: ${filters.bpaRestrictPublicBuckets}` });
  }
  if (filters.corsMethodMode !== "any" && filters.corsMethodValue.trim()) {
    summary.push({ field: "corsMethodValue", label: `CORS method ${filters.corsMethodMode}: ${filters.corsMethodValue.trim()}` });
  }
  if (filters.corsOriginMode !== "any" && filters.corsOriginValue.trim()) {
    summary.push({ field: "corsOriginValue", label: `CORS origin ${filters.corsOriginMode}: ${filters.corsOriginValue.trim()}` });
  }
  if (filters.loggingEnabled !== "any") summary.push({ field: "loggingEnabled", label: `Logging enabled: ${filters.loggingEnabled}` });
  if (filters.loggingTargetBucket.trim()) {
    summary.push({ field: "loggingTargetBucket", label: `Logging target bucket: ${filters.loggingTargetBucket.trim()}` });
  }
  if (filters.websiteIndexPresent !== "any") {
    summary.push({ field: "websiteIndexPresent", label: `Website index present: ${filters.websiteIndexPresent}` });
  }
  if (filters.websiteRedirectHostPresent !== "any") {
    summary.push({
      field: "websiteRedirectHostPresent",
      label: `Website redirect host present: ${filters.websiteRedirectHostPresent}`,
    });
  }
  if (filters.policyStatementCount.trim()) {
    summary.push({
      field: "policyStatementCount",
      label: `Policy statements ${filters.policyStatementOp} ${filters.policyStatementCount.trim()}`,
    });
  }
  if (filters.policyHasConditions !== "any") {
    summary.push({ field: "policyHasConditions", label: `Policy has conditions: ${filters.policyHasConditions}` });
  }
  return summary;
};

export const featureDetailSummary = (filters: FeatureDetailFilters): string[] => {
  return featureDetailSummaryItems(filters).map((item) => item.label);
};

export const clearFeatureDetailField = (filters: FeatureDetailFilters, key: FeatureDetailFilterKey): FeatureDetailFilters => ({
  ...filters,
  [key]: defaultFeatureDetailFilters[key],
});
