import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { RequireManagerFeatureRulesTool } from "./router";

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<RequireManagerFeatureRulesTool />}>
          <Route path="/manager/feature-rules" element={<h1>Feature rules page</h1>} />
        </Route>
        <Route path="/unauthorized" element={<h1>Unauthorized access</h1>} />
      </Routes>
    </MemoryRouter>
  );
}

function setStoredUser(featureRules: boolean, effectiveFeatureRules = featureRules) {
  window.localStorage.setItem("token", "test-token");
  window.localStorage.setItem(
    "user",
    JSON.stringify({
      id: 10,
      email: "manager@example.com",
      role: "ui_user",
      capabilities: { can_manage_buckets: true },
      manager_tool_access: {
        bucket_compare: false,
        bucket_integrity_check: false,
        bucket_migration: false,
        feature_rules: featureRules,
        bucket_quota: false,
        ceph_s3_user_keys: false,
      },
      effective_access: {
        manager_tool_access: {
          bucket_compare: false,
          bucket_integrity_check: false,
          bucket_migration: false,
          feature_rules: effectiveFeatureRules,
          bucket_quota: false,
          ceph_s3_user_keys: false,
        },
      },
    })
  );
}

describe("manager tool routes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("redirects Feature rules to unauthorized without manager tool access", async () => {
    setStoredUser(false);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "Unauthorized access" })).toBeInTheDocument();
  });

  it("allows Feature rules when manager tool access is enabled", async () => {
    setStoredUser(true);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "Feature rules page" })).toBeInTheDocument();
  });

  it("allows Feature rules when manager tool access is inherited", async () => {
    setStoredUser(false, true);

    renderRoute("/manager/feature-rules");

    expect(await screen.findByRole("heading", { name: "Feature rules page" })).toBeInTheDocument();
  });
});
