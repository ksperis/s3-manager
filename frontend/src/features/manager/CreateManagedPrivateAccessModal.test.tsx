import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "jest-axe";

import { EXECUTION_CONTEXTS_REFRESH_EVENT } from "../../utils/executionContextRefresh";
import CreateManagedPrivateAccessModal from "./CreateManagedPrivateAccessModal";

const createIamMock = vi.fn();
const createRgwUserMock = vi.fn();
const fullAccessPolicyArn = "arn:aws:iam::aws:policy/AmazonS3FullAccess";

vi.mock("../../api/managedPrivateAccess", async () => {
  const actual = await vi.importActual<typeof import("../../api/managedPrivateAccess")>("../../api/managedPrivateAccess");
  return {
    ...actual,
    createManagedIAMPrivateAccess: (...args: unknown[]) => createIamMock(...args),
    createManagedRGWUserPrivateAccess: (...args: unknown[]) => createRgwUserMock(...args),
  };
});

describe("CreateManagedPrivateAccessModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createIamMock.mockResolvedValue({
      provisioning_id: 12,
      status: "active",
      connection: { id: 44, name: "Personal browser", server_managed: true },
    });
    createRgwUserMock.mockResolvedValue({
      provisioning_id: 13,
      status: "active",
      connection: { id: 45, name: "Personal RGW", server_managed: true },
    });
  });

  it("submits the compact IAM default with Browser and AmazonS3FullAccess", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    const refreshListener = vi.fn();
    window.addEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);

    render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        groups={[{ name: "readers" }]}
        policies={[{ name: "ReadOnly", arn: "arn:policy:readonly" }]}
        onClose={onClose}
        onCreated={onCreated}
      />
    );

    expect(screen.getByText(/dedicated IAM user with AmazonS3FullAccess/i)).toBeInTheDocument();
    expect(screen.getByText(/secret is stored only on the server/i)).toBeInTheDocument();
    expect(screen.getByText("Advanced configuration").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByLabelText(/IAM user/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/access key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/secret/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Connection name")).toHaveFocus());

    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal browser");
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createIamMock).toHaveBeenCalledWith("acc-7", {
        connection_name: "Personal browser",
        access_browser: true,
        access_manager: false,
        groups: [],
        managed_policies: [fullAccessPolicyArn],
        inline_policies: [],
      });
    });
    expect(refreshListener).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith("Personal browser");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/AKIA|secret_access_key/i)).not.toBeInTheDocument();
    window.removeEventListener(EXECUTION_CONTEXTS_REFRESH_EVENT, refreshListener);
  });

  it("allows the advanced IAM configuration to replace the default policy", async () => {
    const user = userEvent.setup();

    render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        groups={[{ name: "readers" }]}
        policies={[{ name: "ReadOnly", arn: "arn:policy:readonly" }]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal browser");
    await user.click(screen.getByText("Advanced configuration"));
    const fullAccess = screen.getByRole("checkbox", { name: "AmazonS3FullAccess" });
    expect(fullAccess).toBeChecked();
    await user.click(fullAccess);
    await user.click(screen.getByText("readers"));
    await user.click(screen.getByText("ReadOnly"));
    await user.type(screen.getByLabelText("Inline policy name"), "audit");
    await user.click(screen.getByRole("button", { name: "Add inline policy" }));
    await user.click(screen.getByRole("checkbox", { name: "Access manager" }));
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createIamMock).toHaveBeenCalledWith("acc-7", {
        connection_name: "Personal browser",
        access_browser: true,
        access_manager: true,
        groups: ["readers"],
        managed_policies: ["arn:policy:readonly"],
        inline_policies: [{ name: "audit", document: { Version: "2012-10-17", Statement: [] } }],
      });
    });
    expect(screen.getByText("Customized")).toBeInTheDocument();
  });

  it("keeps the RGW User payload limited to name and explicit workspace flags", async () => {
    const user = userEvent.setup();
    render(
      <CreateManagedPrivateAccessModal
        variant="rgw_user"
        accountId="s3u-9"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(screen.queryByText("IAM groups")).not.toBeInTheDocument();
    expect(screen.queryByText("Managed policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Inline policies")).not.toBeInTheDocument();
    expect(screen.getByText(/new access key for this RGW user/i)).toBeInTheDocument();
    expect(screen.getByText("Advanced configuration").closest("details")).not.toHaveAttribute("open");
    await user.clear(screen.getByLabelText("Connection name"));
    await user.type(screen.getByLabelText("Connection name"), "Personal RGW");
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    await waitFor(() => {
      expect(createRgwUserMock).toHaveBeenCalledWith("s3u-9", {
        connection_name: "Personal RGW",
        access_browser: true,
        access_manager: false,
      });
    });
  });

  it("keeps workspace validation inside the RGW advanced configuration", async () => {
    const user = userEvent.setup();
    render(
      <CreateManagedPrivateAccessModal
        variant="rgw_user"
        accountId="s3u-9"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    await user.click(screen.getByText("Advanced configuration"));
    await user.click(screen.getByRole("checkbox", { name: "Access browser" }));
    await user.click(screen.getByRole("button", { name: "Create my private access" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enable Browser, Manager, or both.");
    expect(createRgwUserMock).not.toHaveBeenCalled();
  });

  it("has no detectable accessibility violations in the compact IAM state", async () => {
    const { container } = render(
      <CreateManagedPrivateAccessModal
        variant="iam"
        accountId="acc-7"
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />
    );

    expect(await axe(container)).toHaveNoViolations();
  });
});
