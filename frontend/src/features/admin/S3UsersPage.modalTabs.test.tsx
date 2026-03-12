import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import S3UsersPage from "./S3UsersPage";

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

describe("S3UsersPage modal tabs", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    localStorage.setItem("user", JSON.stringify({ id: 1, role: "ui_superadmin" }));

    listS3UsersMock.mockResolvedValue({
      items: [
        {
          id: 5,
          name: "rgw-user-1",
          rgw_user_uid: "rgw-uid-1",
          email: "rgw-user-1@example.com",
          storage_endpoint_id: 10,
          storage_endpoint_name: "ceph-main",
          storage_endpoint_url: "https://ceph.example.test",
          user_ids: [],
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

    getS3UserMock.mockResolvedValue({
      id: 5,
      quota_max_size_gb: 1,
      quota_max_objects: 100,
    });

    getS3UserWithBucketsMock.mockResolvedValue({ id: 5, bucket_count: 0 });
    updateS3UserMock.mockResolvedValue(undefined);
    createS3UserMock.mockResolvedValue(undefined);
    importS3UsersMock.mockResolvedValue(undefined);
    deleteS3UserMock.mockResolvedValue(undefined);
  });

  it("keeps Linked UI users changes across tabs and submits user_ids", async () => {
    render(
      <MemoryRouter>
        <S3UsersPage />
      </MemoryRouter>
    );

    await screen.findByText("rgw-user-1");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.click(await screen.findByRole("button", { name: "Linked UI users" }));

    fireEvent.click(screen.getByRole("button", { name: "Add UI users" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: "ui33@example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected" }));

    fireEvent.click(screen.getByRole("button", { name: "General" }));
    fireEvent.click(screen.getByRole("button", { name: "Linked UI users" }));

    expect(screen.getByText("ui33@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(updateS3UserMock).toHaveBeenCalled();
    });

    const lastCall = updateS3UserMock.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(5);
    expect(lastCall?.[1]).toEqual(
      expect.objectContaining({
        user_ids: [33],
      })
    );
  });
});
