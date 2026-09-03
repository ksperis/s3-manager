import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CephAdminBucketCompareResult,
  PaginatedCephAdminBucketsResponse,
} from "../../api/cephAdmin";
import type { CephAdminEndpoint } from "../../api/cephAdminEndpoints";
import CephAdminBucketCompareModal from "./CephAdminBucketCompareModal";

const listCephAdminBucketsMock = vi.fn<(...args: unknown[]) => Promise<PaginatedCephAdminBucketsResponse>>();
const compareCephAdminBucketPairMock = vi.fn();

vi.mock("../../api/cephAdmin", async () => {
  const actual = await vi.importActual<typeof import("../../api/cephAdmin")>("../../api/cephAdmin");
  return {
    ...actual,
    listCephAdminBuckets: (...args: unknown[]) => listCephAdminBucketsMock(...args),
    compareCephAdminBucketPair: (...args: unknown[]) => compareCephAdminBucketPairMock(...args),
  };
});

const endpoints: CephAdminEndpoint[] = [
  {
    id: 2,
    name: "Target endpoint",
    endpoint_url: "https://rgw.example.test",
    is_default: false,
    tags: [],
  },
];

function buildCompareResult(): CephAdminBucketCompareResult {
  return {
    source_endpoint_id: 1,
    target_endpoint_id: 2,
    source_bucket: "bucket-a",
    target_bucket: "bucket-a",
    has_differences: true,
    content_diff: {
      source_count: 4,
      target_count: 1,
      matched_count: 1,
      different_count: 0,
      only_source_count: 3,
      only_target_count: 0,
      display_limit: 1,
      only_source_hidden_count: 2,
      only_source_sample: ["source-only-1"],
      only_target_sample: [],
      only_source_details: [{ key: "source-only-1", size: 1024 }],
      only_target_details: [],
      different_sample: [],
    },
    config_diff: null,
  };
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

describe("CephAdminBucketCompareModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCephAdminBucketsMock.mockResolvedValue({
      items: [{ name: "bucket-a" }],
      total: 1,
      page: 1,
      page_size: 200,
      has_next: false,
    });
    compareCephAdminBucketPairMock.mockResolvedValue(buildCompareResult());
  });

  it("runs comparison with a display-limited diff and exposes visible section keys", async () => {
    const user = userEvent.setup();
    render(
      <CephAdminBucketCompareModal
        sourceEndpointId={1}
        sourceEndpointName="Source endpoint"
        sourceBuckets={["bucket-a"]}
        endpoints={endpoints}
        onClose={() => undefined}
      />
    );

    const targetEndpointSelect = screen.getByLabelText("Target endpoint");
    expect(screen.getByLabelText("Mapping mode")).toBeInTheDocument();
    await user.selectOptions(targetEndpointSelect, "2");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /run comparison/i })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: /run comparison/i }));

    await waitFor(() => {
      expect(compareCephAdminBucketPairMock).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole("progressbar", { name: "Bucket comparison progress" })).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
    expect(screen.getByRole("progressbar", { name: "Comparison progress for bucket-a to bucket-a" })).toHaveAttribute(
      "aria-valuenow",
      "100"
    );
    expect(compareCephAdminBucketPairMock).toHaveBeenCalledWith(
      1,
      {
        target_endpoint_id: 2,
        source_bucket: "bucket-a",
        target_bucket: "bucket-a",
        include_content: true,
        include_config: false,
        config_features: undefined,
        ignore_modified_after: null,
      },
      expect.anything()
    );

    await openDetailsByLabel(user, /bucket-a\s*→\s*bucket-a/i);
    await openDetailsByLabel(user, "Content diff (md5 or size)");
    const sourceOnlyDetails = await openDetailsByLabel(user, "Source only (3)");

    expect(within(sourceOnlyDetails).getAllByText(/Showing 1 of 3/i).length).toBeGreaterThan(0);
    expect(within(sourceOnlyDetails).getByRole("button", { name: "Copy keys" })).toBeInTheDocument();
    expect(within(sourceOnlyDetails).getByText("source-only-1")).toBeInTheDocument();
    expect(within(sourceOnlyDetails).queryByText("1.0 KB")).not.toBeInTheDocument();

    await user.click(within(sourceOnlyDetails).getByRole("button", { name: /source-only-1/ }));
    expect(within(sourceOnlyDetails).getByText("1.0 KB")).toBeInTheDocument();
  });
});
