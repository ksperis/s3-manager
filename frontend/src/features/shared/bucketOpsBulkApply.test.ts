/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";

import { applyBucketOpsBulkUpdate } from "./bucketOpsBulkApply";
import {
  prepareBucketOpsBulkInput,
  type BucketOpsBulkInput,
} from "./bucketOpsBulkInput";

function createApi() {
  return {
    deleteBucketCors: vi.fn(async () => undefined),
    deleteBucketLifecycle: vi.fn(async () => undefined),
    deleteBucketNotifications: vi.fn(async () => undefined),
    deleteBucketPolicy: vi.fn(async () => undefined),
    fetchBucketQuota: vi.fn(async () => ({ maxSizeBytes: null, maxObjects: null })),
    getBucketCors: vi.fn(async () => ({ rules: [{ ID: "old-cors" }] })),
    getBucketLifecycle: vi.fn(async () => ({ rules: [{ ID: "old-lifecycle" }] })),
    getBucketNotifications: vi.fn(async () => ({ configuration: {} })),
    getBucketPolicy: vi.fn(async () => ({
      policy: { Version: "2012-10-17", Statement: [{ Sid: "Old" }] },
    })),
    getBucketProperties: vi.fn(async () => ({
      lifecycle_rules: [],
      versioning_status: "Suspended",
    })),
    getBucketPublicAccessBlock: vi.fn(async () => ({
      block_public_acls: false,
      ignore_public_acls: false,
      block_public_policy: false,
      restrict_public_buckets: false,
    })),
    putBucketCors: vi.fn(async () => undefined),
    putBucketLifecycle: vi.fn(async () => undefined),
    putBucketNotifications: vi.fn(async () => undefined),
    putBucketPolicy: vi.fn(async () => undefined),
    setBucketVersioning: vi.fn(async () => undefined),
    updateBucketPublicAccessBlock: vi.fn(async () => undefined),
    updateBucketQuota: vi.fn(async () => undefined),
  };
}

function rawInput(
  operation: BucketOpsBulkInput["operation"],
  overrides: Partial<BucketOpsBulkInput> = {},
): BucketOpsBulkInput {
  return {
    operation,
    quota: {
      applyObjects: false,
      applySize: false,
      objects: "",
      sizeUnit: "GiB",
      sizeValue: "",
    },
    lifecycle: {
      deleteIds: "",
      deleteTypes: {},
      ruleText: "",
      updateOnlyExisting: false,
    },
    notifications: {
      configurationText: "",
      deleteIds: "",
      deleteTypes: {},
    },
    cors: {
      deleteIds: "",
      deleteTypes: {},
      ruleText: "",
      updateOnlyExisting: false,
    },
    policy: {
      deleteIds: "",
      deleteTypes: {},
      policyText: "",
      updateOnlyExisting: false,
    },
    publicAccessBlockTargets: {},
    ...overrides,
  };
}

function prepare(input: BucketOpsBulkInput) {
  const result = prepareBucketOpsBulkInput(input);
  if (result.kind === "error") throw new Error(result.error);
  return result.value;
}

function apply(
  input: BucketOpsBulkInput,
  options: {
    api?: ReturnType<typeof createApi>;
    bucketNames?: string[];
    corsUpdateOnlyExisting?: boolean;
    lifecycleUpdateOnlyExisting?: boolean;
    policyUpdateOnlyExisting?: boolean;
    quotaSkipConfigured?: boolean;
  } = {},
) {
  const api = options.api ?? createApi();
  const onProgress = vi.fn();
  const result = applyBucketOpsBulkUpdate({
    ...api,
    bucketNames: options.bucketNames ?? ["archive"],
    corsUpdateOnlyExisting: options.corsUpdateOnlyExisting ?? false,
    endpointId: 7,
    lifecycleUpdateOnlyExisting: options.lifecycleUpdateOnlyExisting ?? false,
    onProgress,
    operation: input.operation,
    policyUpdateOnlyExisting: options.policyUpdateOnlyExisting ?? false,
    prepared: prepare(input),
    quotaSkipConfigured: options.quotaSkipConfigured ?? false,
  });
  return { api, onProgress, result };
}

