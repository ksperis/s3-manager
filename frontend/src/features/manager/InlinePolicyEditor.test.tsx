import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InlinePolicyEditor from "./InlinePolicyEditor";

const loadPoliciesMock = vi.fn();
const savePolicyMock = vi.fn();
const deletePolicyMock = vi.fn();

describe("InlinePolicyEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps existing inline policies visible before anything is selected", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    expect(await screen.findByText("Existing inline policies")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /readonly-inline/i })).toBeInTheDocument();
    expect(screen.getByText("Select an existing inline policy to review or edit")).toBeInTheDocument();
    expect(screen.queryByLabelText("Inline policy name")).not.toBeInTheDocument();
  });

  it("loads an existing inline policy into the editor and switches the CTA to update", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading inline policies...")).not.toBeInTheDocument();
    });

    fireEvent.click((await screen.findAllByRole("button", { name: /readonly-inline/i }))[0]);

    expect(await screen.findByLabelText("Inline policy name")).toHaveValue("readonly-inline");
    expect((screen.getByLabelText("Inline policy document (JSON)") as HTMLTextAreaElement).value).toContain('"Action": [');
    expect(screen.getByRole("button", { name: "Update existing inline policy" })).toBeInTheDocument();
  });

  it("warns when saving with the name of another existing inline policy", async () => {
    loadPoliciesMock.mockResolvedValue([
      {
        name: "readonly-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }],
        },
      },
      {
        name: "write-inline",
        document: {
          Version: "2012-10-17",
          Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: "*" }],
        },
      },
    ]);

    render(
      <InlinePolicyEditor
        entityLabel="user"
        entityName="alice"
        loadPolicies={loadPoliciesMock}
        savePolicy={savePolicyMock}
        deletePolicy={deletePolicyMock}
      />
    );

    await waitFor(() => {
      expect(screen.queryByText("Loading inline policies...")).not.toBeInTheDocument();
    });

    fireEvent.click((await screen.findAllByRole("button", { name: /readonly-inline/i }))[0]);
    fireEvent.change(await screen.findByLabelText("Inline policy name"), { target: { value: "write-inline" } });

    expect(screen.getByText(/will replace that existing inline policy/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace existing inline policy" })).toBeInTheDocument();
  });
});
