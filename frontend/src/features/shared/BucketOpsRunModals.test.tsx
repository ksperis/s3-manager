/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./BucketIntegrityCheckModal", () => ({
  default: (props: Record<string, unknown>) => (
    <button
      data-testid="integrity-modal"
      data-mode={props.mode}
      data-endpoint-id={props.endpointId}
      data-endpoint-name={props.endpointName}
      onClick={props.onClose as () => void}
    >
      Integrity
    </button>
  ),
}));

vi.mock("./BucketPurgeRunModal", () => ({
  default: (props: Record<string, unknown>) => (
    <button
      data-testid="purge-modal"
      data-mode={props.mode}
      data-endpoint-id={props.endpointId}
      onClick={props.onClose as () => void}
    >
      Purge
    </button>
  ),
}));

vi.mock("./BucketUsageStatsRunModal", () => ({
  default: (props: Record<string, unknown>) => (
    <button
      data-testid="usage-modal"
      data-mode={props.mode}
      data-endpoint-id={props.endpointId}
      onClick={props.onClose as () => void}
    >
      Usage
    </button>
  ),
}));

import BucketOpsRunModals from "./BucketOpsRunModals";

const targets = [{ bucketName: "archive", contextId: "account-1" }];

describe("BucketOpsRunModals", () => {
  it("does not mount run modals without operation targets", () => {
    const { container } = render(
      <BucketOpsRunModals
        endpointId={7}
        isStorageOps={false}
        onCloseIntegrity={vi.fn()}
        onClosePurge={vi.fn()}
        onCloseUsageStats={vi.fn()}
        showIntegrity
        showPurge
        showUsageStats
        targets={[]}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("provides the Ceph Admin endpoint to every requested modal", () => {
    const onCloseIntegrity = vi.fn();
    const onClosePurge = vi.fn();
    const onCloseUsageStats = vi.fn();
    render(
      <BucketOpsRunModals
        endpointId={7}
        endpointName="Archive"
        isStorageOps={false}
        onCloseIntegrity={onCloseIntegrity}
        onClosePurge={onClosePurge}
        onCloseUsageStats={onCloseUsageStats}
        showIntegrity
        showPurge
        showUsageStats
        targets={targets}
      />,
    );

    expect(screen.getByTestId("integrity-modal")).toHaveAttribute(
      "data-mode",
      "ceph-admin",
    );
    expect(screen.getByTestId("integrity-modal")).toHaveAttribute(
      "data-endpoint-id",
      "7",
    );
    expect(screen.getByTestId("integrity-modal")).toHaveAttribute(
      "data-endpoint-name",
      "Archive",
    );
    expect(screen.getByTestId("purge-modal")).toHaveAttribute(
      "data-endpoint-id",
      "7",
    );
    expect(screen.getByTestId("usage-modal")).toHaveAttribute(
      "data-endpoint-id",
      "7",
    );

    fireEvent.click(screen.getByTestId("integrity-modal"));
    fireEvent.click(screen.getByTestId("purge-modal"));
    fireEvent.click(screen.getByTestId("usage-modal"));
    expect(onCloseIntegrity).toHaveBeenCalledOnce();
    expect(onClosePurge).toHaveBeenCalledOnce();
    expect(onCloseUsageStats).toHaveBeenCalledOnce();
  });

  it("uses Storage Ops mode without requiring an endpoint", () => {
    render(
      <BucketOpsRunModals
        endpointId={null}
        isStorageOps
        onCloseIntegrity={vi.fn()}
        onClosePurge={vi.fn()}
        onCloseUsageStats={vi.fn()}
        showIntegrity
        showPurge={false}
        showUsageStats
        targets={targets}
      />,
    );

    expect(screen.getByTestId("integrity-modal")).toHaveAttribute(
      "data-mode",
      "storage-ops",
    );
    expect(screen.queryByTestId("purge-modal")).not.toBeInTheDocument();
    expect(screen.getByTestId("usage-modal")).not.toHaveAttribute(
      "data-endpoint-id",
    );
  });
});