describe("applyBucketOpsBulkUpdate", () => {
  it("updates quota and preserves configured buckets when requested", async () => {
    const input = rawInput("set_quota", {
      quota: {
        applyObjects: true,
        applySize: true,
        objects: "50",
        sizeUnit: "GiB",
        sizeValue: "2",
      },
    });
    const { api, result } = apply(input);

    await expect(result).resolves.toMatchObject({
      changedCount: 1,
      failedCount: 0,
      summary: "Updated 1 bucket.",
    });
    expect(api.updateBucketQuota).toHaveBeenCalledWith(7, "archive", {
      max_size_gb: 2,
      max_size_unit: "GiB",
      max_objects: 50,
    });

    const configuredApi = createApi();
    configuredApi.fetchBucketQuota.mockResolvedValue({
      maxSizeBytes: 1024 ** 3,
      maxObjects: 10,
    });
    const skipped = apply(input, {
      api: configuredApi,
      quotaSkipConfigured: true,
    });
    await expect(skipped.result).resolves.toMatchObject({
      changedCount: 0,
      unchangedCount: 1,
    });
    expect(configuredApi.updateBucketQuota).not.toHaveBeenCalled();
  });

  it("updates public-access flags and versioning only when needed", async () => {
    const publicAccess = apply(
      rawInput("add_public_access_block", {
        publicAccessBlockTargets: {
          block_public_acls: true,
          restrict_public_buckets: true,
        },
      }),
    );
    await expect(publicAccess.result).resolves.toMatchObject({ changedCount: 1 });
    expect(publicAccess.api.updateBucketPublicAccessBlock).toHaveBeenCalledWith(
      7,
      "archive",
      {
        block_public_acls: true,
        ignore_public_acls: false,
        block_public_policy: false,
        restrict_public_buckets: true,
      },
    );

    const versioning = apply(rawInput("enable_versioning"));
    await expect(versioning.result).resolves.toMatchObject({ changedCount: 1 });
    expect(versioning.api.setBucketVersioning).toHaveBeenCalledWith(
      7,
      "archive",
      true,
    );

    const unchangedApi = createApi();
    unchangedApi.getBucketProperties.mockResolvedValue({
      lifecycle_rules: [],
      versioning_status: "Enabled",
    });
    const unchanged = apply(rawInput("enable_versioning"), { api: unchangedApi });
    await expect(unchanged.result).resolves.toMatchObject({
      changedCount: 0,
      unchangedCount: 1,
    });
    expect(unchangedApi.setBucketVersioning).not.toHaveBeenCalled();
  });

  it("merges and deletes lifecycle rules", async () => {
    const add = apply(
      rawInput("add_lifecycle", {
        lifecycle: {
          deleteIds: "",
          deleteTypes: {},
          ruleText: '{"ID":"new-lifecycle","Status":"Enabled"}',
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(add.result).resolves.toMatchObject({ changedCount: 1 });
    expect(add.api.putBucketLifecycle).toHaveBeenCalledWith(7, "archive", [
      { ID: "old-lifecycle" },
      { ID: "new-lifecycle", Status: "Enabled" },
    ]);

    const remove = apply(
      rawInput("delete_lifecycle", {
        lifecycle: {
          deleteIds: "old-lifecycle",
          deleteTypes: {},
          ruleText: "",
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(remove.result).resolves.toMatchObject({ changedCount: 1 });
    expect(remove.api.deleteBucketLifecycle).toHaveBeenCalledWith(7, "archive");
  });

  it("merges and deletes notification configurations", async () => {
    const add = apply(
      rawInput("add_notifications", {
        notifications: {
          configurationText:
            '{"TopicConfigurations":[{"Id":"created","TopicArn":"arn:topic"}]}',
          deleteIds: "",
          deleteTypes: {},
        },
      }),
    );
    await expect(add.result).resolves.toMatchObject({ changedCount: 1 });
    expect(add.api.putBucketNotifications).toHaveBeenCalledWith(7, "archive", {
      TopicConfigurations: [{ Id: "created", TopicArn: "arn:topic" }],
    });

    const removeApi = createApi();
    removeApi.getBucketNotifications.mockResolvedValue({
      configuration: { TopicConfigurations: [{ Id: "old-topic" }] },
    });
    const remove = apply(
      rawInput("delete_notifications", {
        notifications: {
          configurationText: "",
          deleteIds: "old-topic",
          deleteTypes: {},
        },
      }),
      { api: removeApi },
    );
    await expect(remove.result).resolves.toMatchObject({ changedCount: 1 });
    expect(removeApi.deleteBucketNotifications).toHaveBeenCalledWith(7, "archive");
  });

  it("merges and deletes CORS rules", async () => {
    const add = apply(
      rawInput("add_cors", {
        cors: {
          deleteIds: "",
          deleteTypes: {},
          ruleText:
            '{"ID":"new-cors","AllowedOrigins":["*"],"AllowedMethods":["GET"]}',
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(add.result).resolves.toMatchObject({ changedCount: 1 });
    expect(add.api.putBucketCors).toHaveBeenCalledWith(7, "archive", [
      { ID: "old-cors" },
      {
        ID: "new-cors",
        AllowedOrigins: ["*"],
        AllowedMethods: ["GET"],
      },
    ]);

    const remove = apply(
      rawInput("delete_cors", {
        cors: {
          deleteIds: "old-cors",
          deleteTypes: {},
          ruleText: "",
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(remove.result).resolves.toMatchObject({ changedCount: 1 });
    expect(remove.api.deleteBucketCors).toHaveBeenCalledWith(7, "archive");
  });

  it("merges and deletes policy statements", async () => {
    const add = apply(
      rawInput("add_policy", {
        policy: {
          deleteIds: "",
          deleteTypes: {},
          policyText:
            '{"Version":"2012-10-17","Statement":[{"Sid":"New","Effect":"Allow"}]}',
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(add.result).resolves.toMatchObject({ changedCount: 1 });
    expect(add.api.putBucketPolicy).toHaveBeenCalledWith(7, "archive", {
      Version: "2012-10-17",
      Statement: [{ Sid: "Old" }, { Sid: "New", Effect: "Allow" }],
    });

    const remove = apply(
      rawInput("delete_policy", {
        policy: {
          deleteIds: "Old",
          deleteTypes: {},
          policyText: "",
          updateOnlyExisting: false,
        },
      }),
    );
    await expect(remove.result).resolves.toMatchObject({ changedCount: 1 });
    expect(remove.api.deleteBucketPolicy).toHaveBeenCalledWith(7, "archive");
  });

  it("aggregates partial failures and progress", async () => {
    const api = createApi();
    api.getBucketProperties.mockImplementation(async (_endpointId, bucketName) => {
      if (bucketName === "failed") throw new Error("Unavailable");
      return { lifecycle_rules: [], versioning_status: "Suspended" };
    });
    const { onProgress, result } = apply(rawInput("enable_versioning"), {
      api,
      bucketNames: ["updated", "failed"],
    });

    await expect(result).resolves.toEqual({
      changedCount: 1,
      unchangedCount: 0,
      failedCount: 1,
      error: "1 bucket(s) failed to update.",
      summary: "Updated 1 bucket.",
    });
    expect(api.setBucketVersioning).toHaveBeenCalledWith(7, "updated", true);
    expect(onProgress).toHaveBeenLastCalledWith({
      completed: 2,
      total: 2,
      failed: 1,
    });
  });
});
