import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import BucketOpsRowActionsMenu from "./BucketOpsRowActionsMenu";

describe("BucketOpsRowActionsMenu", () => {
  it("exposes each unitary RGW Admin Ops bucket action in Ceph Admin", () => {
    const onAdminOps = vi.fn();
    const anchorRefs = { current: {} };
    render(
      <BucketOpsRowActionsMenu
        actionMenuKey="bucket-a:actions"
        activeActionMenuKey="bucket-a:actions"
        setActiveActionMenuKey={vi.fn()}
        actionMenuAnchorRefs={anchorRefs}
        actionMenuSurfaceRef={createRef<HTMLDivElement>()}
        bucket={{ name: "bucket-a" }}
        isStorageOps={false}
        selectedEndpointId={7}
        cephAdminBrowserEnabled
        onOpenInBrowser={vi.fn()}
        onConfigure={vi.fn()}
        onAdminOps={onAdminOps}
      />
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Check bucket index" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Unlink bucket" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Link bucket" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete bucket" }));

    expect(onAdminOps.mock.calls).toEqual([
      [{ name: "bucket-a" }, "index-check"],
      [{ name: "bucket-a" }, "unlink-bucket"],
      [{ name: "bucket-a" }, "link-bucket"],
      [{ name: "bucket-a" }, "delete-bucket"],
    ]);
  });
});
