/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";
import {
  STORAGE_OPS_PAGE_CONTRACTS,
  workspacePageLink,
} from "../../navigation/workspacePages";

const navSections: SidebarSection[] = [
  {
    label: "Overview",
    links: [{ ...workspacePageLink(STORAGE_OPS_PAGE_CONTRACTS.dashboard), end: true }],
  },
  {
    label: "Operations",
    links: [workspacePageLink(STORAGE_OPS_PAGE_CONTRACTS.buckets)],
  },
];

export default function StorageOpsLayout() {
  return (
    <Layout
      navSections={navSections}
      headerTitle="Storage Ops"
      sidebarTitle="STORAGE OPS"
      hideHeader
    >
      <Outlet />
    </Layout>
  );
}
