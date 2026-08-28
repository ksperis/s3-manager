/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it, vi } from "vitest";

import {
  prepareBucketOpsBulkInput,
  type BucketOpsBulkInput,
} from "./bucketOpsBulkInput";
import { previewBucketOpsBulkUpdate } from "./bucketOpsBulkPreview";

function createApi() {
  return {
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

function preview(
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
  const result = previewBucketOpsBulkUpdate({
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

describe("previewBucketOpsBulkUpdate", () => {
  it("previews quota changes and configured-quota preservation", async () => {
    const input = rawInput("set_quota", {
      quota: {
        applyObjects: true,
        applySize: true,
        objects: "50",
        sizeUnit: "GiB",
        sizeValue: "2",
      },
    });
    await expect(preview(input).result).resolves.toEqual([
      {
        bucket: "archive",
        changed: true,
        before: [
          { text: "Size: Not set", tone: "removed" },
          { text: "Objects: Not set", tone: "removed" },
        ],
        after: [
          { text: expect.stringContaining("2"), tone: "added" },
          { text: "Objects: 50", tone: "added" },
        ],
      },
    ]);

    const api = createApi();
    api.fetchBucketQuota.mockResolvedValue({
      maxSizeBytes: 1024 ** 3,
      maxObjects: 10,
    });
    const preserved = await preview(input, {
      api,
      quotaSkipConfigured: true,
    }).result;
    expect(preserved[0]).toMatchObject({ changed: false });
    expect(preserved[0].after).toContainEqual({
      text: "(existing quota preserved)",
    });
  });

  it("previews public-access and versioning changes with no-op detection", async () => {
    const publicAccess = await preview(
      rawInput("add_public_access_block", {
        publicAccessBlockTargets: { block_public_acls: true },
      }),
    ).result;
    expect(publicAccess[0]).toMatchObject({ changed: true });
    expect(publicAccess[0].after).toContainEqual({
      text: "BlockPublicAcls: Blocked",
      tone: "added",
    });

    const versioning = await preview(rawInput("enable_versioning")).result;
    expect(versioning[0]).toEqual({
      bucket: "archive",
      changed: true,
      before: [{ text: "Suspended", tone: "removed" }],
      after: [{ text: "Enabled", tone: "added" }],
    });

    const api = createApi();
    api.getBucketProperties.mockResolvedValue({
      lifecycle_rules: [],
      versioning_status: "Enabled",
    });
    const unchanged = await preview(rawInput("enable_versioning"), { api }).result;
    expect(unchanged[0]).toMatchObject({ changed: false });
  });

  it("previews lifecycle additions and deletions", async () => {
    const added = await preview(
      rawInput("add_lifecycle", {
        lifecycle: {
          deleteIds: "",
          deleteTypes: {},
          ruleText: '{"ID":"new-lifecycle","Status":"Enabled"}',
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(added[0]).toMatchObject({ changed: true });
    expect(added[0].after.at(-1)).toMatchObject({ tone: "added" });

    const deleted = await preview(
      rawInput("delete_lifecycle", {
        lifecycle: {
          deleteIds: "old-lifecycle",
          deleteTypes: {},
          ruleText: "",
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(deleted[0]).toMatchObject({ changed: true });
    expect(deleted[0].before[0]).toMatchObject({ tone: "removed" });
    expect(deleted[0].after).toEqual([{ text: "(no rules)" }]);
  });

  it("previews notification additions and deletions", async () => {
    const added = await preview(
      rawInput("add_notifications", {
        notifications: {
          configurationText:
            '{"TopicConfigurations":[{"Id":"created","TopicArn":"arn:topic"}]}',
          deleteIds: "",
          deleteTypes: {},
        },
      }),
    ).result;
    expect(added[0]).toMatchObject({ changed: true });
    expect(added[0].after[0]).toMatchObject({ tone: "added" });

    const api = createApi();
    api.getBucketNotifications.mockResolvedValue({
      configuration: { TopicConfigurations: [{ Id: "old-topic" }] },
    });
    const deleted = await preview(
      rawInput("delete_notifications", {
        notifications: {
          configurationText: "",
          deleteIds: "old-topic",
          deleteTypes: {},
        },
      }),
      { api },
    ).result;
    expect(deleted[0]).toMatchObject({ changed: true });
    expect(deleted[0].before[0]).toMatchObject({ tone: "removed" });
  });

  it("previews CORS additions and deletions", async () => {
    const added = await preview(
      rawInput("add_cors", {
        cors: {
          deleteIds: "",
          deleteTypes: {},
          ruleText:
            '{"ID":"new-cors","AllowedOrigins":["*"],"AllowedMethods":["GET"]}',
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(added[0]).toMatchObject({ changed: true });
    expect(added[0].after.at(-1)).toMatchObject({ tone: "added" });

    const deleted = await preview(
      rawInput("delete_cors", {
        cors: {
          deleteIds: "old-cors",
          deleteTypes: {},
          ruleText: "",
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(deleted[0].before[0]).toMatchObject({ tone: "removed" });
    expect(deleted[0].after).toEqual([{ text: "(no rules)" }]);
  });

  it("previews policy additions and deletions", async () => {
    const added = await preview(
      rawInput("add_policy", {
        policy: {
          deleteIds: "",
          deleteTypes: {},
          policyText:
            '{"Version":"2012-10-17","Statement":[{"Sid":"New","Effect":"Allow"}]}',
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(added[0]).toMatchObject({ changed: true });
    expect(added[0].after.at(-1)).toMatchObject({ tone: "added" });

    const deleted = await preview(
      rawInput("delete_policy", {
        policy: {
          deleteIds: "Old",
          deleteTypes: {},
          policyText: "",
          updateOnlyExisting: false,
        },
      }),
    ).result;
    expect(deleted[0].before[0]).toMatchObject({ tone: "removed" });
    expect(deleted[0].after).toEqual([{ text: "(no statements)" }]);
  });

  it("projects partial failures and aggregate progress", async () => {
    const api = createApi();
    api.getBucketProperties.mockImplementation(async (_endpointId, bucketName) => {
      if (bucketName === "failed") throw new Error("Unavailable");
      return { lifecycle_rules: [], versioning_status: "Suspended" };
    });
    const { onProgress, result } = preview(rawInput("enable_versioning"), {
      api,
      bucketNames: ["changed", "failed"],
    });

    await expect(result).resolves.toEqual([
      expect.objectContaining({ bucket: "changed", changed: true }),
      {
        bucket: "failed",
        before: [{ text: "Preview failed." }],
        after: [{ text: "Preview failed." }],
        changed: false,
        error: "Unavailable",
      },
    ]);
    expect(onProgress).toHaveBeenLastCalledWith({
      completed: 2,
      total: 2,
      failed: 1,
    });
  });
});
