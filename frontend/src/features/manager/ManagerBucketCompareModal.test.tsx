import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Bucket, ManagerBucketCompareActionResult, ManagerBucketCompareResult } from "../../api/buckets";
import type { ExecutionContext } from "../../api/executionContexts";
import ManagerBucketCompareModal from "./ManagerBucketCompareModal";

const listBucketsMock = vi.fn<(contextId: string, options?: { with_stats?: boolean }) => Promise<Bucket[]>>();
const compareManagerBucketPairMock = vi.fn();
const runManagerBucketCompareActionMock = vi.fn();
const proxyDownloadMock = vi.fn();
const clipboardWriteTextMock = vi.fn<(value: string) => Promise<void>>();
const createObjectUrlMock = vi.fn(() => "blob:compare-download");
const revokeObjectUrlMock = vi.fn();

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBuckets: (contextId: string, options?: { with_stats?: boolean }) => listBucketsMock(contextId, options),
    compareManagerBucketPair: (...args: unknown[]) => compareManagerBucketPairMock(...args),
    runManagerBucketCompareAction: (...args: unknown[]) => runManagerBucketCompareActionMock(...args),
  };
});

vi.mock("../../api/browser", async () => {
  const actual = await vi.importActual<typeof import("../../api/browser")>("../../api/browser");
  return {
    ...actual,
    proxyDownload: (...args: unknown[]) => proxyDownloadMock(...args),
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
      only_source_details: [
        {
          key: "source-only-1",
          size: 1024,
          etag: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          last_modified: "2026-03-01T10:00:00Z",
          storage_class: "STANDARD",
        },
        {
          key: "source-only-2",
          size: 2048,
          etag: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          last_modified: "2026-03-01T11:00:00Z",
          storage_class: "STANDARD",
        },
      ],
      only_target_details: [
        {
          key: "target-only-1",
          size: 512,
          etag: "cccccccccccccccccccccccccccccccc",
          last_modified: "2026-03-01T12:00:00Z",
          storage_class: "GLACIER",
        },
      ],
      different_sample: [
        {
          key: "different-1",
          compare_by: "md5",
          source_size: 100,
          target_size: 120,
          source_etag: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          target_etag: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          source_last_modified: "2026-03-01T13:00:00Z",
          target_last_modified: "2026-03-01T14:00:00Z",
          source_storage_class: "STANDARD",
          target_storage_class: "STANDARD_IA",
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
  expect(compareManagerBucketPairMock).toHaveBeenCalledWith(
    "ctx-source",
    expect.objectContaining({ diff_sample_limit: 500 }),
    expect.anything()
  );
  return user;
}

function closestDetails(element: HTMLElement): HTMLDetailsElement {
  const details = element.closest("details");
  if (!(details instanceof HTMLDetailsElement)) {
    throw new Error("Expected element to be inside a details element.");
  }
  return details;
}

async function openDetailsByLabel(user: ReturnType<typeof userEvent.setup>, label: RegExp | string) {
  const element = await screen.findByText(label);
  const details = closestDetails(element);
  if (!details.open) {
    await user.click(element.closest("summary") ?? element);
  }
  return details;
}

async function openResultDetails(user: ReturnType<typeof userEvent.setup>) {
  return openDetailsByLabel(user, /bucket-a\s*->\s*bucket-a/i);
}

async function openContentDetails(user: ReturnType<typeof userEvent.setup>) {
  await openResultDetails(user);
  return openDetailsByLabel(user, "Content diff (md5 or size)");
}

async function openSourceOnlyDetails(user: ReturnType<typeof userEvent.setup>) {
  await openContentDetails(user);
  return openDetailsByLabel(user, "Source only (2)");
}

describe("ManagerBucketCompareModal remediation actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    clipboardWriteTextMock.mockResolvedValue(undefined);
    proxyDownloadMock.mockResolvedValue(new Blob(["object-data"], { type: "text/plain" }));
    createObjectUrlMock.mockReturnValue("blob:compare-download");
    Object.defineProperty(window.URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(window.URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const clipboard = window.navigator.clipboard ?? { writeText: clipboardWriteTextMock };
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: clipboard,
    });
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      value: clipboardWriteTextMock,
    });
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" } as Bucket]);
    compareManagerBucketPairMock.mockResolvedValue(buildCompareResult());
    runManagerBucketCompareActionMock.mockResolvedValue(buildActionResult());
  });

  it("labels completed results with differences and keeps the result tree collapsed", async () => {
    await runInitialComparison();

    const resultLabel = await screen.findByText(/bucket-a\s*->\s*bucket-a/i);
    expect(screen.getAllByText("Different").length).toBeGreaterThan(0);
    expect(screen.queryByText("success")).not.toBeInTheDocument();
    expect(closestDetails(resultLabel)).not.toHaveAttribute("open");
  });

  it("labels completed results without differences as identical", async () => {
    compareManagerBucketPairMock.mockResolvedValueOnce(
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
          only_source_details: [],
          only_target_details: [],
          different_sample: [],
        },
      })
    );

    await runInitialComparison();

    expect((await screen.findAllByText("Identical")).length).toBeGreaterThan(0);
  });

  it("shows remediation action buttons when content sections have differences", async () => {
    const user = await runInitialComparison();
    await openContentDetails(user);

    expect(await screen.findByRole("button", { name: "Re-run and sync all missing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run and sync all different" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run and delete all extra" })).toBeInTheDocument();
  });

  it("opens a confirmation modal before running remediation", async () => {
    const user = await runInitialComparison();
    await openContentDetails(user);
    await user.click(await screen.findByRole("button", { name: "Re-run and sync all missing" }));

    expect(await screen.findByText("Confirm re-run and sync missing objects")).toBeInTheDocument();
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
    await openContentDetails(user);
    await user.click(await screen.findByRole("button", { name: "Re-run and sync all missing" }));
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
        diff_sample_limit: 500,
      })
    );
  });

  it("sends modified-after cutoff as ISO when running comparison and remediation", async () => {
    runManagerBucketCompareActionMock.mockResolvedValueOnce(buildActionResult());
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
      expect(screen.getByRole("button", { name: /run comparison/i })).toBeEnabled();
    });
    const cutoffValue = "2026-03-02T10:30";
    await user.type(screen.getByLabelText("Ignore objects modified after"), cutoffValue);
    await user.click(screen.getByRole("button", { name: /run comparison/i }));

    await waitFor(() => {
      expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(1);
    });
    const expectedIso = new Date(cutoffValue).toISOString();
    expect(compareManagerBucketPairMock).toHaveBeenCalledWith(
      "ctx-source",
      expect.objectContaining({ ignore_modified_after: expectedIso }),
      expect.anything()
    );

    await openContentDetails(user);
    await user.click(await screen.findByRole("button", { name: "Re-run and sync all missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(runManagerBucketCompareActionMock).toHaveBeenCalled();
    });
    expect(runManagerBucketCompareActionMock).toHaveBeenCalledWith(
      "ctx-source",
      expect.objectContaining({ ignore_modified_after: expectedIso })
    );
  });

  it("runs a single-object remediation from an object row", async () => {
    compareManagerBucketPairMock.mockResolvedValueOnce(buildCompareResult()).mockResolvedValueOnce(buildCompareResult());
    runManagerBucketCompareActionMock.mockResolvedValueOnce(buildActionResult({ planned_count: 1, succeeded_count: 1 }));

    const user = await runInitialComparison();
    await openSourceOnlyDetails(user);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Sync this object" }).length).toBeGreaterThan(0);
    });
    await user.click(screen.getAllByRole("button", { name: "Sync this object" })[0]);
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(runManagerBucketCompareActionMock).toHaveBeenCalledTimes(1);
    });
    expect(runManagerBucketCompareActionMock).toHaveBeenCalledWith(
      "ctx-source",
      expect.objectContaining({
        action: "sync_source_only",
        object_key: "source-only-1",
      })
    );
  });

  it("renders object details and opens Browser links in a new tab", async () => {
    const user = await runInitialComparison();
    await openSourceOnlyDetails(user);

    expect(screen.queryByText(/Only \d+ of \d+ objects are visible in this section/i)).not.toBeInTheDocument();
    expect(await screen.findByText("source-only-1")).toBeInTheDocument();
    expect(screen.getByText("1.0 KB")).toBeInTheDocument();
    expect(screen.getAllByText(/Storage STANDARD/i).length).toBeGreaterThan(0);
    const exploreLinks = screen.getAllByRole("link", { name: "Explore" });
    expect(exploreLinks.length).toBeGreaterThan(0);
    expect(exploreLinks[0]).toHaveAttribute("target", "_blank");
    expect(exploreLinks[0]).toHaveAttribute("rel", "noreferrer");
    expect(exploreLinks[0]).toHaveAttribute(
      "href",
      expect.stringContaining("/manager/browser?ctx=ctx-source&bucket=bucket-a")
    );
    expect(screen.queryByRole("dialog", { name: "Leave comparison page?" })).not.toBeInTheDocument();
  });

  it("downloads object rows directly from the comparison result", async () => {
    const user = await runInitialComparison();
    const sourceOnlyDetails = await openSourceOnlyDetails(user);

    await user.click(within(sourceOnlyDetails).getAllByRole("button", { name: "Download" })[0]);

    await waitFor(() => {
      expect(proxyDownloadMock).toHaveBeenCalledWith("ctx-source", "bucket-a", "source-only-1");
    });
    expect(createObjectUrlMock).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:compare-download");
    expect(await screen.findByText("Download started for source-only-1.")).toBeInTheDocument();
  });

  it("shows a section warning only when visible object rows are incomplete", async () => {
    compareManagerBucketPairMock.mockResolvedValueOnce(
      buildCompareResult({
        content_diff: {
          ...buildCompareResult().content_diff!,
          source_count: 11,
          only_source_count: 3,
        },
      })
    );

    const user = await runInitialComparison();
    await openContentDetails(user);
    await openDetailsByLabel(user, "Source only (3)");

    expect(screen.getByText("Only 2 of 3 objects are visible in this section. Use the section counter for the total.")).toBeInTheDocument();
  });

  it("copies visible object keys from a content section", async () => {
    const user = await runInitialComparison();
    await openSourceOnlyDetails(user);

    const sourceOnlyDetails = closestDetails(await screen.findByText("Source only (2)"));
    await user.click(within(sourceOnlyDetails).getByRole("button", { name: "Copy visible keys" }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("source-only-1\nsource-only-2");
    });
    expect(await within(sourceOnlyDetails).findByText("Copied 2 visible keys to clipboard.")).toBeInTheDocument();
  });

  it("copies each visible different object key once", async () => {
    const user = await runInitialComparison();
    await openContentDetails(user);

    const differentDetails = closestDetails(await screen.findByText("Different objects (1)"));
    await user.click(within(differentDetails).getByRole("button", { name: "Copy visible keys" }));

    await waitFor(() => {
      expect(clipboardWriteTextMock).toHaveBeenCalledWith("different-1");
    });
  });

  it("greys out object explore buttons when Manager Browser is disabled", async () => {
    const user = userEvent.setup();
    render(
      <ManagerBucketCompareModal
        sourceContextId="ctx-source"
        sourceContextName="Source context"
        sourceBuckets={["bucket-a"]}
        contexts={contexts}
        managerBrowserEnabled={false}
        onClose={() => undefined}
      />
    );

    const [targetContextSelect] = screen.getAllByRole("combobox");
    await user.selectOptions(targetContextSelect, "ctx-target");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run comparison/i })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /run comparison/i }));

    await openSourceOnlyDetails(user);
    expect(await screen.findByText("source-only-1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Explore" })).not.toBeInTheDocument();
    const exploreButtons = screen.getAllByRole("button", { name: "Explore" });
    expect(exploreButtons.length).toBeGreaterThan(0);
    expect(exploreButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(exploreButtons[0]).toHaveAttribute("title", "Manager Browser is disabled for this surface.");
    const downloadButtons = screen.getAllByRole("button", { name: "Download" });
    expect(downloadButtons.length).toBeGreaterThan(0);
    expect(downloadButtons.every((button) => button.hasAttribute("disabled"))).toBe(true);
    expect(downloadButtons[0]).toHaveAttribute("title", "Manager Browser is disabled for this surface.");
  });

  it("marks a rejected comparison as failed and leaves the running state", async () => {
    compareManagerBucketPairMock.mockRejectedValueOnce({
      isAxiosError: true,
      message: "Request failed with status code 502",
      response: {
        data: {
          detail: "Unable to list objects in bucket 'bucket-a': ListObjectsV2 failed with AccessDenied",
        },
      },
    });

    const user = await runInitialComparison();

    await openResultDetails(user);
    expect(await screen.findByText("Unable to list objects in bucket 'bucket-a': ListObjectsV2 failed with AccessDenied")).toBeInTheDocument();
    expect(screen.getByText("Completed 1 / 1 mappings")).toBeInTheDocument();
    expect(screen.getByText(/Done: 0 \/ Failed: 1 \/ Cancelled: 0/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run comparison" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Comparing..." })).not.toBeInTheDocument();
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
    await openContentDetails(user);
    await user.click(await screen.findByRole("button", { name: "Re-run and sync all missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Running..." }).some((button) => button.hasAttribute("disabled"))).toBe(true);
    });
    resolveAction?.(buildActionResult());
    await waitFor(() => {
      expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an inline error message when action API fails", async () => {
    runManagerBucketCompareActionMock.mockRejectedValueOnce(new Error("boom"));

    const user = await runInitialComparison();
    await openContentDetails(user);
    await user.click(await screen.findByRole("button", { name: "Re-run and sync all missing" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/Action failed: boom/i)).toBeInTheDocument();
    expect(compareManagerBucketPairMock).toHaveBeenCalledTimes(1);
  });
});
