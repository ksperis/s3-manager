/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { NotificationConfigurationTypeKey } from "../cephAdmin/bucketJsonParsers";
import {
  CORS_TYPE_OPTIONS,
  LIFECYCLE_TYPE_OPTIONS,
  NOTIFICATION_TYPE_OPTIONS,
  POLICY_TYPE_OPTIONS,
  type CorsRuleTypeKey,
  type LifecycleRuleTypeKey,
  type PolicyRuleTypeKey,
} from "./bucketConfigMerge";
import {
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  type BulkCopyFeatureSelection,
  type BulkOperation,
  type PublicAccessBlockOptionKey,
  type QuotaSizeUnit,
} from "./bucketBulkOperationsModel";

type BucketOpsBulkFormState = {
  bulkOperation: BulkOperation;
  bulkCopyFeatures: BulkCopyFeatureSelection;
  bulkPasteMapping: Record<string, string>;
  bulkQuotaSizeValue: string;
  bulkQuotaSizeUnit: QuotaSizeUnit;
  bulkQuotaObjects: string;
  bulkQuotaApplySize: boolean;
  bulkQuotaApplyObjects: boolean;
  bulkQuotaSkipConfigured: boolean;
  bulkPublicAccessBlockTargets: Record<PublicAccessBlockOptionKey, boolean>;
  bulkLifecycleRuleText: string;
  bulkLifecycleUpdateOnlyExisting: boolean;
  bulkLifecycleDeleteIds: string;
  bulkLifecycleDeleteTypes: Record<LifecycleRuleTypeKey, boolean>;
  bulkNotificationText: string;
  bulkNotificationDeleteIds: string;
  bulkNotificationDeleteTypes: Record<
    NotificationConfigurationTypeKey,
    boolean
  >;
  bulkCorsRuleText: string;
  bulkCorsUpdateOnlyExisting: boolean;
  bulkCorsDeleteIds: string;
  bulkCorsDeleteTypes: Record<CorsRuleTypeKey, boolean>;
  bulkPolicyText: string;
  bulkPolicyUpdateOnlyExisting: boolean;
  bulkPolicyDeleteIds: string;
  bulkPolicyDeleteTypes: Record<PolicyRuleTypeKey, boolean>;
};

const createBooleanSelection = <Key extends string>(
  options: readonly { key: Key }[],
): Record<Key, boolean> =>
  Object.fromEntries(options.map((option) => [option.key, false])) as Record<
    Key,
    boolean
  >;

export function createBucketOpsBulkFormState(): BucketOpsBulkFormState {
  return {
    bulkOperation: "",
    bulkCopyFeatures: { ...DEFAULT_BULK_COPY_FEATURE_SELECTION },
    bulkPasteMapping: {},
    bulkQuotaSizeValue: "",
    bulkQuotaSizeUnit: "GiB",
    bulkQuotaObjects: "",
    bulkQuotaApplySize: true,
    bulkQuotaApplyObjects: true,
    bulkQuotaSkipConfigured: false,
    bulkPublicAccessBlockTargets: {
      block_public_acls: true,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    },
    bulkLifecycleRuleText: "",
    bulkLifecycleUpdateOnlyExisting: false,
    bulkLifecycleDeleteIds: "",
    bulkLifecycleDeleteTypes: createBooleanSelection(LIFECYCLE_TYPE_OPTIONS),
    bulkNotificationText: "",
    bulkNotificationDeleteIds: "",
    bulkNotificationDeleteTypes: createBooleanSelection(
      NOTIFICATION_TYPE_OPTIONS,
    ),
    bulkCorsRuleText: "",
    bulkCorsUpdateOnlyExisting: false,
    bulkCorsDeleteIds: "",
    bulkCorsDeleteTypes: createBooleanSelection(CORS_TYPE_OPTIONS),
    bulkPolicyText: "",
    bulkPolicyUpdateOnlyExisting: false,
    bulkPolicyDeleteIds: "",
    bulkPolicyDeleteTypes: createBooleanSelection(POLICY_TYPE_OPTIONS),
  };
}

