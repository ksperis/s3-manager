import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import PageShell from "../PageShell";

describe("PageShell", () => {
  it("keeps the shared page header and body in one shell", () => {
    const { container } = render(
      <MemoryRouter>
        <PageShell
          title="General settings"
          description="Global platform options."
          breadcrumbs={[
            { label: "Admin", to: "/admin" },
            { label: "General" },
          ]}
          actions={[{ label: "Save changes", onClick: () => undefined }]}
        >
          <section aria-label="Settings content">Content</section>
        </PageShell>
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "General settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Settings content" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("space-y-4");
  });
});
