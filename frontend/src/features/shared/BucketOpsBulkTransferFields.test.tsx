/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsBulkTransferFields from "./BucketOpsBulkTransferFields";
import {
  DEFAULT_BULK_COPY_FEATURE_SELECTION,
  type BulkConfigClipboard,
} from "./bucketBulkOperationsModel";

type TransferProps = ComponentProps<typeof BucketOpsBulkTransferFields>;
type TransferController = TransferProps["controller"];

const createController = (
  overrides: Partial<TransferController> = {},
): TransferController => ({
  bulkCopyFeatures: { ...DEFAULT_BULK_COPY_FEATURE_SELECTION },
  bulkOperation: "",
  bulkPasteMapping: {},
  setBulkCopyFeatures: vi.fn(),
  setBulkOperation: vi.fn(),
  setBulkPasteMapping: vi.fn(),
  ...overrides,
});

const clipboard: BulkConfigClipboard = {
  version: 1,
  copiedAt: "2026-08-28T03:00:00.000Z",
  sourceEndpointId: 7,
  sourceEndpointName: "Primary",
  features: {
    ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
    versioning: true,
  },
  buckets: ["source-a", "source-b"].map((name) => ({
    name,
    quota: null,
    versioningEnabled: null,
    objectLock: null,
    publicAccessBlock: null,
    lifecycleRules: null,
    corsRules: null,
    policy: null,
    accessLogging: null,
  })),
};

const createProps = (
  overrides: Partial<TransferProps> = {},
): TransferProps => ({
  clipboard: null,
  clipboardSameEndpoint: false,
  controller: createController(),
  isStorageOps: false,
  pastePlan: { mode: null, mappings: [], error: null },
  quotaDisabledReason: null,
  scopeDisplayName: "Endpoint",
  selectedBucketNames: ["destination"],
  selectedCount: 1,
  snsFeatureEnabled: true,
  ...overrides,
});

describe("BucketOpsBulkTransferFields", () => {
  it("exposes only available operations and delegates selection", () => {
    const controller = createController();
    render(
      <BucketOpsBulkTransferFields
        {...createProps({
          controller,
          quotaDisabledReason: "stats unavailable",
          snsFeatureEnabled: false,
        })}
      />,
    );

    const operation = screen.getByLabelText("Operation");
    expect(
      within(operation).getByRole("option", {
        name: "Paste copied configurations (nothing copied)",
      }),
    ).toBeDisabled();
    expect(
      within(operation).getByRole("option", {
        name: "Set bucket quota (stats unavailable)",
      }),
    ).toBeDisabled();
    expect(
      within(operation).getByRole("option", {
        name: "Add or update notification configurations (SNS unavailable)",
      }),
    ).toBeDisabled();

    fireEvent.change(operation, { target: { value: "copy_configs" } });
    expect(controller.setBulkOperation).toHaveBeenCalledWith("copy_configs");
  });

  it("renders clipboard metadata and delegates copied features", () => {
    const setBulkCopyFeatures = vi.fn();
    const controller = createController({
      bulkOperation: "copy_configs",
      setBulkCopyFeatures,
    });
    render(
      <BucketOpsBulkTransferFields
        {...createProps({ clipboard, controller })}
      />,
    );

    expect(
      screen.getByText(/Clipboard currently contains config from/),
    ).toBeInTheDocument();
    expect(screen.getByText("Features: Versioning.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Versioning"));
    const update = setBulkCopyFeatures.mock.calls[0][0];
    expect(update(DEFAULT_BULK_COPY_FEATURE_SELECTION)).toEqual({
      ...DEFAULT_BULK_COPY_FEATURE_SELECTION,
      versioning: true,
    });
  });

  it("prevents same-bucket and duplicate paste mappings", () => {
    const setBulkPasteMapping = vi.fn();
    const controller = createController({
      bulkOperation: "paste_configs",
      bulkPasteMapping: { "source-b": "destination-b" },
      setBulkPasteMapping,
    });
    render(
      <BucketOpsBulkTransferFields
        {...createProps({
          clipboard,
          clipboardSameEndpoint: true,
          controller,
          pastePlan: { mode: "one_to_one", mappings: [], error: null },
          selectedBucketNames: [
            "source-a",
            "destination-b",
            "destination-c",
          ],
          selectedCount: 3,
        })}
      />,
    );

    const sourceMapping = screen.getByLabelText(
      "Destination bucket for source-a",
    );
    expect(
      within(sourceMapping).getByRole("option", {
        name: "source-a (same bucket not allowed)",
      }),
    ).toBeDisabled();
    expect(
      within(sourceMapping).getByRole("option", {
        name: "destination-b (already used)",
      }),
    ).toBeDisabled();

    fireEvent.change(sourceMapping, { target: { value: "destination-c" } });
    const update = setBulkPasteMapping.mock.calls[0][0];
    expect(update({ "source-b": "destination-b" })).toEqual({
      "source-a": "destination-c",
      "source-b": "destination-b",
    });
  });
});
