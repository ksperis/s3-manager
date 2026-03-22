import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageHeader from "../PageHeader";

describe("PageHeader", () => {
  it("renders title, description, breadcrumbs and actions", () => {
    render(
      <MemoryRouter>
        <PageHeader
          title="Billing"
          description="Monthly usage and cost overview."
          breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Billing" }]}
          actions={[{ label: "Refresh", onClick: () => undefined, variant: "ghost" }]}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Billing" })).toBeInTheDocument();
    expect(screen.getByText("Monthly usage and cost overview.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/admin");
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });
});
