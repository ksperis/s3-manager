import { describe, expect, it } from "vitest";

import {
  deleteNotificationConfigurations,
  isNotificationConfigurationEmpty,
  mergeNotificationConfigurations,
  parseNotificationConfiguration,
} from "./bucketJsonParsers";

describe("notification bulk configuration helpers", () => {
  it("parses a notification configuration object", () => {
    const parsed = parseNotificationConfiguration(
      JSON.stringify({
        TopicConfigurations: [
          {
            Id: "topic-created",
            TopicArn: "arn:aws:sns:default:account:topic",
            Events: ["s3:ObjectCreated:*"],
          },
        ],
      })
    );

    expect(parsed).toEqual({
      configuration: {
        TopicConfigurations: [
          {
            Id: "topic-created",
            TopicArn: "arn:aws:sns:default:account:topic",
            Events: ["s3:ObjectCreated:*"],
          },
        ],
      },
    });
  });

  it("rejects empty notification configuration input", () => {
    expect(parseNotificationConfiguration("{}")).toEqual({
      error: "Provide at least one notification configuration.",
    });
    expect(parseNotificationConfiguration("[]")).toEqual({
      error: "Notification configuration must be a JSON object.",
    });
  });

  it("replaces entries with the same ID and adds new entries", () => {
    const result = mergeNotificationConfigurations(
      {
        TopicConfigurations: [
          { Id: "shared", TopicArn: "old-topic", Events: ["s3:ObjectCreated:*"] },
          { Id: "kept", TopicArn: "kept-topic", Events: ["s3:ObjectRemoved:*"] },
        ],
      },
      {
        TopicConfigurations: [
          { ID: "shared", TopicArn: "new-topic", Events: ["s3:ObjectCreated:*"] },
          { TopicArn: "anonymous-topic", Events: ["s3:ObjectRestore:*"] },
        ],
      }
    );

    expect(result.configuration).toEqual({
      TopicConfigurations: [
        { ID: "shared", TopicArn: "new-topic", Events: ["s3:ObjectCreated:*"] },
        { Id: "kept", TopicArn: "kept-topic", Events: ["s3:ObjectRemoved:*"] },
        { TopicArn: "anonymous-topic", Events: ["s3:ObjectRestore:*"] },
      ],
    });
    expect(result.changes.map((change) => change.action)).toEqual(["replace", "add"]);
  });

  it("does not duplicate anonymous entries with identical content", () => {
    const anonymousEntry = { QueueArn: "queue-a", Events: ["s3:ObjectCreated:*"] };
    const result = mergeNotificationConfigurations(
      { QueueConfigurations: [anonymousEntry] },
      { QueueConfigurations: [{ ...anonymousEntry }] }
    );

    expect(result.configuration).toEqual({ QueueConfigurations: [anonymousEntry] });
    expect(result.changes).toEqual([]);
  });

  it("treats EventBridgeConfiguration as a singleton", () => {
    const result = mergeNotificationConfigurations(
      { EventBridgeConfiguration: { Enabled: false } },
      { EventBridgeConfiguration: {} }
    );

    expect(result.configuration).toEqual({ EventBridgeConfiguration: {} });
    expect(result.changes).toHaveLength(1);
    expect(isNotificationConfigurationEmpty(result.configuration)).toBe(false);
  });

  it("deletes entries by ID across notification destination types", () => {
    const result = deleteNotificationConfigurations(
      {
        TopicConfigurations: [{ Id: "remove-me" }, { Id: "keep-topic" }],
        QueueConfigurations: [{ id: "remove-me" }, { Id: "keep-queue" }],
      },
      new Set(["remove-me"]),
      new Set()
    );

    expect(result.configuration).toEqual({
      TopicConfigurations: [{ Id: "keep-topic" }],
      QueueConfigurations: [{ Id: "keep-queue" }],
    });
    expect(result.changes).toHaveLength(2);
  });

  it("deletes entries by notification type including EventBridge", () => {
    const result = deleteNotificationConfigurations(
      {
        TopicConfigurations: [{ Id: "topic" }],
        QueueConfigurations: [{ Id: "queue" }],
        LambdaFunctionConfigurations: [{ Id: "lambda" }],
        EventBridgeConfiguration: {},
      },
      new Set(),
      new Set(["queue", "eventbridge"])
    );

    expect(result.configuration).toEqual({
      TopicConfigurations: [{ Id: "topic" }],
      LambdaFunctionConfigurations: [{ Id: "lambda" }],
    });
    expect(result.changes.map((change) => change.type)).toEqual(["queue", "eventbridge"]);
  });

  it("reports empty after deleting the last configuration", () => {
    const result = deleteNotificationConfigurations(
      { LambdaFunctionConfigurations: [{ Id: "remove-me" }] },
      new Set(["remove-me"]),
      new Set()
    );

    expect(result.configuration).toEqual({});
    expect(isNotificationConfigurationEmpty(result.configuration)).toBe(true);
  });
});
