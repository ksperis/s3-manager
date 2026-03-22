import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PageEmptyState from "../PageEmptyState";

describe("PageEmptyState", () => {
  it("renders guidance and actions", () => {
    render(
      <MemoryRouter>
        <PageEmptyState
          title="Select an account"
          description="Choose an execution context before loading data."
          primaryAction={{ label: "Open accounts", to: "/admin/s3-accounts" }}
          secondaryAction={{ label: "Retry", onClick: () => undefined }}
        />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { name: "Select an account" })).toBeInTheDocument();
    expect(screen.getByText("Choose an execution context before loading data.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open accounts" })).toHaveAttribute("href", "/admin/s3-accounts");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
