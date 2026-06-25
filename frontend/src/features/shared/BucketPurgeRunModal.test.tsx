import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BucketPurgePayload, BucketPurgeResult } from "../../api/bucketPurge";
import BucketPurgeRunModal from "./BucketPurgeRunModal";

const streamManagerBucketPurgeMock = vi.fn();
const streamManagerBucketDeleteWithPurgeMock = vi.fn();
const streamCephAdminBucketPurgeMock = vi.fn();
const streamStorageOpsBucketPurgeMock = vi.fn();

vi.mock("../../api/bucketPurge", async () => {
  const actual = await vi.importActual<typeof import("../../api/bucketPurge")>("../../api/bucketPurge");
  return {
    ...actual,
    streamManagerBucketPurge: (...args: unknown[]) => streamManagerBucketPurgeMock(...args),
    streamManagerBucketDeleteWithPurge: (...args: unknown[]) => streamManagerBucketDeleteWithPurgeMock(...args),
    streamCephAdminBucketPurge: (...args: unknown[]) => streamCephAdminBucketPurgeMock(...args),
    streamStorageOpsBucketPurge: (...args: unknown[]) => streamStorageOpsBucketPurgeMock(...args),
  };
});

function buildPurgeResult(): BucketPurgeResult {
  return {
    status: "completed_with_errors",
    total_buckets: 2,
    completed_buckets: 2,
    listed_objects: 4,
    listed_versions: 3,
    deleted_objects: 4,
    deleted_versions: 2,
    failed_count: 1,
    bucket_deleted: false,
    started_at: "2026-01-01T00:00:00Z",
    finished_at: "2026-01-01T00:00:03Z",
    buckets: [
      {
        bucket_name: "bucket-a",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "completed_with_errors",
        listed_objects: 2,
        listed_versions: 2,
        deleted_objects: 2,
        deleted_versions: 1,
        failed_count: 1,
        bucket_deleted: false,
        duration_seconds: 1.2,
        failures_sample: [
          {
            bucket_name: "bucket-a",
            stage: "delete",
            key: "broken.txt",
            version_id: "v1",
            count: 1,
            message: "AccessDenied: denied",
          },
        ],
      },
      {
        bucket_name: "bucket-b",
        context_id: "ctx-1",
        context_name: "Context 1",
        status: "completed",
        listed_objects: 2,
        listed_versions: 1,
        deleted_objects: 2,
        deleted_versions: 1,
        failed_count: 0,
        bucket_deleted: false,
        duration_seconds: 0.6,
        failures_sample: [],
      },
    ],
  };
}

function closestDetails(element: HTMLElement): HTMLDetailsElement {
  const details = element.closest("details");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Expected element to be inside a details element.");
  }
  return details;
}

