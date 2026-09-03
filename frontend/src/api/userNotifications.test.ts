import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  delete: vi.fn(),
}));

vi.mock("./client", () => ({ default: clientMock }));

import {
  clearReadUserNotifications,
  deleteUserNotification,
} from "./userNotifications";

describe("user notification deletion APIs", () => {
  beforeEach(() => {
    clientMock.delete.mockReset();
  });

  it("deletes one notification", async () => {
    const payload = { deleted_count: 1, unread_count: 2 };
    clientMock.delete.mockResolvedValue({ data: payload });

    await expect(deleteUserNotification(42)).resolves.toEqual(payload);
    expect(clientMock.delete).toHaveBeenCalledWith("/users/me/notifications/42");
  });

  it("clears read notifications with an explicit scoped query", async () => {
    const payload = { deleted_count: 3, unread_count: 1 };
    clientMock.delete.mockResolvedValue({ data: payload });

    await expect(clearReadUserNotifications()).resolves.toEqual(payload);
    expect(clientMock.delete).toHaveBeenCalledWith("/users/me/notifications", {
      params: { read_only: true },
    });
  });
});
