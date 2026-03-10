import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bucket, ManagerBucketCompareActionResult, ManagerBucketCompareResult } from "../../api/buckets";
import type { ExecutionContext } from "../../api/executionContexts";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";

const listBucketsMock = vi.fn<(contextId: string, options?: { with_stats?: boolean }) => Promise<Bucket[]>>();
const compareManagerBucketPairMock = vi.fn();
const runManagerBucketCompareActionMock = vi.fn();

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBuckets: (contextId: string, options?: { with_stats?: boolean }) => listBucketsMock(contextId, options),
    compareManagerBucketPair: (...args: unknown[]) => compareManagerBucketPairMock(...args),
    runManagerBucketCompareAction: (...args: unknown[]) => runManagerBucketCompareActionMock(...args),
  };
});

const contexts: ExecutionContext[] = [
  {
    kind: "account",
    id: "ctx-source",
    display_name: "Source context",
    capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
  },
  {
    kind: "account",
    id: "ctx-target",
    display_name: "Target context",
    capabilities: { can_manage_iam: true, sts_capable: true, admin_api_capable: true },
  },
];

function buildCompareResult(overrides?: Partial<ManagerBucketCompareResult>): ManagerBucketCompareResult {
  return {
    source_context_id: "ctx-source",
    target_context_id: "ctx-target",
    source_bucket: "bucket-a",
    target_bucket: "bucket-a",
    has_differences: true,
    content_diff: {
      source_count: 10,
      target_count: 9,
      matched_count: 7,
      different_count: 1,
      only_source_count: 2,
      only_target_count: 1,
      only_source_sample: ["source-only-1", "source-only-2"],
      only_target_sample: ["target-only-1"],
      different_sample: [
        {
          key: "different-1",
          compare_by: "md5",
          source_size: 100,
          target_size: 120,
          source_etag: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          target_etag: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    },
    config_diff: null,
    ...overrides,
  };
}

function buildActionResult(overrides?: Partial<ManagerBucketCompareActionResult>): ManagerBucketCompareActionResult {
  return {
    action: "sync_source_only",
    source_context_id: "ctx-source",
    target_context_id: "ctx-target",
    source_bucket: "bucket-a",
    target_bucket: "bucket-a",
    planned_count: 2,
    succeeded_count: 2,
    failed_count: 0,
    failed_keys_sample: [],
    message: "Action completed",
    ...overrides,
  };
}

async function runInitialComparison() {
  const user = userEvent.setup();
  render(
    <ManagerBucketCompareModal
      sourceContextId="ctx-source"
      sourceContextName="Source context"
      sourceBuckets={["bucket-a"]}
      contexts={contexts}
      onClose={() => undefined}
    />
  );

  const [targetContextSelect] = screen.getAllByRole("combobox");
  await user.selectOptions(targetContextSelect, "ctx-target");
  await waitFor(() => {
    expect(listBucketsMock).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: /run comparison/i })).toBeEnabled();
  });
  await user.click(screen.getByRole("button", { name: /run comparison/i }));
  await waitFor(() => {
    expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(1);
  });
  return user;
}

describe("ManagerBucketCompareModal remediation actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" } as Bucket]);
    compareManagerBucketPairMock.mockResolvedValue(buildCompareResult());
    runManagerBucketCompareActionMock.mockResolvedValue(buildActionResult());
  });

  it("shows remediation action buttons when content sections have differences", async () => {
    await runInitialComparison();

    expect(await screen.findByRole("button", { name: "Sync missing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync different" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete extra" })).toBeInTheDocument();
  });

  it("opens a confirmation modal before running remediation", async () => {
    const user = await runInitialComparison();
    await user.click(await screen.findByRole("button", { name: "Sync missing" }));

    expect(await screen.findByText("Confirm sync missing objects")).toBeInTheDocument();
    expect(screen.getByText(/Estimated objects impacted:/i)).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
  });

  it("runs action API and auto re-compares the same pair with current run options", async () => {
    compareManagerBucketPairMock
      .mockResolvedValueOnce(buildCompareResult())
      .mockResolvedValueOnce(
        buildCompareResult({
          has_differences: false,
          content_diff: {
            ...buildCompareResult().content_diff!,
            matched_count: 10,
            different_count: 0,
            only_source_count: 0,
            only_target_count: 0,
            only_source_sample: [],
            only_target_sample: [],
            different_sample: [],
          },
        })
      );
    runManagerBucketCompareActionMock.mockResolvedValueOnce(
      buildActionResult({
        action: "sync_source_only",
        message: "Sync missing done",
      })
    );

    const user = await runInitialComparison();
    await user.click(await screen.findByRole("button", { name: "Sync missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(runManagerBucketCompareActionMock).toHaveBeenCalledTimes(1);
    });
    expect(runManagerBucketCompareActionMock).toHaveBeenCalledWith(
      "ctx-source",
      expect.objectContaining({
        target_context_id: "ctx-target",
        source_bucket: "bucket-a",
        target_bucket: "bucket-a",
        action: "sync_source_only",
      })
    );
    await waitFor(() => {
      expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(2);
    });
    expect(compareManagerBucketPairMock).toHaveBeenLastCalledWith(
      "ctx-source",
      expect.objectContaining({
        target_context_id: "ctx-target",
        source_bucket: "bucket-a",
        target_bucket: "bucket-a",
        include_content: true,
      })
    );
  });

  it("disables remediation buttons while an action is running", async () => {
    compareManagerBucketPairMock.mockResolvedValueOnce(buildCompareResult()).mockResolvedValueOnce(buildCompareResult());
    let resolveAction: ((value: ManagerBucketCompareActionResult) => void) | null = null;
    runManagerBucketCompareActionMock.mockImplementationOnce(
      () =>
        new Promise<ManagerBucketCompareActionResult>((resolve) => {
          resolveAction = resolve;
        })
    );

    const user = await runInitialComparison();
    await user.click(await screen.findByRole("button", { name: "Sync missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Running..." })).toBeDisabled();
    });
    resolveAction?.(buildActionResult());
    await waitFor(() => {
      expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an inline error message when action API fails", async () => {
    runManagerBucketCompareActionMock.mockRejectedValueOnce(new Error("boom"));

    const user = await runInitialComparison();
    await user.click(await screen.findByRole("button", { name: "Sync missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Action failed: boom/i)).toBeInTheDocument();
    expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(1);
  });
});
