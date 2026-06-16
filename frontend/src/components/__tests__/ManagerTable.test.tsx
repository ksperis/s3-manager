import { render, screen } from "@testing-library/react";

import ManagerTable from "../list/ManagerTable";

describe("ManagerTable", () => {
  it("renders manager table structure, column alignment, and body children", () => {
    render(
      <ManagerTable
        columns={[
          { key: "name", label: "Name" },
          { key: "actions", label: "Actions", align: "right" },
          { key: "select", label: "Select", hideLabel: true },
        ]}
      >
        <tr>
          <td>logs-prod</td>
          <td>Edit</td>
        </tr>
      </ManagerTable>
    );

    expect(screen.getByRole("table")).toHaveClass("manager-table");
    expect(screen.getByRole("columnheader", { name: "Name" })).toHaveClass("text-left");
    expect(screen.getByRole("columnheader", { name: "Actions" })).toHaveClass("text-right");
    expect(screen.getByRole("columnheader", { name: "Select" }).querySelector(".sr-only")).toHaveTextContent("Select");
    expect(screen.getByText("logs-prod")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });
});