describe("BucketPurgeRunModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamManagerBucketPurgeMock.mockImplementation((_contextId, _payload, options) => {
      options?.onProgress?.({
        stage: "delete",
        total_buckets: 2,
        completed_buckets: 1,
        listed_objects: 4,
        listed_versions: 3,
        deleted_objects: 3,
        deleted_versions: 1,
        failed_count: 0,
        bucket_deleted: false,
      });
      return Promise.resolve(buildPurgeResult());
    });
    streamManagerBucketDeleteWithPurgeMock.mockImplementation((_contextId, _bucketName, _payload, options) => {
      options?.onProgress?.({
        stage: "delete_bucket",
        total_buckets: 1,
        completed_buckets: 0,
        listed_objects: 2,
        listed_versions: 1,
        deleted_objects: 2,
        deleted_versions: 1,
        failed_count: 0,
        bucket_deleted: false,
      });
      return Promise.resolve({
        ...buildPurgeResult(),
        status: "completed",
        total_buckets: 1,
        completed_buckets: 1,
        failed_count: 0,
        bucket_deleted: true,
        buckets: [
          {
            ...buildPurgeResult().buckets[0],
            status: "completed",
            failed_count: 0,
            bucket_deleted: true,
            failures_sample: [],
          },
        ],
      });
    });
    streamCephAdminBucketPurgeMock.mockResolvedValue(buildPurgeResult());
    streamStorageOpsBucketPurgeMock.mockResolvedValue(buildPurgeResult());
  });

  it("requires the exact confirmation before starting the manager purge", async () => {
    const user = userEvent.setup();
    render(
      <BucketPurgeRunModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }, { bucketName: "bucket-b" }]}
        onClose={() => undefined}
      />
    );

    const startButton = screen.getByRole("button", { name: "Start purge" });
    expect(startButton).toBeDisabled();
    await user.type(screen.getByLabelText("Type PURGE 2 BUCKETS"), "PURGE 1 BUCKETS");
    expect(startButton).toBeDisabled();
    await user.clear(screen.getByLabelText("Type PURGE 2 BUCKETS"));
    await user.type(screen.getByLabelText("Type PURGE 2 BUCKETS"), "PURGE 2 BUCKETS");
    await user.click(startButton);

    await waitFor(() => {
      expect(streamManagerBucketPurgeMock).toHaveBeenCalledTimes(1);
    });
    const payload = streamManagerBucketPurgeMock.mock.calls[0][1] as BucketPurgePayload;
    expect(payload).toMatchObject({
      buckets: ["bucket-a", "bucket-b"],
      parallelism: 10,
      include_versions: true,
      confirmation: "PURGE 2 BUCKETS",
    });
    expect(
      await screen.findByText((_, node) => node?.textContent === "4 / 7 entries deleted")
    ).toBeInTheDocument();
    expect(screen.getByText("Purge completed with errors.")).toBeInTheDocument();
  });

  it("renders expandable bucket purge failures", async () => {
    const user = userEvent.setup();
    render(
      <BucketPurgeRunModal
        mode="manager"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }, { bucketName: "bucket-b" }]}
        onClose={() => undefined}
      />
    );

    await user.type(screen.getByLabelText("Type PURGE 2 BUCKETS"), "PURGE 2 BUCKETS");
    await user.click(screen.getByRole("button", { name: "Start purge" }));
    await screen.findByText("Purge completed with errors.");
    const bucketElement = screen.getAllByText("bucket-a").find((element) => element.closest("details"));
    if (!bucketElement) {
      throw new Error("Expected bucket result details for bucket-a.");
    }
    const bucketDetails = closestDetails(bucketElement);
    await user.click(within(bucketDetails).getByText("bucket-a"));

    expect(bucketDetails).toHaveAttribute("open");
    expect(within(bucketDetails).getByText("broken.txt")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("v1")).toBeInTheDocument();
    expect(within(bucketDetails).getByText("AccessDenied: denied")).toBeInTheDocument();
  });

  it("builds storage ops target payloads with context ids", async () => {
    const user = userEvent.setup();
    render(
      <BucketPurgeRunModal
        mode="storage-ops"
        targets={[{ bucketName: "bucket-a", contextId: "s3u-1", contextName: "S3 User 1" }]}
        onClose={() => undefined}
      />
    );

    await user.type(screen.getByLabelText("Type PURGE 1 BUCKETS"), "PURGE 1 BUCKETS");
    await user.click(screen.getByRole("button", { name: "Start purge" }));
    await waitFor(() => {
      expect(streamStorageOpsBucketPurgeMock).toHaveBeenCalledTimes(1);
    });
    expect(streamStorageOpsBucketPurgeMock.mock.calls[0][0]).toMatchObject({
      targets: [{ context_id: "s3u-1", bucket_name: "bucket-a" }],
      confirmation: "PURGE 1 BUCKETS",
    });
  });

  it("runs manager delete with purge with the delete confirmation phrase", async () => {
    const user = userEvent.setup();
    streamManagerBucketPurgeMock.mockClear();
    render(
      <BucketPurgeRunModal
        mode="manager-delete"
        contextId="ctx-1"
        contextName="Context 1"
        targets={[{ bucketName: "bucket-a" }]}
        onClose={() => undefined}
      />
    );

    const deleteButton = screen.getByRole("button", { name: "Delete bucket" });
    expect(deleteButton).toBeDisabled();
    expect(
      screen.getByText(
        "This deletes current objects, historical versions, and delete markers, then removes the bucket and its S3 configuration."
      )
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Type DELETE BUCKET bucket-a"), "DELETE BUCKET bucket-a");
    await user.click(deleteButton);

    await waitFor(() => {
      expect(streamManagerBucketPurgeMock).not.toHaveBeenCalled();
      expect(streamManagerBucketDeleteWithPurgeMock).toHaveBeenCalledTimes(1);
    });
    expect(streamManagerBucketDeleteWithPurgeMock.mock.calls[0][0]).toBe("ctx-1");
    expect(streamManagerBucketDeleteWithPurgeMock.mock.calls[0][1]).toBe("bucket-a");
    expect(streamManagerBucketDeleteWithPurgeMock.mock.calls[0][2]).toMatchObject({
      parallelism: 10,
      confirmation: "DELETE BUCKET bucket-a",
    });
  });
});
