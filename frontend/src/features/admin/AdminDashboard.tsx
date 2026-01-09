/*
 * Copyright (c) 2025 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useEffect, useMemo, useState } from "react";
import { AdminSummary, fetchAdminSummary } from "../../api/stats";
import PageHeader from "../../components/PageHeader";
import PageBanner from "../../components/PageBanner";
import StatCards from "../../components/StatCards";

export default function AdminDashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const data = await fetchAdminSummary();
        setSummary(data);
        setError(null);
      } catch (err) {
        setError("Unable to load admin overview.");
      }
    };
    load();
  }, []);

  const cards = useMemo(
    () =>
      summary
        ? [
            {
              label: "UI users",
              value: (summary.total_users ?? 0) + (summary.total_admins ?? 0) + (summary.total_none_users ?? 0),
              hint: `Admins: ${summary.total_admins ?? 0} | Users: ${summary.total_users ?? 0} | None: ${
                summary.total_none_users ?? 0
              }`,
              to: "/admin/users",
            },
            {
              label: "Accounts",
              value: summary.total_accounts,
              hint: `Assigned: ${summary.assigned_accounts ?? 0} | Unassigned: ${summary.unassigned_accounts ?? 0}`,
              to: "/admin/s3-accounts",
            },
            {
              label: "S3 users",
              value: summary.total_s3_users ?? 0,
              hint: `Assigned: ${summary.assigned_s3_users ?? 0} | Unassigned: ${summary.unassigned_s3_users ?? 0}`,
              to: "/admin/s3-users",
            },
            {
              label: "Endpoints",
              value: summary.total_endpoints ?? 0,
              hint: `Ceph: ${summary.total_ceph_endpoints ?? 0} | Other: ${summary.total_other_endpoints ?? 0}`,
              to: "/admin/storage-endpoints",
            },
          ]
        : [],
    [summary]
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Admin overview"
        breadcrumbs={[{ label: "Admin" }, { label: "Dashboard" }]}
      />

      {error && <PageBanner tone="error">{error}</PageBanner>}

      <StatCards stats={cards} columns={3} />
    </div>
  );
}
