import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerBucketPoliciesPage from "./ManagerBucketPoliciesPage";

const useS3AccountContextMock = vi.fn();
const listBucketPoliciesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBucketPolicies: (...args: unknown[]) => listBucketPoliciesMock(...args),
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <ManagerBucketPoliciesPage />
    </MemoryRouter>
  );
}

describe("ManagerBucketPoliciesPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listBucketPoliciesMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: null,
      requiresS3AccountSelection: true,
    });
    listBucketPoliciesMock.mockResolvedValue([]);
  });

  it("shows an empty state when no manager context is selected", () => {
    renderPage();

    expect(screen.getByText("Select an account before reviewing bucket policies")).toBeInTheDocument();
    expect(listBucketPoliciesMock).not.toHaveBeenCalled();
  });

  it("loads configured buckets and buckets without bucket policy", async () => {
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketPoliciesMock.mockResolvedValue([
      {
        bucket_name: "logs",
        policy: {
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "ReadLogs",
              Effect: "Allow",
              Principal: { AWS: "arn:aws:iam::123:user/alice" },
              Action: ["s3:GetObject"],
              Resource: "arn:aws:s3:::logs/*",
            },
          ],
        },
      },
      { bucket_name: "empty", policy: null },
    ]);

    renderPage();

    await waitFor(() => expect(listBucketPoliciesMock).toHaveBeenCalledWith("account-1"));
    expect(await screen.findByText("ReadLogs")).toBeInTheDocument();
    expect(screen.getByText("Action: s3:GetObject · Resource: arn:aws:s3:::logs/*")).toBeInTheDocument();
    expect(screen.getByText("No bucket policy configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "logs" })).toHaveAttribute("href", "/manager/buckets/logs");
  });

  it("filters bucket policy rows by status and search text", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketPoliciesMock.mockResolvedValue([
      {
        bucket_name: "logs",
        policy: {
          Statement: [{ Sid: "ReadLogs", Effect: "Allow", Principal: "*", Action: ["s3:GetObject"] }],
        },
      },
      { bucket_name: "empty", policy: null },
    ]);

    renderPage();

    expect(await screen.findByText("ReadLogs")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "no_policy");
    expect(screen.queryByText("ReadLogs")).not.toBeInTheDocument();
    expect(screen.getByText("No bucket policy configured")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "all");
    await user.type(screen.getByPlaceholderText("Bucket, statement, action"), "GetObject");
    expect(screen.getByText("ReadLogs")).toBeInTheDocument();
    expect(screen.queryByText("No bucket policy configured")).not.toBeInTheDocument();
  });

  it("opens read-only JSON and links to bucket configuration", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketPoliciesMock.mockResolvedValue([
      {
        bucket_name: "archive",
        policy: {
          Version: "2012-10-17",
          Statement: [{ Sid: "DenyDelete", Effect: "Deny", Principal: "*", Action: "s3:DeleteObject" }],
        },
      },
    ]);

    renderPage();

    expect(await screen.findByText("DenyDelete")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/manager/buckets/archive");

    await user.click(screen.getByRole("button", { name: "View JSON" }));

    const dialog = await screen.findByRole("dialog", { name: "Bucket policy JSON · archive" });
    expect(within(dialog).getByText("DenyDelete")).toBeInTheDocument();
    expect(within(dialog).getByText(/DeleteObject/)).toBeInTheDocument();
  });
});
