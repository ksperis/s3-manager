import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import PortalObjectDetailRedirect from "./PortalObjectDetailRedirect";

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

describe("PortalObjectDetailRedirect", () => {
  it("redirects the former object page to the Storage Space drawer parameters", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/portal/storage-spaces/research%20data/objects/reports/annual%20report.csv?tab=history&deleted=1&prefix=reports%2F",
        ]}
      >
        <Routes>
          <Route path="/portal/storage-spaces/:spaceId/objects/*" element={<PortalObjectDetailRedirect />} />
          <Route path="/portal/storage-spaces/:spaceId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const location = screen.getByText(/\/portal\/storage-spaces\/research%20data\?/).textContent ?? "";
    const [, search = ""] = location.split("?");
    const params = new URLSearchParams(search);
    expect(params.get("object")).toBe("reports/annual report.csv");
    expect(params.get("object_view")).toBe("history");
    expect(params.get("object_deleted")).toBe("1");
    expect(params.get("show_deleted")).toBe("1");
    expect(params.get("prefix")).toBe("reports/");
  });
});
