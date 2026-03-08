import { describe, expect, it } from "vitest";

import {
  buildReplicationConfigurationFromGraphical,
  containsUnsupportedReplicationZone,
  createEmptyGraphicalReplicationRule,
  isReplicationConfigurationConfigured,
  normalizeReplicationConfiguration,
  parseReplicationConfigurationForGraphical,
  validateGraphicalReplication,
  validateJsonReplicationConfiguration,
} from "../bucketReplication";

describe("bucketReplication helpers", () => {
  it("parses basic replication configuration for graphical mode", () => {
    const parsed = parseReplicationConfigurationForGraphical({
      Role: "arn:aws:iam::123456789012:role/replication",
      Rules: [
        {
          ID: "rule-1",
          Status: "Enabled",
          Priority: 5,
          Filter: { Prefix: "logs/" },
          Destination: { Bucket: "arn:aws:s3:::target-bucket" },
          DeleteMarkerReplication: { Status: "Disabled" },
        },
      ],
    });

    expect(parsed.role).toBe("arn:aws:iam::123456789012:role/replication");
    expect(parsed.hasAdvancedFields).toBe(false);
    expect(parsed.rules).toEqual([
      {
        id: "rule-1",
        status: "Enabled",
        priority: "5",
        prefix: "logs/",
        destinationBucket: "arn:aws:s3:::target-bucket",
        deleteMarkerStatus: "Disabled",
      },
    ]);
  });

  it("flags advanced fields not covered by graphical editor", () => {
    const parsed = parseReplicationConfigurationForGraphical({
      Role: "arn:aws:iam::123456789012:role/replication",
      Rules: [
        {
          Status: "Enabled",
          Destination: {
            Bucket: "arn:aws:s3:::target-bucket",
            StorageClass: "STANDARD",
          },
        },
      ],
    });

    expect(parsed.hasAdvancedFields).toBe(true);
  });

  it("builds aws-compatible replication payload from graphical state", () => {
    const configuration = buildReplicationConfigurationFromGraphical("arn:aws:iam::123456789012:role/replication", [
      {
        id: "rule-1",
        status: "Enabled",
        priority: "2",
        prefix: "images/",
        destinationBucket: "arn:aws:s3:::target-bucket",
        deleteMarkerStatus: "Disabled",
      },
    ]);

    expect(configuration).toEqual({
      Role: "arn:aws:iam::123456789012:role/replication",
      Rules: [
        {
          ID: "rule-1",
          Status: "Enabled",
          Priority: 2,
          Filter: { Prefix: "images/" },
          Destination: { Bucket: "arn:aws:s3:::target-bucket" },
          DeleteMarkerReplication: { Status: "Disabled" },
        },
      ],
    });
  });

  it("validates unsupported Zone field in json mode", () => {
    const validationError = validateJsonReplicationConfiguration({
      Role: "arn:aws:iam::123456789012:role/replication",
      Rules: [
        {
          Status: "Enabled",
          Destination: {
            Bucket: "arn:aws:s3:::target-bucket",
            Zone: "us-east-1a",
          },
        },
      ],
    });

    expect(validationError).toBe("Destination.Zone is not supported in V1.");
    expect(
      containsUnsupportedReplicationZone({
        Rules: [{ Destination: { Bucket: "arn:aws:s3:::target-bucket", Zone: "us-east-1a" } }],
      })
    ).toBe(true);
  });

  it("requires destination bucket in graphical validation", () => {
    const emptyRule = createEmptyGraphicalReplicationRule();
    const validationError = validateGraphicalReplication("arn:aws:iam::123456789012:role/replication", [emptyRule]);

    expect(validationError).toBe("Rule 1: Destination bucket ARN is required.");
  });

  it("normalizes empty replication payloads and marks empty role as not configured", () => {
    expect(normalizeReplicationConfiguration({})).toEqual({});
    expect(normalizeReplicationConfiguration({ Role: "" })).toEqual({});
    expect(normalizeReplicationConfiguration({ Role: "", Rules: [] })).toEqual({});

    expect(isReplicationConfigurationConfigured({})).toBe(false);
    expect(isReplicationConfigurationConfigured({ Role: "" })).toBe(false);
    expect(isReplicationConfigurationConfigured({ Role: "", Rules: [] })).toBe(false);
    expect(isReplicationConfigurationConfigured({ Rules: [{ ID: "rule-1" }] })).toBe(true);
  });
});
