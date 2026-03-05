import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerMigrationWizardPage from "./ManagerMigrationWizardPage";

const listExecutionContextsMock = vi.fn();
const listBucketsMock = vi.fn();
const createManagerMigrationMock = vi.fn();
const runManagerMigrationPrecheckMock = vi.fn();

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
    listExecutionContextsMock.mockResolvedValue([
      { id: "src-ctx", display_name: "Source", endpoint_id: 1 },
      { id: "tgt-ctx", display_name: "Target", endpoint_id: 2 },
    ]);
    listBucketsMock.mockResolvedValue([{ name: "bucket-a" }]);
    createManagerMigrationMock.mockResolvedValue({ id: 77 });
    runManagerMigrationPrecheckMock.mockResolvedValue({ id: 77 });
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
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Summary")).toBeInTheDocument();
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
      copy_bucket_settings: true,
      delete_source: false,
      lock_target_writes: true,
      auto_grant_source_read_for_copy: true,
      webhook_url: undefined,
    });

    await waitFor(() => {
      expect(runManagerMigrationPrecheckMock).toHaveBeenCalledWith(77);
    });
    await screen.findByText("detail-77");
  });
});
