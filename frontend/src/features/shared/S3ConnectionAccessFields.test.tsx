import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import S3ConnectionAccessFields from "./S3ConnectionAccessFields";

describe("S3ConnectionAccessFields", () => {
  it("renders the shared access choices and hint", () => {
    render(
      <S3ConnectionAccessFields
        accessManager={false}
        accessBrowser
        onAccessManagerChange={() => undefined}
        onAccessBrowserChange={() => undefined}
      />
    );

    expect(screen.getByText("Workspace access")).toBeInTheDocument();
    expect(screen.getByLabelText("Access manager")).not.toBeChecked();
    expect(screen.getByLabelText("Access browser")).toBeChecked();
    expect(screen.getByText("At least one access must be enabled.")).toBeInTheDocument();
  });

  it("reports checkbox changes with boolean values", () => {
    const onAccessManagerChange = vi.fn();
    const onAccessBrowserChange = vi.fn();

    render(
      <S3ConnectionAccessFields
        accessManager={false}
        accessBrowser
        onAccessManagerChange={onAccessManagerChange}
        onAccessBrowserChange={onAccessBrowserChange}
      />
    );

    fireEvent.click(screen.getByLabelText("Access manager"));
    fireEvent.click(screen.getByLabelText("Access browser"));

    expect(onAccessManagerChange).toHaveBeenCalledWith(true);
    expect(onAccessBrowserChange).toHaveBeenCalledWith(false);
  });

  it("supports panel framing and owner metadata", () => {
    render(
      <S3ConnectionAccessFields
        accessManager
        accessBrowser={false}
        onAccessManagerChange={() => undefined}
        onAccessBrowserChange={() => undefined}
        title="Access"
        ownerSummary="IAM user: researcher"
        variant="panel"
      />
    );

    expect(screen.getByText("Access").closest("section")).toHaveClass("rounded-lg");
    expect(screen.getByText("Owner metadata: IAM user: researcher")).toBeInTheDocument();
  });
});
