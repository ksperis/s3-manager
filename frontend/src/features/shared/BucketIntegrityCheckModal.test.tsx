import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketIntegrityCheckPayload, BucketIntegrityResult } from "../../api/bucketIntegrity";
import BucketIntegrityCheckModal from "./BucketIntegrityCheckModal";

const streamManagerBucketIntegrityCheckMock = vi.fn();
const streamCephAdminBucketIntegrityCheckMock = vi.fn();
const streamStorageOpsBucketIntegrityCheckMock = vi.fn();

vi.mock("../../api/bucketIntegrity", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketIntegrity")>("../../api/bucketIntegrity");
  return {
    ...actual,
    streamManagerBucketIntegrityCheck: (...args: unknown[]) => streamManagerBucketIntegrityCheckMock(...args),
    streamCephAdminBucketIntegrityCheck: (...args: unknown[]) => streamCephAdminBucketIntegrityCheckMock(...args),
    streamStorageOpsBucketIntegrityCheck: (...args: unknown[]) => streamStorageOpsBucketIntegrityCheckMock(...args),
  };
});

function buildIntegrityResult(): BucketIntegrityResult {
  return {
    status: "completed_with_errors",
    total_buckets: 2,
    completed_buckets: 2,
    listed_count: 3,
    checked_count: 3,
    failed_count: 1,
    bytes_read: 3072,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:03Z",
    buckets: [
      {
        bucket_name: "bucket-a",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "completed_with_errors",
        listed_count: 2,
        checked_count: 2,
        failed_count: 1,
        bytes_read: 1024,
        duration_seconds: 1.2,
        failures_sample: [
          {
            bucket_name: "bucket-a",
            stage: "get",
            key: "broken.txt",
            version_id: "v1",
            message: "AccessDenied: denied",
          },
        ],
      },
      {
        bucket_name: "bucket-b",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "passed",
        listed_count: 1,
        checked_count: 1,
        failed_count: 0,
        bytes_read: 2048,
        duration_seconds: 0.6,
        failures_sample: [],
      },
    ],
  };
}

async function runIntegrityCheck() {
  const user = userEvent.setup();
  render(
    <BucketIntegrityCheckModal
      mode="manager"
      contextId="ctx-1"
      contextName="Context 1"
      targets={[{ bucketName: "bucket-a" }, { bucketName: "bucket-b" }]}
      onClose={() => undefined}
    />
  );
  await user.click(screen.getByRole("button", { name: "Run check" }));
  await waitFor(() => {
    expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
  });
  expect(await screen.findByText("Showing 2 / 2 bucket result(s).")).toBeInTheDocument();
  return user;
}

function closestDetails(element: HTMLElement): HTMLDetailsElement {
  const details = element.closest("details");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Expected element to be inside a details element.");
  }
  return details;
}

describe("BucketIntegrityCheckModal results", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamManagerBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    streamCephAdminBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    streamStorageOpsBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
  });

  it("renders expandable bucket details with affected object rows", async () => {
    const user = await runIntegrityCheck();

    const bucketDetails = closestDetails(screen.getByText("bucket-a"));
    expect(bucketDetails).not.toHaveAttribute("open");

    await user.click(within(bucketDetails).getByText("bucket-a"));

    expect(bucketDetails).toHaveAttribute("open");
    expect(within(bucketDetails).getByText("Affected objects")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("broken.txt")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("v1")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("AccessDenied: denied")).toBeInTheDocument();
  });

  it("runs HEAD mode by default and GET mode when selected", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <BucketIntegrityCheckModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    const maxMbInput = screen.getByLabelText("Max MB per object") as HTMLInputElement;
    expect(maxMbInput).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() => {
      expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
    });
    let payload = streamManagerBucketIntegrityCheckMock.mock.calls[0][1] as BucketIntegrityCheckPayload;
    expect(payload.check_mode).toBe("head");
    expect(payload.max_mb_per_object).toBeUndefined();

    vi.clearAllMocks();
    streamManagerBucketIntegrityCheckMock.mockResolvedValue(buildIntegrityResult());
    rerender(
      <BucketIntegrityCheckModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    await user.click(screen.getByRole("button", { name: "GET body" }));
    const enabledMaxMbInput = screen.getByLabelText("Max MB per object") as HTMLInputElement;
    expect(enabledMaxMbInput).not.toBeDisabled();
    await user.type(enabledMaxMbInput, "1.5");
    await user.click(screen.getByRole("button", { name: "Run check" }));
    await waitFor(() => {
      expect(streamManagerBucketIntegrityCheckMock).toHaveBeenCalledTimes(1);
    });
    payload = streamManagerBucketIntegrityCheckMock.mock.calls[0][1] as BucketIntegrityCheckPayload;
    expect(payload.check_mode).toBe("get");
    expect(payload.max_mb_per_object).toBe(1.5);
  });

  it("filters bucket results by object text, status, and error state", async () => {
    const user = await runIntegrityCheck();

    await user.type(screen.getByPlaceholderText("Filter by bucket, context, object, or error"), "broken");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-a")).toBeInTheDocument();
    expect(screen.queryByText("bucket-b")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset filters" }));
    await user.selectOptions(screen.getByLabelText("Filter integrity status"), "passed");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-b")).toBeInTheDocument();
    expect(screen.queryByText("bucket-a")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter integrity status"), "all");
    await user.selectOptions(screen.getByLabelText("Filter integrity errors"), "with_errors");
    expect(screen.getByText("Showing 1 / 2 bucket result(s).")).toBeInTheDocument();
    expect(screen.getByText("bucket-a")).toBeInTheDocument();
    expect(screen.queryByText("bucket-b")).not.toBeInTheDocument();
  });
});
