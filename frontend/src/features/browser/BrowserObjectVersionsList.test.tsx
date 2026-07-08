import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrowserObjectVersion } from "../../api/browser";
import BrowserObjectVersionsList from "./BrowserObjectVersionsList";

const version: BrowserObjectVersion = {
  key: "reports/summary.csv",
  version_id: "version-a",
  is_latest: true,
  is_delete_marker: false,
  last_modified: "2026-03-10T09:10:11Z",
  size: 42,
  etag: "etag-a",
};

const baseProps = {
  versions: [] as BrowserObjectVersion[],
  loading: false,
  error: null as string | null,
  onRestoreVersion: vi.fn(),
  onDeleteVersion: vi.fn(),
};

function renderList(overrides: Partial<typeof baseProps> = {}) {
  const props = {
    ...baseProps,
    onRestoreVersion: vi.fn(),
    onDeleteVersion: vi.fn(),
    ...overrides,
  };
  const view = render(<BrowserObjectVersionsList {...props} />);
  return { props, ...view };
}

describe("BrowserObjectVersionsList", () => {
  it("renders load errors with the shared inline treatment", () => {
    renderList({ error: "Unable to list versions" });

    expect(screen.getByText("Unable to list versions")).toHaveClass("border-rose-200");
  });

  it("renders versions and triggers restore and delete actions", async () => {
    const user = userEvent.setup();
    const { props } = renderList({ versions: [version] });

    expect(screen.getByText(/version-a/)).toBeInTheDocument();
    expect(screen.getByText("latest")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Restore" }));
    await user.click(screen.getByRole("button", { name: "Delete version" }));

    expect(props.onRestoreVersion).toHaveBeenCalledWith(version);
    expect(props.onDeleteVersion).toHaveBeenCalledWith(version);
  });
});
