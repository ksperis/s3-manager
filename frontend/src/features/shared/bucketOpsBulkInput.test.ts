/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { describe, expect, it } from "vitest";

import {
  prepareBucketOpsBulkInput,
  type BucketOpsBulkInput,
} from "./bucketOpsBulkInput";

function input(
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

describe("prepareBucketOpsBulkInput", () => {
  it("parses quota values once for preview and apply", () => {
    expect(prepareBucketOpsBulkInput(input("set_quota"))).toEqual({
      kind: "error",
      error: "Select at least one quota target (storage or objects).",
    });

    const result = prepareBucketOpsBulkInput(
      input("set_quota", {
        quota: {
          applyObjects: true,
          applySize: true,
          objects: "25",
          sizeUnit: "GiB",
          sizeValue: "2",
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "success",
      value: {
        parsedQuota: {
          applyObjects: true,
          applySize: true,
          maxObjects: 25,
          maxSizeBytes: 2 * 1024 ** 3,
        },
      },
    });
  });

  it("enforces stable lifecycle identifiers for update-only mode", () => {
    expect(
      prepareBucketOpsBulkInput(
        input("add_lifecycle", {
          lifecycle: {
            deleteIds: "",
            deleteTypes: {},
            ruleText: '{"Status":"Enabled"}',
            updateOnlyExisting: true,
          },
        }),
      ),
    ).toEqual({
      kind: "error",
      error: "Provide rule IDs when 'only update existing' is enabled.",
    });

    const result = prepareBucketOpsBulkInput(
      input("add_lifecycle", {
        lifecycle: {
          deleteIds: "",
          deleteTypes: {},
          ruleText: '{"ID":"expire-old","Status":"Enabled"}',
          updateOnlyExisting: true,
        },
      }),
    );
    expect(result).toMatchObject({
      kind: "success",
      value: { parsedRules: [{ ID: "expire-old", Status: "Enabled" }] },
    });
  });

  it("enforces stable CORS matching keys for update-only mode", () => {
    expect(
      prepareBucketOpsBulkInput(
        input("add_cors", {
          cors: {
            deleteIds: "",
            deleteTypes: {},
            ruleText: '{"ExposeHeaders":["ETag"]}',
            updateOnlyExisting: true,
          },
        }),
      ),
    ).toEqual({
      kind: "error",
      error:
        "Provide rule IDs or matching origins/methods when 'only update existing' is enabled.",
    });

    const result = prepareBucketOpsBulkInput(
      input("add_cors", {
        cors: {
          deleteIds: "",
          deleteTypes: {},
          ruleText: '{"AllowedOrigins":["*"],"AllowedMethods":["GET"]}',
          updateOnlyExisting: true,
        },
      }),
    );
    expect(result).toMatchObject({ kind: "success" });
  });

  it("keeps both the policy envelope and parsed statements", () => {
    const result = prepareBucketOpsBulkInput(
      input("add_policy", {
        policy: {
          deleteIds: "",
          deleteTypes: {},
          policyText:
            '{"Version":"2012-10-17","Statement":[{"Sid":"AllowRead","Effect":"Allow"}]}',
          updateOnlyExisting: false,
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "success",
      value: {
        parsedPolicy: { Version: "2012-10-17" },
        parsedPolicyStatements: [{ Sid: "AllowRead", Effect: "Allow" }],
      },
    });
  });

  it("parses notification configuration objects", () => {
    const result = prepareBucketOpsBulkInput(
      input("add_notifications", {
        notifications: {
          configurationText:
            '{"TopicConfigurations":[{"Id":"created","TopicArn":"arn:topic"}]}',
          deleteIds: "",
          deleteTypes: {},
        },
      }),
    );

    expect(result).toMatchObject({
      kind: "success",
      value: {
        parsedNotificationConfiguration: {
          TopicConfigurations: [{ Id: "created", TopicArn: "arn:topic" }],
        },
      },
    });
  });

  it.each([
    ["delete_lifecycle", "Provide at least one rule ID or rule type."],
    [
      "delete_notifications",
      "Provide at least one notification ID or notification type.",
    ],
    ["delete_cors", "Provide at least one rule ID or rule type."],
    ["delete_policy", "Provide at least one statement ID or statement type."],
  ] as const)("rejects empty %s criteria", (operation, error) => {
    expect(prepareBucketOpsBulkInput(input(operation))).toEqual({
      kind: "error",
      error,
    });
  });

  it("normalizes deletion IDs and selected types", () => {
    const lifecycle = prepareBucketOpsBulkInput(
      input("delete_lifecycle", {
        lifecycle: {
          deleteIds: "expire-old, transition-old",
          deleteTypes: { expiration: true },
          ruleText: "",
          updateOnlyExisting: false,
        },
      }),
    );
    expect(lifecycle).toMatchObject({ kind: "success" });
    if (lifecycle.kind === "error") throw new Error(lifecycle.error);
    expect(lifecycle.value.deleteIds).toEqual(
      new Set(["expire-old", "transition-old"]),
    );
    expect(lifecycle.value.deleteTypes).toEqual(new Set(["expiration"]));

    const notifications = prepareBucketOpsBulkInput(
      input("delete_notifications", {
        notifications: {
          configurationText: "",
          deleteIds: "topic-old",
          deleteTypes: { eventbridge: true },
        },
      }),
    );
    expect(notifications).toMatchObject({ kind: "success" });
    if (notifications.kind === "error") throw new Error(notifications.error);
    expect(notifications.value.deleteNotificationIds).toEqual(
      new Set(["topic-old"]),
    );
    expect(notifications.value.deleteNotificationTypes).toEqual(
      new Set(["eventbridge"]),
    );
  });

  it("requires and returns explicit public-access targets", () => {
    expect(
      prepareBucketOpsBulkInput(input("add_public_access_block")),
    ).toEqual({
      kind: "error",
      error: "Select at least one block public access option.",
    });

    const result = prepareBucketOpsBulkInput(
      input("remove_public_access_block", {
        publicAccessBlockTargets: {
          block_public_acls: true,
          restrict_public_buckets: true,
        },
      }),
    );
    expect(result).toMatchObject({
      kind: "success",
      value: {
        publicAccessBlockTargets: [
          "block_public_acls",
          "restrict_public_buckets",
        ],
      },
    });
  });
});
