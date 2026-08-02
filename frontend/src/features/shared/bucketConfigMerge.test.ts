import { describe, expect, it } from "vitest";
import {
  getCorsRuleKey,
  getCorsRuleTypes,
  getLifecycleRuleTypes,
  getPolicyStatementTypes,
  mergeCorsRules,
  mergeLifecycleRules,
  mergePolicyStatements,
} from "./bucketConfigMerge";

describe("bucketConfigMerge", () => {
  it("replaces lifecycle rules by identifier and adds distinct rules", () => {
    const existing = [
      { ID: "expire", Status: "Enabled", Expiration: { Days: 30 } },
      { ID: "keep", Status: "Enabled", Expiration: { Days: 365 } },
    ];
    const replacement = {
      ID: "expire",
      Status: "Enabled",
      Expiration: { Days: 60 },
    };
    const addition = {
      Status: "Enabled",
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 },
    };

    const result = mergeLifecycleRules(existing, [replacement, addition]);

    expect(result.nextRules).toEqual([replacement, existing[1], addition]);
    expect(result.changes.map(({ action, index }) => ({ action, index }))).toEqual([
      { action: "replace", index: 0 },
      { action: "add", index: 2 },
    ]);
  });

  it("limits lifecycle updates to matching identifiers when requested", () => {
    const existing = [{ ID: "known", Expiration: { Days: 30 } }];

    const result = mergeLifecycleRules(
      existing,
      [
        { ID: "unknown", Expiration: { Days: 60 } },
        { Expiration: { Days: 90 } },
      ],
      { onlyUpdateExisting: true },
    );

    expect(result).toEqual({ nextRules: existing, changes: [] });
  });

  it("uses a normalized origin and method identity for CORS rules", () => {
    const original = {
      AllowedOrigins: ["https://b.example", "https://a.example"],
      AllowedMethods: ["put", "GET"],
      MaxAgeSeconds: 60,
    };
    const replacement = {
      AllowedOrigins: ["https://a.example", "https://b.example"],
      AllowedMethods: ["GET", "PUT"],
      MaxAgeSeconds: 120,
    };

    expect(getCorsRuleKey(original)).toBe(getCorsRuleKey(replacement));
    expect(mergeCorsRules([original], [replacement])).toMatchObject({
      nextRules: [replacement],
      changes: [{ action: "replace", index: 0 }],
    });
  });

  it("replaces policy statements by Sid and does not duplicate equal statements", () => {
    const original = {
      Sid: "read",
      Effect: "Allow",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::bucket/*",
    };
    const replacement = { ...original, Action: ["s3:GetObject", "s3:ListBucket"] };
    const unchanged = {
      Effect: "Deny",
      Action: "s3:DeleteObject",
      Resource: "arn:aws:s3:::bucket/*",
    };

    const result = mergePolicyStatements(
      [original, unchanged],
      [replacement, { ...unchanged }],
    );

    expect(result.nextStatements).toEqual([replacement, unchanged]);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ action: "replace", index: 0 });
  });

  it("classifies lifecycle, CORS and policy capabilities", () => {
    expect(
      getLifecycleRuleTypes({
        Expiration: { Days: 30, ExpiredObjectDeleteMarker: true },
        Transitions: [{ Days: 7, StorageClass: "GLACIER" }],
      }),
    ).toEqual(["expiration", "delete_markers", "transition"]);
    expect(
      getCorsRuleTypes({
        AllowedOrigins: ["*"],
        AllowedMethods: ["GET", "PUT"],
        AllowCredentials: true,
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 60,
      }),
    ).toEqual([
      "wildcard_origins",
      "read_methods",
      "write_methods",
      "allow_credentials",
      "expose_headers",
      "max_age",
    ]);
    expect(
      getPolicyStatementTypes({
        Effect: "Allow",
        Principal: "*",
        Action: ["s3:GetObject", "s3:PutObject"],
        Condition: { Bool: { "aws:SecureTransport": "true" } },
      }),
    ).toEqual([
      "allow",
      "condition",
      "public_principal",
      "read_actions",
      "write_actions",
    ]);
  });
});
