import { describe, expect, it } from "vitest";

import {
  ADMIN_PAGE_CONTRACTS,
  CEPH_ADMIN_PAGE_CONTRACTS,
  buildWorkspaceBreadcrumbs,
  buildWorkspacePageBreadcrumbs,
} from "./workspacePages";

describe("workspace breadcrumb contracts", () => {
  it("links the workspace root whenever the breadcrumb has descendants", () => {
    expect(buildWorkspaceBreadcrumbs("manager", { label: "Buckets" })).toEqual([
      { label: "Manager", to: "/manager" },
      { label: "Buckets" },
    ]);
    expect(buildWorkspaceBreadcrumbs("manager")).toEqual([{ label: "Manager" }]);
  });

  it("links a canonical list page only when a detail or workflow follows it", () => {
    expect(buildWorkspacePageBreadcrumbs("admin", ADMIN_PAGE_CONTRACTS.users)).toEqual([
      { label: "Admin", to: "/admin" },
      { label: "UI Users" },
    ]);
    expect(
      buildWorkspacePageBreadcrumbs("admin", ADMIN_PAGE_CONTRACTS.users, { label: "Edit" }),
    ).toEqual([
      { label: "Admin", to: "/admin" },
      { label: "UI Users", to: "/admin/users" },
      { label: "Edit" },
    ]);
  });

  it("keeps Ceph Admin labels aligned with the sidebar vocabulary", () => {
    expect(buildWorkspacePageBreadcrumbs("ceph-admin", CEPH_ADMIN_PAGE_CONTRACTS.accounts)).toEqual([
      { label: "Ceph Admin", to: "/ceph-admin" },
      { label: "RGW Accounts" },
    ]);
  });
});
