import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationWizardPage from "./ManagerMigrationWizardPage";

const listExecutionContextsMock = vi.fn();
const listBucketsMock = vi.fn();
const createManagerMigrationMock = vi.fn();
const runManagerMigrationPrecheckMock = vi.fn();
const startManagerMigrationMock = vi.fn();

vi.mock("../../../api/executionContexts", () => ({
  listExecutionContexts: (...args: unknown[]) => listExecutionContextsMock(...args),
}));

vi.mock("../../../api/buckets", () => ({
  listBuckets: (...args: unknown[]) => listBucketsMock(...args),
}));

vi.mock("../../../api/managerMigrations", async () => {
  const actual = await vi.importActual("../../../api/managerMigrations");
  return {
    ...actual,
    createManagerMigration: (...args: unknown[]) => createManagerMigrationMock(...args),
    updateManagerMigration: vi.fn(),
    getManagerMigration: vi.fn(),
    runManagerMigrationPrecheck: (...args: unknown[]) => runManagerMigrationPrecheckMock(...args),
    startManagerMigration: (...args: unknown[]) => startManagerMigrationMock(...args),
  };
});

vi.mock("../S3AccountContext", () => ({
  useS3AccountContext: () => ({
    selectedS3AccountId: "src-ctx",
  }),
}));

function DestinationProbe() {
  const params = useParams<{ migrationId: string }>();
  return <p>detail-{params.migrationId}</p>;
}

