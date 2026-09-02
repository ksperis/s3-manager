import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import S3UsersPage from "./S3UsersPage";
import { setSessionUserCache } from "../../utils/workspaces";

const listS3UsersMock = vi.fn();
const getS3UserMock = vi.fn();
const getS3UserWithBucketsMock = vi.fn();
const updateS3UserMock = vi.fn();
const createS3UserMock = vi.fn();
const importS3UsersMock = vi.fn();
const deleteS3UserMock = vi.fn();

const listStorageEndpointsMock = vi.fn();
const getStorageEndpointMock = vi.fn();
const listMinimalUsersMock = vi.fn();
const listMinimalGroupsMock = vi.fn();
const listAdminTagDefinitionsMock = vi.fn();

const makeTag = (id: number, label: string, color_key = "neutral", scope = "standard") => ({
  id,
  label,
  color_key,
  scope,
});

vi.mock("./useAdminS3UserStats", () => ({
  useAdminS3UserStats: () => ({
    stats: null,
    loading: false,
    error: null,
  }),
}));

vi.mock("../../api/s3Users", () => ({
  listS3Users: (params?: unknown) => listS3UsersMock(params),
  getS3User: (userId: number, options?: unknown) => getS3UserMock(userId, options),
  getS3UserWithBuckets: (userId: number) => getS3UserWithBucketsMock(userId),
  updateS3User: (userId: number, payload: unknown) => updateS3UserMock(userId, payload),
  createS3User: (payload: unknown) => createS3UserMock(payload),
  importS3Users: (payload: unknown) => importS3UsersMock(payload),
  deleteS3User: (userId: number, options?: unknown) => deleteS3UserMock(userId, options),
}));

vi.mock("../../api/storageEndpoints", () => ({
  listStorageEndpoints: () => listStorageEndpointsMock(),
  getStorageEndpoint: (endpointId: number, options?: unknown) => getStorageEndpointMock(endpointId, options),
}));

vi.mock("../../api/users", () => ({
  listMinimalUsers: () => listMinimalUsersMock(),
}));

vi.mock("../../api/groups", () => ({
  listMinimalGroups: () => listMinimalGroupsMock(),
}));

vi.mock("../../api/tags", () => ({
  listAdminTagDefinitions: (domain: unknown) => listAdminTagDefinitionsMock(domain),
  listPrivateConnectionTagDefinitions: vi.fn(),
}));

