import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PortalBucketsPage from "./PortalBucketsPage";

const tMock = (text: { en: string }) => text.en;

vi.mock("../../i18n", () => ({
  useI18n: () => ({
    language: "en",
    t: tMock,
  }),
}));

vi.mock("./PortalAccountContext", () => ({
  usePortalAccountContext: () => ({
    accountIdForApi: null,
    selectedAccount: null,
    hasAccountContext: false,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/portal", () => ({
  createPortalBucket: vi.fn(),
  deletePortalBucket: vi.fn(),
  fetchPortalState: vi.fn(),
  fetchPortalBucketStats: vi.fn(),
  grantPortalUserBucket: vi.fn(),
  listPortalBuckets: vi.fn(),
  listPortalBucketUsers: vi.fn(),
  listPortalUsers: vi.fn(),
  revokePortalUserBucket: vi.fn(),
}));

describe("PortalBucketsPage list section", () => {
  it("keeps the list header visible without account context and renders status in tbody", () => {
    render(<PortalBucketsPage />);

    expect(screen.getAllByText("Buckets").length).toBeGreaterThanOrEqual(2);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Select an account before displaying buckets.")).toBeInTheDocument();
  });
});
