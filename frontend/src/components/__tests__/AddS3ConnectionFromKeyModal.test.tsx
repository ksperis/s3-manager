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

    expect(screen.getByDisplayValue("private-connection")).toHaveClass("ui-control");
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

  it("asks before closing when connection fields changed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    listStorageEndpointsMock.mockResolvedValue([]);

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
      />
    );

    const nameInput = screen.getByDisplayValue("private-connection");
    await user.clear(nameInput);
    await user.type(nameInput, "changed-connection");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders local validation errors with the shared inline treatment", async () => {
    const user = userEvent.setup();
    listStorageEndpointsMock.mockResolvedValue([]);

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
        onClose={vi.fn()}
      />
    );

    await user.click(screen.getByLabelText("Access manager"));
    await user.click(screen.getByLabelText("Access browser"));
    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    expect(screen.getByText("Enable access to manager and/or browser.")).toHaveClass("border-rose-200");
    expect(createConnectionMock).not.toHaveBeenCalled();
  });

  it("creates a custom endpoint connection through shared endpoint fields", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    createConnectionMock.mockResolvedValue({ id: 8 });
    listStorageEndpointsMock.mockResolvedValue([]);

    render(
      <AddS3ConnectionFromKeyModal
        isOpen
        accessKeyId="AKIA-CUSTOM"
        secretAccessKey="SECRET-CUSTOM"
        defaultName="custom-connection"
        defaultAccessBrowser
        onClose={onClose}
      />
    );

    const endpointUrlInput = await screen.findByLabelText("Endpoint URL");
    expect(endpointUrlInput).toHaveClass("ui-control");
    expect(screen.getByRole("combobox", { name: "Provider" })).toHaveClass("ui-control");

    await user.type(endpointUrlInput, "https://minio.example.test");
    await user.selectOptions(screen.getByRole("combobox", { name: "Provider" }), "minio");
    await user.click(screen.getByLabelText("Force path style"));
    await user.click(screen.getByRole("button", { name: "Create private connection" }));

    await waitFor(() => expect(createConnectionMock).toHaveBeenCalledTimes(1));
    expect(createConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "custom-connection",
        endpoint_url: "https://minio.example.test",
        provider_hint: "minio",
        force_path_style: true,
        verify_tls: true,
        access_key_id: "AKIA-CUSTOM",
        secret_access_key: "SECRET-CUSTOM",
      })
    );
  });
});
