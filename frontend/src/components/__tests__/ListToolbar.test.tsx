import { render, screen } from "@testing-library/react";
import ListToolbar from "../ListToolbar";

describe("ListToolbar", () => {
  it("renders title, count and controls", () => {
    render(
      <div className="ui-surface-card">
        <ListToolbar
          title="Users"
          description="All platform users."
          countLabel="12 users"
          search={<input aria-label="Search users" />}
          filters={<button type="button">Filters</button>}
          columns={<button type="button">Columns</button>}
          actions={<button type="button">Refresh</button>}
        />
      </div>
    );

    expect(screen.getByText("Users")).toBeInTheDocument();
    expect(screen.getByText("All platform users.")).toBeInTheDocument();
    expect(screen.getByText("12 users")).toBeInTheDocument();
    expect(screen.getByLabelText("Search users")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Columns" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  });

  it("can hide the visible heading while keeping an accessible label", () => {
    render(
      <div className="ui-surface-card">
        <ListToolbar
          title="Buckets"
          description="Paginated list of buckets."
          showHeading={false}
          countLabel="4 buckets"
          search={<input aria-label="Search buckets" />}
        />
      </div>
    );

    expect(screen.getByRole("region", { name: "Buckets" })).toBeInTheDocument();
    expect(screen.queryByText("Paginated list of buckets.")).not.toBeInTheDocument();
    expect(screen.getByText("4 buckets")).toBeInTheDocument();
    expect(screen.getByLabelText("Search buckets")).toBeInTheDocument();
  });
});
