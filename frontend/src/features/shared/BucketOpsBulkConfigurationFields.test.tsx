/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BucketOpsBulkConfigurationFields from "./BucketOpsBulkConfigurationFields";
import type { BulkOperation } from "./bucketBulkOperationsModel";
import { useBucketOpsBulkForm } from "./useBucketOpsBulkForm";

const TEST_OPERATIONS: BulkOperation[] = [
  "set_quota",
  "remove_public_access_block",
  "add_lifecycle",
  "add_notifications",
  "delete_policy",
];

function ConfigurationHarness() {
  const controller = useBucketOpsBulkForm();
  return (
    <>
      <label htmlFor="test-bulk-operation">Test operation</label>
      <select
        id="test-bulk-operation"
        value={controller.bulkOperation}
        onChange={(event) =>
          controller.setBulkOperation(event.target.value as BulkOperation)
        }
      >
        <option value="">None</option>
        {TEST_OPERATIONS.map((operation) => (
          <option key={operation} value={operation}>
            {operation}
          </option>
        ))}
      </select>
      <output data-testid="configuration-state">
        {JSON.stringify({
          bulkLifecycleRuleText: controller.bulkLifecycleRuleText,
          bulkLifecycleUpdateOnlyExisting:
            controller.bulkLifecycleUpdateOnlyExisting,
          bulkNotificationText: controller.bulkNotificationText,
          bulkPolicyDeleteIds: controller.bulkPolicyDeleteIds,
          bulkPolicyDeleteTypes: controller.bulkPolicyDeleteTypes,
          bulkPublicAccessBlockTargets:
            controller.bulkPublicAccessBlockTargets,
          bulkQuotaApplySize: controller.bulkQuotaApplySize,
          bulkQuotaObjects: controller.bulkQuotaObjects,
          bulkQuotaSizeUnit: controller.bulkQuotaSizeUnit,
          bulkQuotaSizeValue: controller.bulkQuotaSizeValue,
        })}
      </output>
      <BucketOpsBulkConfigurationFields controller={controller} />
    </>
  );
}

const selectOperation = (operation: BulkOperation) => {
  fireEvent.change(screen.getByLabelText("Test operation"), {
    target: { value: operation },
  });
};

const currentState = () =>
  JSON.parse(screen.getByTestId("configuration-state").textContent ?? "{}");

describe("BucketOpsBulkConfigurationFields", () => {
  it("updates quota values and disables omitted targets", () => {
    render(<ConfigurationHarness />);
    selectOperation("set_quota");

    fireEvent.change(screen.getByLabelText("Storage quota"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Unit"), {
      target: { value: "TiB" },
    });
    fireEvent.change(screen.getByLabelText("Object quota"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByLabelText("Update storage quota"));

    expect(screen.getByLabelText("Storage quota")).toBeDisabled();
    expect(screen.getByLabelText("Unit")).toBeDisabled();
    expect(currentState()).toMatchObject({
      bulkQuotaApplySize: false,
      bulkQuotaObjects: "200",
      bulkQuotaSizeUnit: "TiB",
      bulkQuotaSizeValue: "5",
    });
  });

  it("reuses the JSON editor for lifecycle and notification inputs", () => {
    render(<ConfigurationHarness />);
    selectOperation("add_lifecycle");

    fireEvent.change(screen.getByLabelText("Lifecycle rules (JSON)"), {
      target: { value: '{"ID":"archive"}' },
    });
    fireEvent.click(
      screen.getByLabelText(
        "Only update rules that already exist (do not add new rules).",
      ),
    );
    selectOperation("add_notifications");
    fireEvent.change(
      screen.getByLabelText("Notification configuration (JSON)"),
      { target: { value: '{"TopicConfigurations":[]}' } },
    );

    expect(currentState()).toMatchObject({
      bulkLifecycleRuleText: '{"ID":"archive"}',
      bulkLifecycleUpdateOnlyExisting: true,
      bulkNotificationText: '{"TopicConfigurations":[]}',
    });
  });

  it("reuses typed deletion criteria for IDs and rule categories", () => {
    render(<ConfigurationHarness />);
    selectOperation("delete_policy");

    fireEvent.change(
      screen.getByLabelText(
        "Statement IDs (Sid) (comma, newline, or JSON array)",
      ),
      { target: { value: "DenyWrite" } },
    );
    fireEvent.click(screen.getByLabelText("Deny statements"));

    expect(currentState()).toMatchObject({
      bulkPolicyDeleteIds: "DenyWrite",
      bulkPolicyDeleteTypes: { deny: true },
    });
  });

  it("captures public access checkbox values before functional updates", () => {
    render(<ConfigurationHarness />);
    selectOperation("remove_public_access_block");

    fireEvent.click(screen.getByLabelText("BlockPublicAcls"));

    expect(currentState().bulkPublicAccessBlockTargets).toMatchObject({
      block_public_acls: false,
      ignore_public_acls: true,
      block_public_policy: true,
      restrict_public_buckets: true,
    });
  });
});