describe("ManagerMigrationWizardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", kind: "account", manager_account_is_admin: true, display_name: "Source", endpoint_id: 1 },
      { id: "tgt-ctx", kind: "account", manager_account_is_admin: true, display_name: "Target", endpoint_id: 2 },
    ]);
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }]);
    createManagerMigrationMock.mockResolvedValue({ id: 77 });
    runManagerMigrationPrecheckMock.mockResolvedValue({ id: 77, precheck_status: "passed", precheck_report: { errors: 0 } });
    startManagerMigrationMock.mockResolvedValue({ id: 77, status: "queued", message: "started" });
  });

  it("validates wizard steps and submits expected payload", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Target is required.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("checkbox", { name: "bucket-a" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Target prefix/suffix mapping")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Prefix"), "mig-");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Strategy")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show" }));
    const sameEndpointCopyOption = screen.getByRole("checkbox", { name: "Use x-amz-copy-source (same endpoint only)" });
    const autoGrantOption = screen.getByRole("checkbox", {
      name: "Auto-grant temporary source read for same-endpoint copy",
    });
    expect(sameEndpointCopyOption).toBeDisabled();
    expect(sameEndpointCopyOption).not.toBeChecked();
    expect(autoGrantOption).toBeDisabled();
    expect(autoGrantOption).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("Operations plan")).toBeInTheDocument();
    expect(screen.getByText("bucket-a -> mig-bucket-a")).toBeInTheDocument();
    expect(screen.getByText(/Use stream copy \(GetObject \+ upload\) for object replication\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create migration" }));

    await waitFor(() => {
      expect(createManagerMigrationMock).toHaveBeenCalledTimes(1);
    });

    expect(createManagerMigrationMock).toHaveBeenCalledWith({
      source_context_id: "src-ctx",
      target_context_id: "tgt-ctx",
      buckets: [{ source_bucket: "bucket-a", target_bucket: undefined }],
      mapping_prefix: "mig-",
      mode: "one_shot",
      copy_bucket_settings: false,
      delete_source: true,
      strong_integrity_check: false,
      lock_target_writes: true,
      use_same_endpoint_copy: false,
      auto_grant_source_read_for_copy: false,
      webhook_url: undefined,
    });

    await waitFor(() => {
      expect(runManagerMigrationPrecheckMock).toHaveBeenCalledWith(77);
    });
    await waitFor(() => {
      expect(startManagerMigrationMock).toHaveBeenCalledWith(77);
    });
    await screen.findByText("detail-77");
  });

  it("supports filtering source buckets and selecting filtered results", async () => {
    const user = userEvent.setup();
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }, { name: "logs-prod" }, { name: "archive-prod" }]);

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    await user.type(screen.getByPlaceholderText("Filter source buckets"), "prod");
    expect(screen.getByRole("checkbox", { name: "logs-prod" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "archive-prod" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "bucket-a" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Select filtered" }));
    expect(screen.getByText("2 selected / 3")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Target prefix/suffix mapping")).toBeInTheDocument();
    expect(screen.getByText("logs-prod")).toBeInTheDocument();
    expect(screen.getByText("archive-prod")).toBeInTheDocument();
    expect(screen.queryByText("bucket-a")).not.toBeInTheDocument();
  });

  it("enables x-amz-copy-source on same endpoint and auto-enables auto-grant", async () => {
    const user = userEvent.setup();
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", kind: "account", manager_account_is_admin: true, display_name: "Source", endpoint_id: 1 },
      { id: "tgt-ctx", kind: "account", manager_account_is_admin: true, display_name: "Target", endpoint_id: 1 },
    ]);

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("checkbox", { name: "bucket-a" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Show" }));
    const sameEndpointCopyOption = screen.getByRole("checkbox", { name: "Use x-amz-copy-source (same endpoint only)" });
    const autoGrantOption = screen.getByRole("checkbox", {
      name: "Auto-grant temporary source read for same-endpoint copy",
    });
    expect(sameEndpointCopyOption).toBeEnabled();
    expect(sameEndpointCopyOption).not.toBeChecked();
    expect(autoGrantOption).toBeDisabled();
    expect(autoGrantOption).not.toBeChecked();

    await user.click(sameEndpointCopyOption);
    expect(sameEndpointCopyOption).toBeChecked();
    expect(autoGrantOption).toBeEnabled();
    expect(autoGrantOption).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create migration" }));

    await waitFor(() => {
      expect(createManagerMigrationMock).toHaveBeenCalledTimes(1);
    });
    expect(createManagerMigrationMock).toHaveBeenCalledWith({
      source_context_id: "src-ctx",
      target_context_id: "tgt-ctx",
      buckets: [{ source_bucket: "bucket-a", target_bucket: undefined }],
      mapping_prefix: "",
      mode: "one_shot",
      copy_bucket_settings: false,
      delete_source: true,
      strong_integrity_check: false,
      lock_target_writes: true,
      use_same_endpoint_copy: true,
      auto_grant_source_read_for_copy: true,
      webhook_url: undefined,
    });
    await waitFor(() => {
      expect(startManagerMigrationMock).toHaveBeenCalledWith(77);
    });
  });

  it("does not auto-start migration when precheck reports errors", async () => {
    const user = userEvent.setup();
    runManagerMigrationPrecheckMock.mockResolvedValue({
      id: 77,
      precheck_status: "failed",
      precheck_report: { errors: 1 },
    });

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("checkbox", { name: "bucket-a" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    await user.click(screen.getByRole("button", { name: "Create migration" }));

    await waitFor(() => {
      expect(runManagerMigrationPrecheckMock).toHaveBeenCalledWith(77);
    });
    expect(startManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("does not auto-start migration when precheck is still pending", async () => {
    const user = userEvent.setup();
    runManagerMigrationPrecheckMock.mockResolvedValue({
      id: 77,
      precheck_status: "pending",
      precheck_report: { errors: 0 },
    });

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("checkbox", { name: "bucket-a" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Create migration" }));

    await waitFor(() => {
      expect(runManagerMigrationPrecheckMock).toHaveBeenCalledWith(77);
    });
    expect(startManagerMigrationMock).not.toHaveBeenCalled();
  });

  it("filters non-admin account targets while keeping non-account contexts", async () => {
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", kind: "account", manager_account_is_admin: true, display_name: "Source", endpoint_id: 1 },
      { id: "acct-non-admin", kind: "account", manager_account_is_admin: false, display_name: "Account portal", endpoint_id: 2 },
      { id: "acct-admin", kind: "account", manager_account_is_admin: true, display_name: "Account admin", endpoint_id: 3 },
      { id: "conn-7", kind: "connection", display_name: "Shared connection", endpoint_id: null },
    ]);

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    const targetSelect = screen.getByLabelText("Target");
    expect(screen.queryByRole("option", { name: /Account portal/ })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Account admin/ })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Shared connection/ })).toBeInTheDocument();
    expect(targetSelect).toBeInTheDocument();
  });

  it("blocks cross-account account migration when one side is non-admin", async () => {
    const user = userEvent.setup();
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", kind: "account", manager_account_is_admin: false, display_name: "Source", endpoint_id: 1 },
      { id: "tgt-ctx", kind: "account", manager_account_is_admin: true, display_name: "Target", endpoint_id: 2 },
    ]);

    render(
      <MemoryRouter initialEntries={["/manager/migrations/new"]}>
        <Routes>
          <Route path="/manager/migrations/new" element={<ManagerMigrationWizardPage />} />
          <Route path="/manager/migrations/:migrationId" element={<DestinationProbe />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText("New migration");
    await user.selectOptions(screen.getByLabelText("Target"), "tgt-ctx");
    await user.click(screen.getByRole("checkbox", { name: "bucket-a" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(
      screen.getByText("Cross-account migrations require admin access on both source and target account contexts.")
    ).toBeInTheDocument();
  });
});
