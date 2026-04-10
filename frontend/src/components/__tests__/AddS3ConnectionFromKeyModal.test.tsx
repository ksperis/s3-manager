import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AddS3ConnectionFromKeyModal from "../AddS3ConnectionFromKeyModal";
import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";

const createConnectionMock = vi.fn();
const listStorageEndpointsMock = vi.fn();

vi.mock("../../api/connections", () => ({
  createConnection: (payload: unknown) => createConnectionMock(payload),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
}));

describe("AddS3ConnectionFromKeyModal", () => {
  beforeEach(() => {
    createConnectionMock.mockReset();
    listStorageEndpointsMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes execution contexts after creating a private connection", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const refreshListener = vi.fn();
    createConnectionMock.mockResolvedValue({ id: 7 });
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        lockEndpoint
        accessKeyId="AKIA-EXAMPLE"
        secretAccessKey="SECRET-EXAMPLE"
        defaultName="private-connection"
        defaultEndpointUrl="https://s3.example.test"
        defaultAccessManager
        defaultAccessBrowser
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refreshListener).toHaveBeenCalledTimes(1));
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(refreshListener.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
    expect(createConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "private-connection",
        endpoint_url: "https://s3.example.test",
        access_key_id: "AKIA-EXAMPLE",
        secret_access_key: "SECRET-EXAMPLE",
        access_manager: true,
        access_browser: true,
      })
    );

    window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);
  });
});
