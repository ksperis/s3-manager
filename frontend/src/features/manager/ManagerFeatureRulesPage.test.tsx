import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerFeatureRulesPage from "./ManagerFeatureRulesPage";

const useS3AccountContextMock = vi.fn();
const listFeatureRuleInventoryMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerBuckets", async () => {
  const actual = await vi.importActual<typeof import("../../api/managerBuckets")>("../../api/managerBuckets");
  return {
    ...actual,
    listFeatureRuleInventory: (...args: unknown[]) => listFeatureRuleInventoryMock(...args),
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ManagerFeatureRulesPage />
    </MemoryRouter>
  );
}

describe("ManagerFeatureRulesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue({
      accounts: [
        {
          id: "account-1",
          display_name: "Account Alpha",
          storage_endpoint_capabilities: { sns: true },
        },
      ],
      selectedS3AccountId: "account-1",
      requiresS3AccountSelection: false,
      accountIdForApi: "account-1",
    });
    listFeatureRuleInventoryMock.mockResolvedValue([]);
  });

  it("loads and renders bucket rule sub-rows for the selected feature", async () => {
    listFeatureRuleInventoryMock.mockResolvedValue([
      {
        bucket_name: "logs-prod",
        feature: "lifecycle",
        status: "configured",
        rules: [
          {
            id: "expire-logs",
            type: "lifecycle",
            title: "expire-logs",
            summary: "Prefix: logs/ · expire current after 30d",
            chips: ["Enabled", "Prefix: logs/"],
            raw: { ID: "expire-logs", Expiration: { Days: 30 } },
          },
        ],
      },
      {
        bucket_name: "archive",
        feature: "lifecycle",
        status: "empty",
        rules: [],
      },
    ]);

    renderPage();

    await waitFor(() => expect(listFeatureRuleInventoryMock).toHaveBeenCalledWith("account-1", "lifecycle"));
    expect(screen.getByLabelText("Search")).toHaveAttribute("type", "search");
    expect(screen.getByLabelText("Search")).toHaveAttribute("placeholder", "Bucket, rule, tag");
    expect(screen.getByRole("combobox", { name: "Feature" })).toHaveValue("lifecycle");
    expect(screen.getByText("logs-prod")).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveClass("manager-table");
    expect(screen.getByRole("columnheader", { name: "JSON" })).toHaveClass("text-right");
    expect(screen.getByText("expire-logs")).toBeInTheDocument();
    expect(screen.getByText("Prefix: logs/ · expire current after 30d")).toBeInTheDocument();
    expect(screen.getByText("archive")).toBeInTheDocument();
    expect(screen.getAllByText("No rules").length).toBeGreaterThan(0);
  });

  it("reloads the API when the feature selector changes", async () => {
    listFeatureRuleInventoryMock.mockResolvedValue([]);

    renderPage();

    await waitFor(() => expect(listFeatureRuleInventoryMock).toHaveBeenCalledWith("account-1", "lifecycle"));
    fireEvent.change(screen.getByLabelText("Feature"), { target: { value: "policy" } });

    await waitFor(() => expect(listFeatureRuleInventoryMock).toHaveBeenCalledWith("account-1", "policy"));
  });

  it("renders bucket tags with tag-specific labels", async () => {
    listFeatureRuleInventoryMock.mockImplementation((_accountId: unknown, feature: unknown) =>
      Promise.resolve(
        feature === "tags"
          ? [
              {
                bucket_name: "logs-prod",
                feature: "tags",
                status: "configured",
                rules: [
                  {
                    id: "environment",
                    type: "tag",
                    title: "environment",
                    summary: "prod",
                    chips: [],
                    raw: { key: "environment", value: "prod" },
                  },
                ],
              },
              {
                bucket_name: "archive",
                feature: "tags",
                status: "empty",
                rules: [],
              },
            ]
          : []
      )
    );

    renderPage();

    await waitFor(() => expect(listFeatureRuleInventoryMock).toHaveBeenCalledWith("account-1", "lifecycle"));
    fireEvent.change(screen.getByLabelText("Feature"), { target: { value: "tags" } });

    await waitFor(() => expect(listFeatureRuleInventoryMock).toHaveBeenCalledWith("account-1", "tags"));
    expect(screen.getByRole("columnheader", { name: "Tag" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Value" })).toBeInTheDocument();
    expect(screen.getByText("1 tag(s)")).toBeInTheDocument();
    expect(screen.getByText("environment")).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("No tags")).toBeInTheDocument();
  });

  it("opens the raw rule JSON in a modal", async () => {
    listFeatureRuleInventoryMock.mockResolvedValue([
      {
        bucket_name: "logs-prod",
        feature: "lifecycle",
        status: "configured",
        rules: [
          {
            id: "expire-logs",
            type: "lifecycle",
            title: "expire-logs",
            summary: "expire current after 30d",
            chips: ["Enabled"],
            raw: { ID: "expire-logs", Expiration: { Days: 30 } },
          },
        ],
      },
    ]);

    renderPage();

    const row = await screen.findByText("expire-logs");
    const table = row.closest("table");
    expect(table).not.toBeNull();
    const jsonButton = within(table as HTMLTableElement).getByRole("button", { name: "JSON" });
    expect(jsonButton).toHaveClass("rounded-full");
    fireEvent.click(jsonButton);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/"ID": "expire-logs"/)).toBeInTheDocument();
    expect(screen.getByText(/"Days": 30/)).toBeInTheDocument();
  });

  it("filters buckets by status", async () => {
    listFeatureRuleInventoryMock.mockResolvedValue([
      {
        bucket_name: "logs-prod",
        feature: "lifecycle",
        status: "configured",
        rules: [{ id: "rule-1", type: "lifecycle", title: "rule-1", summary: "configured", chips: [], raw: {} }],
      },
      {
        bucket_name: "broken",
        feature: "lifecycle",
        status: "unavailable",
        error: "AccessDenied",
        rules: [],
      },
    ]);

    renderPage();

    expect(await screen.findByText("logs-prod")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search"), { target: { value: "broken" } });

    expect(screen.queryByText("logs-prod")).not.toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();

    const statusGroup = screen.getByRole("group", { name: "Status" });
    expect(within(statusGroup).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(statusGroup).getByRole("button", { name: "Unavailable" }));

    expect(screen.queryByText("logs-prod")).not.toBeInTheDocument();
    expect(screen.getByText("broken")).toBeInTheDocument();
    expect(within(statusGroup).getByRole("button", { name: "Unavailable" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("AccessDenied").length).toBeGreaterThan(0);
  });
});
