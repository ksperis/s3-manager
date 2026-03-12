import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ManagerCephKeysPage from "./ManagerCephKeysPage";

const useS3AccountContextMock = vi.fn();
const listManagerCephAccessKeysMock = vi.fn();
const createManagerCephAccessKeyMock = vi.fn();
const updateManagerCephAccessKeyStatusMock = vi.fn();
const deleteManagerCephAccessKeyMock = vi.fn();

vi.mock("./S3AccountContext", () => ({
  useS3AccountContext: () => useS3AccountContextMock(),
}));

vi.mock("../../api/managerCephKeys", () => ({
  listManagerCephAccessKeys: (...args: unknown[]) => listManagerCephAccessKeysMock(...args),
  createManagerCephAccessKey: (...args: unknown[]) => createManagerCephAccessKeyMock(...args),
  updateManagerCephAccessKeyStatus: (...args: unknown[]) => updateManagerCephAccessKeyStatusMock(...args),
  deleteManagerCephAccessKey: (...args: unknown[]) => deleteManagerCephAccessKeyMock(...args),
}));

vi.mock("../../utils/confirm", () => ({
  confirmAction: () => true,
}));

function buildContext(overrides?: Record<string, unknown>) {
  return {
    hasS3AccountContext: true,
    accountIdForApi: "s3u-11",
    selectedS3AccountType: "s3_user",
    managerCephKeysEnabled: true,
    accessMode: "s3_user",
    ...overrides,
  };
}

describe("ManagerCephKeysPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useS3AccountContextMock.mockReturnValue(buildContext());
    listManagerCephAccessKeysMock.mockResolvedValue([
      {
        access_key_id: "AK-PORTAL",
        status: "enabled",
        created_at: "2026-01-01T00:00:00Z",
        is_ui_managed: true,
        is_active: true,
      },
      {
        access_key_id: "AK-SECONDARY",
        status: "disabled",
        created_at: "2026-01-02T00:00:00Z",
        is_ui_managed: false,
        is_active: false,
      },
    ]);
    createManagerCephAccessKeyMock.mockResolvedValue({
      access_key_id: "AK-NEW",
      secret_access_key: "SK-NEW",
    });
    updateManagerCephAccessKeyStatusMock.mockResolvedValue({
      access_key_id: "AK-SECONDARY",
      status: "enabled",
      is_ui_managed: false,
      is_active: true,
    });
    deleteManagerCephAccessKeyMock.mockResolvedValue(undefined);
  });

  it("renders keys and locks actions for the portal key", async () => {
    render(<ManagerCephKeysPage />);

    expect(await screen.findByText("AK-PORTAL")).toBeInTheDocument();
    expect(screen.getByText("S3M")).toBeInTheDocument();

    const lockedButtons = screen.getAllByTitle("Portal key is locked");
    expect(lockedButtons).toHaveLength(2);
    expect(lockedButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((lockedButtons[0] as HTMLButtonElement).className).toContain("disabled:cursor-not-allowed");
    expect((lockedButtons[0] as HTMLButtonElement).className).toContain("disabled:text-slate-400");
    expect((lockedButtons[1] as HTMLButtonElement).className).toContain("disabled:cursor-not-allowed");
    expect((lockedButtons[1] as HTMLButtonElement).className).toContain("disabled:text-slate-400");
  });

  it("supports create, enable and delete for non-locked keys", async () => {
    const user = userEvent.setup();
    render(<ManagerCephKeysPage />);

    await screen.findByText("AK-SECONDARY");

    await user.click(screen.getByRole("button", { name: "New key" }));
    await waitFor(() => {
      expect(createManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11");
    });
    expect(await screen.findByText("AK-NEW")).toBeInTheDocument();
    expect(screen.getByText("SK-NEW")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Enable" }));
    await waitFor(() => {
      expect(updateManagerCephAccessKeyStatusMock).toHaveBeenCalledWith("s3u-11", "AK-SECONDARY", true);
    });

    const deleteButtons = screen.getAllByRole("button", { name: "Delete" }) as HTMLButtonElement[];
    const enabledDeleteButton = deleteButtons.find((button) => !button.disabled);
    expect(enabledDeleteButton).toBeDefined();
    if (!enabledDeleteButton) throw new Error("Expected an enabled delete button");

    await user.click(enabledDeleteButton);
    await waitFor(() => {
      expect(deleteManagerCephAccessKeyMock).toHaveBeenCalledWith("s3u-11", "AK-SECONDARY");
    });
  });
});
