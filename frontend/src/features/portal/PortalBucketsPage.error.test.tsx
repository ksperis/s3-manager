import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PortalBucketsPage from "./PortalBucketsPage";

const listPortalBucketsMock = vi.fn();
const fetchPortalStateMock = vi.fn();
const tMock = (text: { en: string }) => text.en;

const portalAccountContextState = {
  accountIdForApi: 1,
  selectedAccount: { id: 1, name: "Account 1" },
  hasAccountContext: true,
  loading: false,
  error: null,
};

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    language: "en",
    t: tMock,
  }),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => portalAccountContextState,
}));

vi.mock("../../api/portal", () => ({
  createPortalBucket: vi.fn(),
  deletePortalBucket: vi.fn(),
  fetchPortalBucketStats: vi.fn(),
  fetchPortalState: (...args: unknown[]) => fetchPortalStateMock(...args),
  grantPortalUserBucket: vi.fn(),
  listPortalBuckets: (...args: unknown[]) => listPortalBucketsMock(...args),
  listPortalBucketUsers: vi.fn(),
  listPortalUsers: vi.fn(),
  revokePortalUserBucket: vi.fn(),
}));

describe("PortalBucketsPage error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPortalStateMock.mockResolvedValue({
      can_manage_buckets: true,
      account_role: "portal_manager",
      buckets: [],
    });
  });

  it("shows backend detail when bucket list loading fails with detail", async () => {
    listPortalBucketsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: "Forbidden by policy" } },
      message: "Request failed with status code 403",
    });

    render(<PortalBucketsPage />);

    expect(await screen.findByText("Forbidden by policy")).toBeInTheDocument();
  });

  it("falls back to error.message when bucket list loading fails without detail", async () => {
    listPortalBucketsMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: {} },
      message: "Network Error",
    });

    render(<PortalBucketsPage />);

    expect(await screen.findByText("Network Error")).toBeInTheDocument();
  });
});