type BulkFormSetters = {
  [Key in keyof BucketOpsBulkFormState as `set${Capitalize<Key>}`]: Dispatch<
    SetStateAction<BucketOpsBulkFormState[Key]>
  >;
};

export function useBucketOpsBulkForm(): BucketOpsBulkFormState &
  BulkFormSetters & { resetBulkForm: () => void } {
  const [state, setState] = useState(createBucketOpsBulkFormState);

  const setField = useCallback(
    <Key extends keyof BucketOpsBulkFormState>(
      key: Key,
      value: SetStateAction<BucketOpsBulkFormState[Key]>,
    ) => {
      setState((current) => {
        const nextValue =
          typeof value === "function"
            ? (
                value as (
                  previous: BucketOpsBulkFormState[Key],
                ) => BucketOpsBulkFormState[Key]
              )(current[key])
            : value;
        return Object.is(nextValue, current[key])
          ? current
          : { ...current, [key]: nextValue };
      });
    },
    [],
  );

  const setters = useMemo(
    () =>
      ({
        setBulkOperation: (value) => setField("bulkOperation", value),
        setBulkCopyFeatures: (value) => setField("bulkCopyFeatures", value),
        setBulkPasteMapping: (value) => setField("bulkPasteMapping", value),
        setBulkQuotaSizeValue: (value) => setField("bulkQuotaSizeValue", value),
        setBulkQuotaSizeUnit: (value) => setField("bulkQuotaSizeUnit", value),
        setBulkQuotaObjects: (value) => setField("bulkQuotaObjects", value),
        setBulkQuotaApplySize: (value) => setField("bulkQuotaApplySize", value),
        setBulkQuotaApplyObjects: (value) =>
          setField("bulkQuotaApplyObjects", value),
        setBulkQuotaSkipConfigured: (value) =>
          setField("bulkQuotaSkipConfigured", value),
        setBulkPublicAccessBlockTargets: (value) =>
          setField("bulkPublicAccessBlockTargets", value),
        setBulkLifecycleRuleText: (value) =>
          setField("bulkLifecycleRuleText", value),
        setBulkLifecycleUpdateOnlyExisting: (value) =>
          setField("bulkLifecycleUpdateOnlyExisting", value),
        setBulkLifecycleDeleteIds: (value) =>
          setField("bulkLifecycleDeleteIds", value),
        setBulkLifecycleDeleteTypes: (value) =>
          setField("bulkLifecycleDeleteTypes", value),
        setBulkNotificationText: (value) =>
          setField("bulkNotificationText", value),
        setBulkNotificationDeleteIds: (value) =>
          setField("bulkNotificationDeleteIds", value),
        setBulkNotificationDeleteTypes: (value) =>
          setField("bulkNotificationDeleteTypes", value),
        setBulkCorsRuleText: (value) => setField("bulkCorsRuleText", value),
        setBulkCorsUpdateOnlyExisting: (value) =>
          setField("bulkCorsUpdateOnlyExisting", value),
        setBulkCorsDeleteIds: (value) => setField("bulkCorsDeleteIds", value),
        setBulkCorsDeleteTypes: (value) =>
          setField("bulkCorsDeleteTypes", value),
        setBulkPolicyText: (value) => setField("bulkPolicyText", value),
        setBulkPolicyUpdateOnlyExisting: (value) =>
          setField("bulkPolicyUpdateOnlyExisting", value),
        setBulkPolicyDeleteIds: (value) =>
          setField("bulkPolicyDeleteIds", value),
        setBulkPolicyDeleteTypes: (value) =>
          setField("bulkPolicyDeleteTypes", value),
      }) satisfies BulkFormSetters,
    [setField],
  );

  const resetBulkForm = useCallback(() => {
    setState(createBucketOpsBulkFormState());
  }, []);

  return { ...state, ...setters, resetBulkForm };
}
