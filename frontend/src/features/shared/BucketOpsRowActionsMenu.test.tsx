import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";

describe("BucketOpsRowActionsMenu", () => {
  it("exposes each unitary RGW Admin Ops bucket action in Ceph Admin", () => {
    const onAdminOps = vi.fn();
    render(
      <BucketOpsRowActionsMenu
        bucket={{ name: "bucket-a" }}
        isStorageOps={false}
        selectedEndpointId={7}
        cephAdminBrowserEnabled
        onOpenInBrowser={vi.fn()}
        onConfigure={vi.fn()}
        onAdminOps={onAdminOps}
      />
    );

    const trigger = screen.getByRole("button", { name: "Actions for bucket bucket-a" });
    expect(trigger).toHaveClass("h-6", "w-6");
    expect(trigger.className).not.toContain("!h-8");
    expect(trigger.className).not.toContain("!w-8");

    const openMenu = () => fireEvent.click(trigger);
    openMenu();
    expect(screen.getByText("S3 API")).toBeInTheDocument();
    expect(screen.getByText("RGW Admin Ops")).toBeInTheDocument();
    expect(screen.getByText("Destructive RGW Admin Ops")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Check bucket index…" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unlink bucket…" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Link bucket…" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete bucket…" }));

    expect(onAdminOps.mock.calls).toEqual([
      [{ name: "bucket-a" }, "index-check"],
      [{ name: "bucket-a" }, "unlink-bucket"],
      [{ name: "bucket-a" }, "link-bucket"],
      [{ name: "bucket-a" }, "delete-bucket"],
    ]);
  });
});
