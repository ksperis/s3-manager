/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { Outlet } from "react-router-dom";
import Layout from "../../components/Layout";
import { SidebarSection } from "../../components/Sidebar";

const navSections: SidebarSection[] = [
  {
    label: "Overview",
    links: [{ to: "/storage-ops", label: "Dashboard", end: true }],
  },
  {
    label: "Operations",
    links: [{ to: "/storage-ops/buckets", label: "Buckets" }],
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
