/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createBucketOpsBulkFormState } from "./bucketOpsBulkInput";
import { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";

describe("useBucketOpsBulkForm", () => {
  it("creates isolated canonical defaults for every bulk configuration family", () => {
    const first = createBucketOpsBulkFormState();
    const second = createBucketOpsBulkFormState();

    expect(first).toMatchObject({
      bulkOperation: "",
      bulkQuotaSizeUnit: "GiB",
      bulkQuotaApplySize: true,
      bulkQuotaApplyObjects: true,
      bulkQuotaSkipConfigured: false,
      bulkLifecycleDeleteTypes: {
        expiration: false,
        delete_markers: false,
        noncurrent_expiration: false,
        abort_multipart: false,
        transition: false,
        noncurrent_transition: false,
      },
      bulkNotificationDeleteTypes: {
        topic: false,
        queue: false,
        lambda: false,
        eventbridge: false,
      },
      bulkCorsDeleteTypes: {
        wildcard_origins: false,
        read_methods: false,
        write_methods: false,
        allow_credentials: false,
        expose_headers: false,
        max_age: false,
      },
      bulkPolicyDeleteTypes: {
        allow: false,
        deny: false,
        read_actions: false,
        write_actions: false,
        condition: false,
        public_principal: false,
      },
    });
    expect(first.bulkCopyFeatures).not.toBe(second.bulkCopyFeatures);
    expect(first.bulkPasteMapping).not.toBe(second.bulkPasteMapping);
    expect(first.bulkLifecycleDeleteTypes).not.toBe(
      second.bulkLifecycleDeleteTypes,
    );
  });

  it("supports direct and functional field updates", () => {
    const { result } = renderHook(() => useBucketOpsBulkForm());

    act(() => {
      result.current.setBulkOperation("set_quota");
      result.current.setBulkQuotaSizeValue("25");
      result.current.setBulkPasteMapping({ source: "destination" });
      result.current.setBulkPublicAccessBlockTargets((current) => ({
        ...current,
        block_public_policy: false,
      }));
    });

    expect(result.current.bulkOperation).toBe("set_quota");
    expect(result.current.formState.bulkOperation).toBe("set_quota");
    expect(result.current.bulkQuotaSizeValue).toBe("25");
    expect(result.current.bulkPasteMapping).toEqual({ source: "destination" });
    expect(result.current.bulkPublicAccessBlockTargets.block_public_policy).toBe(
      false,
    );
  });

  it("restores fresh defaults with one reset", () => {
    const { result } = renderHook(() => useBucketOpsBulkForm());

    act(() => {
      result.current.setBulkOperation("add_policy");
      result.current.setBulkPolicyText('{"Statement":[]}');
      result.current.setBulkNotificationDeleteTypes((current) => ({
        ...current,
        topic: true,
      }));
    });
    const mutatedNotificationTypes = result.current.bulkNotificationDeleteTypes;

    act(() => result.current.resetBulkForm());

    expect(result.current.bulkOperation).toBe("");
    expect(result.current.bulkPolicyText).toBe("");
    expect(result.current.bulkNotificationDeleteTypes.topic).toBe(false);
    expect(result.current.bulkNotificationDeleteTypes).not.toBe(
      mutatedNotificationTypes,
    );
  });
});
