/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  createBucketOpsBulkFormState,
  type BucketOpsBulkFormState,
} from "./bucketOpsBulkInput";

type BulkFormSetters = {
  [Key in keyof BucketOpsBulkFormState as `set${Capitalize<Key>}`]: Dispatch<
    SetStateAction<BucketOpsBulkFormState[Key]>
  >;
};

export function useBucketOpsBulkForm(): BucketOpsBulkFormState &
  BulkFormSetters & {
    formState: BucketOpsBulkFormState;
    resetBulkForm: () => void;
  } {
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

  return { ...state, ...setters, formState: state, resetBulkForm };
}