describe("S3UsersPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    setSessionUserCache({ id: 1, role: "ui_superadmin" });

    listS3UsersMock.mockResolvedValue({
      items: [
        {
          id: 5,
          name: "rgw-user-1",
          rgw_user_uid: "rgw-uid-1",
          tags: [makeTag(601, "legacy")],
          email: "rgw-user-1@example.com",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          quota_max_size_gb: 1,
          quota_max_objects: 100,
          bucket_count: 0,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    listStorageEndpointsMock.mockResolvedValue([
      {
        id: 10,
        name: "ceph-main",
        provider: "ceph",
        is_default: true,
        capabilities: {
          admin: true,
        },
      },
    ]);

    getStorageEndpointMock.mockResolvedValue({
      id: 10,
      name: "ceph-main",
      provider: "ceph",
      is_default: true,
      capabilities: {
        admin: true,
      },
      admin_ops_permissions: {
        users_write: true,
      },
    });

    listMinimalUsersMock.mockResolvedValue([{ id: 33, email: "ui33@example.com" }]);
    listMinimalGroupsMock.mockResolvedValue([{ id: 31, name: "Storage Group" }]);
    listAdminTagDefinitionsMock.mockResolvedValue([makeTag(601, "legacy"), makeTag(602, "prod")]);

    getS3UserMock.mockResolvedValue({
      id: 5,
      tags: [makeTag(601, "legacy")],
      quota_max_size_gb: 1,
      quota_max_objects: 100,
    });

    getS3UserWithBucketsMock.mockResolvedValue({ id: 5, bucket_count: 0 });
    updateS3UserMock.mockResolvedValue(undefined);
    createS3UserMock.mockResolvedValue(undefined);
    importS3UsersMock.mockResolvedValue(undefined);
    deleteS3UserMock.mockResolvedValue(undefined);
  });

  it("shows the compact empty state when no RGW users exist", async () => {
    listS3UsersMock.mockResolvedValueOnce({
      items: [],
      total: 0,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByText("No users.")).toBeInTheDocument();
    expect(screen.getByText("Manage standalone RGW users for direct access to Manager.")).toBeInTheDocument();
    expect(screen.queryByText("Import or create standalone RGW users to expose them to managers.")).not.toBeInTheDocument();
  });

  it("presents user identity and quotas in consistent General sections", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    expect(screen.queryByRole("button", { name: "rgw-user-1" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const generalPanel = await screen.findByRole("tabpanel", { name: "General" });
    expect(
      screen.getByText("Manage quotas, UI associations, and privileged access for this RGW user.")
    ).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "User details" })).toBeInTheDocument();
    expect(within(generalPanel).getByRole("heading", { name: "Quotas" })).toBeInTheDocument();
    expect(within(generalPanel).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(generalPanel).getByLabelText("Object quota")).toHaveClass("ui-control");
    expect(within(generalPanel).queryByLabelText("Ceph endpoint (locked)")).not.toBeInTheDocument();
    expect(within(generalPanel).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getAllByText("UID").some((node) => node.tagName === "DT")).toBe(true);
  });

  it("renders direct UI users and UI groups in the combined listing column", async () => {
    listS3UsersMock.mockResolvedValueOnce({
      items: [
        {
          id: 5,
          name: "rgw-user-1",
          rgw_user_uid: "rgw-uid-1",
          tags: [],
          email: "rgw-user-1@example.com",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_links: [{ user_id: 33, user_email: "ui33@example.com" }],
          group_links: [{ group_id: 31, group_name: "Storage Group" }],
          quota_max_size_gb: 1,
          quota_max_objects: 100,
          bucket_count: 0,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
      has_next: false,
    });

    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    expect(await screen.findByRole("columnheader", { name: "UI Users / Groups" })).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("responsive-data-table");
    const userName = await within(table).findByText("rgw-user-1");
    expect(userName.closest("td")).toHaveAttribute("data-mobile-primary", "true");
    expect(within(table).getByText("rgw-uid-1").closest("td")).toHaveAttribute("data-label", "UID");
    expect(within(table).getByText("ceph-main").closest("td")).toHaveAttribute("data-label", "Endpoint");
    const associations = await screen.findByLabelText("2 linked principals");
    await waitFor(() => {
      expect(associations).toHaveAccessibleDescription(
        "Linked principals (2)\nUI user: ui33@example.com\nUI group: Storage Group",
      );
    });
    expect(associations).toBeInTheDocument();
    expect(associations.querySelector(".rounded-lg")).toBeInTheDocument();
    expect(associations.closest("td")).toHaveAttribute("data-label", "UI Users / Groups");
    expect(within(table).getByRole("link", { name: "Keys" }).closest("td")).toHaveAttribute("data-mobile-actions", "true");
  });

  it("requests default sorting and toggles RGW user table headers", async () => {
    listS3UsersMock.mockResolvedValue({
      items: [
        {
          id: 5,
          name: "rgw-user-1",
          rgw_user_uid: "rgw-uid-1",
          tags: [],
          email: "rgw-user-1@example.com",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          quota_max_size_gb: 1,
          quota_max_objects: 100,
          bucket_count: 0,
        },
      ],
      total: 30,
      page: 1,
      page_size: 25,
      has_next: true,
    });

    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    await waitFor(() => {
      expect(listS3UsersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 1,
          sort_by: "name",
          sort_dir: "asc",
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(listS3UsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
          sort_by: "name",
          sort_dir: "asc",
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /Name/ }));

    await waitFor(() => {
      expect(listS3UsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          sort_by: "name",
          sort_dir: "desc",
        })
      );
    });

    fireEvent.click(screen.getByRole("button", { name: /UID/ }));

    await waitFor(() => {
      expect(listS3UsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 1,
          sort_by: "uid",
          sort_dir: "desc",
        })
      );
    });
  });

  it("keeps Linked UI users changes across tabs and submits canonical user links", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add a tag for this RGW user" })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI users" }));

    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "ui33@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Linked UI users" }));

    expect(screen.getByText("ui33@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3UserMock).toHaveBeenCalled();
    });

    const lastCall = updateS3UserMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(5);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        tags: [expect.objectContaining({ label: "legacy", color_key: "neutral" })],
        user_links: [
          {
            user_id: 33,
            allow_manager_browser_data_access: false,
          },
        ],
      })
    );
  });

  it("keeps Linked UI groups changes across tabs and submits canonical group links", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("tab", { name: "Linked UI groups" }));
    expect(screen.getByText("No linked groups yet.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add UI groups" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "Storage Group" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.click(screen.getByRole("tab", { name: "Linked UI groups" }));
    expect(screen.getByText("Storage Group")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3UserMock).toHaveBeenCalled();
    });

    const lastCall = updateS3UserMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(5);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        group_links: [
          {
            group_id: 31,
            allow_manager_browser_data_access: false,
          },
        ],
      })
    );
  });

  it("submits privileged access grants from the S3 user edit tab", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    expect(screen.getByText("Privileged Ceph access")).toBeInTheDocument();
    expect(
      screen.getByText("Ceph admin-API actions granted directly to this RGW user outside the Ceph Admin workspace.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Allow Ceph bucket quota updates for this RGW User in Manager.")
    ).toBeInTheDocument();
    expect(screen.getByText("Allow access to Manager > Ceph > Access keys.")).toBeInTheDocument();
    const quotaCheckbox = screen.getByRole("checkbox", { name: /Bucket quota management/ });
    const keysCheckbox = screen.getByRole("checkbox", { name: /Ceph S3 User keys/ });
    const privateCheckbox = screen.getByRole("checkbox", { name: /Managed private connection provisioning/ });
    expect(quotaCheckbox).not.toBeChecked();
    expect(keysCheckbox).not.toBeChecked();
    expect(privateCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);
    fireEvent.click(keysCheckbox);
    fireEvent.click(privateCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3UserMock).toHaveBeenCalled();
    });

    const lastCall = updateS3UserMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
        allow_access_key_management: true,
        allow_managed_private_connection_provisioning: true,
      })
    );
  });

  it("lets ui_admin submit privileged access grants from S3 user edits", async () => {
    setSessionUserCache({ id: 2, role: "ui_admin" });

    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Privileged access" }));

    const quotaCheckbox = screen.getByRole("checkbox", { name: /Bucket quota management/ });
    const keysCheckbox = screen.getByRole("checkbox", { name: /Ceph S3 User keys/ });
    expect(quotaCheckbox).not.toBeChecked();
    expect(keysCheckbox).not.toBeChecked();
    fireEvent.click(quotaCheckbox);
    fireEvent.click(keysCheckbox);

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3UserMock).toHaveBeenCalled();
    });

    const lastCall = updateS3UserMock.mock.calls.at(-1);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        allow_bucket_quota_management: true,
        allow_access_key_management: true,
      })
    );
  });

  it("creates a user with tags", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Create user" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "User details" })).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { name: "Quotas" })).toBeInTheDocument();
    const nameInput = dialog.querySelector("input[required]") as HTMLInputElement | null;
    if (!nameInput) {
      throw new Error("User name input not found");
    }
    expect(nameInput).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("UID (optional)")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Ceph endpoint *")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Email")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Storage quota unit")).toHaveClass("ui-control");
    expect(within(dialog).getByLabelText("Object quota")).toHaveClass("ui-control");
    expect(nameInput.closest(".grid")).toHaveClass("md:grid-cols-2");
    fireEvent.change(nameInput, { target: { value: "tagged-user" } });
    const tagInput = within(dialog).getByRole("textbox", { name: "Add a tag for this RGW user" });
    fireEvent.change(tagInput, {
      target: { value: "finance" },
    });
    fireEvent.keyDown(tagInput, { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(within(dialog).getByRole("button", { name: "Create user" })).toBeEnabled();
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Create user" }));

    await waitFor(() => {
      expect(createS3UserMock).toHaveBeenCalled();
    });
    expect(createS3UserMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "tagged-user",
        tags: [expect.objectContaining({ label: "finance", color_key: "neutral" })],
      })
    );
  });

  it("keeps tagged users visible with exact quick filter mode", async () => {
    listS3UsersMock.mockImplementation((params?: { search?: string }) => {
      const taggedUser = {
        id: 5,
        name: "rgw-user-1",
        rgw_user_uid: "rgw-uid-1",
        tags: [makeTag(601, "legacy")],
        email: "rgw-user-1@example.com",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        quota_max_size_gb: 1,
        quota_max_objects: 100,
        bucket_count: 0,
      };
      const plainUser = {
        id: 6,
        name: "rgw-user-2",
        rgw_user_uid: "rgw-uid-2",
        tags: [],
        email: "rgw-user-2@example.com",
        storage_endpoint_id: 10,
        storage_endpoint_name: "ceph-main",
        storage_endpoint_url: "https://ceph.example.test",
        quota_max_size_gb: 1,
        quota_max_objects: 100,
        bucket_count: 0,
      };
      const items = params?.search === "legacy" ? [taggedUser] : [taggedUser, plainUser];
      return Promise.resolve({
        items,
        total: items.length,
        page: 1,
        page_size: 25,
        has_next: false,
      });
    });

    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    await screen.findByText("rgw-user-2");

    const searchInput = screen.getByLabelText("Search");
    expect(searchInput).toHaveAttribute("type", "search");
    expect(searchInput).toHaveAttribute("placeholder", "Search by name, UID, email, group, or tag");

    fireEvent.click(screen.getByLabelText("Toggle filter match mode"));
    fireEvent.change(searchInput, {
      target: { value: "legacy" },
    });

    await waitFor(() => {
      expect(listS3UsersMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          search: "legacy",
          sort_by: "name",
          sort_dir: "asc",
        })
      );
    });
    expect(screen.getByText("rgw-user-1")).toBeInTheDocument();
    expect(screen.queryByText("rgw-user-2")).not.toBeInTheDocument();
    expect(screen.getByText("legacy").parentElement?.className).toContain("text-[10px]");
  });
});
