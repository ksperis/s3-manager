import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import TableEmptyState from "../TableEmptyState";

function renderInTable(node: ReactNode) {
  return render(
    <table>
      <tbody>{node}</tbody>
    </table>
  );
}

describe("TableEmptyState", () => {
  it("renders neutral and error tones", () => {
    const { rerender } = renderInTable(<TableEmptyState colSpan={2} message="Empty neutral" />);
    expect(screen.getByText("Empty neutral")).toHaveClass("text-slate-500");

    rerender(
      <table>
        <tbody>
          <TableEmptyState colSpan={2} message="Empty error" tone="error" />
        </tbody>
      </table>
    );
    expect(screen.getByText("Empty error")).toHaveClass("text-rose-600");
  });

  it("applies aria-live value", () => {
    renderInTable(<TableEmptyState colSpan={1} message="Live status" ariaLive="assertive" />);
    expect(screen.getByText("Live status")).toHaveAttribute("aria-live", "assertive");
  });
});
