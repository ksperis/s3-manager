/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { useState } from "react";
import PageHeader from "../../components/PageHeader";
import PageTabs from "../../components/PageTabs";
import UiBadge from "../../components/ui/UiBadge";
import UiButton from "../../components/ui/UiButton";
import UiCard from "../../components/ui/UiCard";

function readUser() {
  if (typeof window === "undefined") return { email: "laurent@example.com", name: "Laurent" };
  const raw = window.localStorage.getItem("user");
  if (!raw) return { email: "laurent@example.com", name: "Laurent" };
  try {
    const parsed = JSON.parse(raw) as { email?: string | null; full_name?: string | null; display_name?: string | null };
    return {
      email: parsed.email ?? "laurent@example.com",
      name: parsed.display_name || parsed.full_name || parsed.email?.split("@")[0] || "Laurent",
    };
  } catch {
    return { email: "laurent@example.com", name: "Laurent" };
  }
}

export default function PortalSettingsPage() {
  const user = readUser();
  const [activeTab, setActiveTab] = useState("General");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description="Configure your account and preferences."
        breadcrumbs={[{ label: "Portal" }, { label: "Settings" }]}
      />
      <PageTabs
        tabs={["General", "Security", "Notifications"].map((tab) => ({ id: tab, label: tab }))}
        activeTab={activeTab}
        onChange={setActiveTab}
        variant="bar"
      />
      <section className="grid gap-4 xl:grid-cols-3">
        <UiCard title="Account">
          <dl className="space-y-4 text-xs">
            <div>
              <dt className="font-bold text-slate-400">Account name</dt>
              <dd className="mt-1 font-semibold text-slate-800">{user.name}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Account ID</dt>
              <dd className="mt-1 font-semibold text-slate-800">acc-123456</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Email</dt>
              <dd className="mt-1 font-semibold text-slate-800">{user.email}</dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Timezone</dt>
              <dd className="mt-1 font-semibold text-slate-800">Europe/Paris</dd>
            </div>
          </dl>
          <UiButton variant="secondary" className="mt-6 h-8 px-3 py-1.5">Edit</UiButton>
        </UiCard>

        <UiCard title="Security">
          <dl className="space-y-4 text-xs">
            <div>
              <dt className="font-bold text-slate-400">Password</dt>
              <dd className="mt-1 flex items-center justify-between gap-3 font-semibold text-slate-800">
                <span>********</span>
                <UiButton variant="secondary" className="h-7 px-3 py-1">Change</UiButton>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">MFA</dt>
              <dd className="mt-1"><UiBadge tone="success">Enabled</UiBadge></dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Session timeout</dt>
              <dd className="mt-1 font-semibold text-slate-800">1 hour</dd>
            </div>
          </dl>
          <UiButton variant="secondary" className="mt-6 h-8 px-3 py-1.5">Edit</UiButton>
        </UiCard>

        <UiCard title="Preferences">
          <dl className="space-y-4 text-xs">
            <div>
              <dt className="font-bold text-slate-400">Theme</dt>
              <dd className="mt-1">
                <select className="ui-control h-8 w-32 py-1.5 text-xs" value="Light" readOnly>
                  <option>Light</option>
                </select>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Items per page</dt>
              <dd className="mt-1">
                <select className="ui-control h-8 w-24 py-1.5 text-xs" value="20" readOnly>
                  <option>20</option>
                </select>
              </dd>
            </div>
            <div>
              <dt className="font-bold text-slate-400">Date format</dt>
              <dd className="mt-1">
                <input className="ui-control h-8 w-36 text-xs" value="MM/DD/YYYY" readOnly />
              </dd>
            </div>
          </dl>
          <UiButton variant="secondary" className="mt-6 h-8 px-3 py-1.5">Edit</UiButton>
        </UiCard>
      </section>
    </div>
  );
}
