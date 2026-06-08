import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerLifecyclesPage from "./ManagerLifecyclesPage";

const useS3AccountContextMock = vi.fn();
const listBucketLifecyclesMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/buckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/buckets")>("../../api/buckets");
  return {
    ...actual,
    listBucketLifecycles: (...args: unknown[]) => listBucketLifecyclesMock(...args),
  };
});

function renderPage() {
  render(
    <MemoryRouter>
      <ManagerLifecyclesPage />
    </MemoryRouter>
  );
}

describe("ManagerLifecyclesPage", () => {
  beforeEach(() => {
    useS3AccountContextMock.mockReset();
    listBucketLifecyclesMock.mockReset();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: null,
      requiresS3AccountSelection: true,
    });
    listBucketLifecyclesMock.mockResolvedValue([]);
  });

  it("shows an empty state when no manager context is selected", () => {
    renderPage();

    expect(screen.getByText("Select an account before reviewing lifecycles")).toBeInTheDocument();
    expect(listBucketLifecyclesMock).not.toHaveBeenCalled();
  });

  it("loads configured buckets and buckets without lifecycle rules", async () => {
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketLifecyclesMock.mockResolvedValue([
      {
        bucket_name: "logs",
        rules: [{ ID: "expire-logs", Status: "Enabled", Filter: { Prefix: "logs/" }, Expiration: { Days: 30 } }],
      },
      { bucket_name: "empty", rules: [] },
    ]);

    renderPage();

    await waitFor(() => expect(listBucketLifecyclesMock).toHaveBeenCalledWith("account-1"));
    expect(await screen.findByText("expire-logs")).toBeInTheDocument();
    expect(screen.getByText("Expire current objects after 30d")).toBeInTheDocument();
    expect(screen.getByText("No lifecycle rules configured")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "logs" })).toHaveAttribute("href", "/manager/buckets/logs");
  });

  it("filters lifecycle rows by status and search text", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketLifecyclesMock.mockResolvedValue([
      {
        bucket_name: "logs",
        rules: [{ ID: "expire-logs", Status: "Enabled", Filter: { Prefix: "logs/" }, Expiration: { Days: 30 } }],
      },
      { bucket_name: "empty", rules: [] },
    ]);

    renderPage();

    expect(await screen.findByText("expire-logs")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "no_rules");
    expect(screen.queryByText("expire-logs")).not.toBeInTheDocument();
    expect(screen.getByText("No lifecycle rules configured")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Status/i), "all");
    await user.type(screen.getByPlaceholderText("Bucket, rule, filter"), "logs/");
    expect(screen.getByText("expire-logs")).toBeInTheDocument();
    expect(screen.queryByText("No lifecycle rules configured")).not.toBeInTheDocument();
  });

  it("opens read-only JSON and links to bucket configuration", async () => {
    const user = userEvent.setup();
    useS3AccountContextMock.mockReturnValue({
      accountIdForApi: "account-1",
      requiresS3AccountSelection: false,
    });
    listBucketLifecyclesMock.mockResolvedValue([
      {
        bucket_name: "archive",
        rules: [{ ID: "transition-cold", Status: "Disabled", Transitions: [{ Days: 45, StorageClass: "GLACIER" }] }],
      },
    ]);

    renderPage();

    expect(await screen.findByText("transition-cold")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configure" })).toHaveAttribute("href", "/manager/buckets/archive");

    await user.click(screen.getByRole("button", { name: "View JSON" }));

    const dialog = await screen.findByRole("dialog", { name: "Lifecycle rule JSON · archive" });
    expect(within(dialog).getByText("transition-cold")).toBeInTheDocument();
    expect(within(dialog).getByText(/GLACIER/)).toBeInTheDocument();
  });
});
