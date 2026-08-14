import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  WorkspaceDashboardKpiRow,
  WorkspaceDashboardMetricTrendLine,
} from "../WorkspaceDashboardKit";

describe("WorkspaceDashboardMetricTrendLine", () => {
  it("allows long localized KPI trend qualifiers to wrap inside the card", () => {
    const { container } = render(
      <WorkspaceDashboardMetricTrendLine
        trend={{
          label: "44 MB par rapport à la semaine dernière",
          valueLabel: "44 MB",
          qualifierLabel: " par rapport à la semaine dernière",
          tone: "negative",
        }}
      />
    );

    const line = container.querySelector("p");
    const label = line?.querySelector("span.min-w-0");

    expect(line).toHaveTextContent("44 MB par rapport à la semaine dernière");
    expect(line).toHaveClass("min-w-0", "items-start");
    expect(line).not.toHaveClass("whitespace-nowrap");
    expect(label).toHaveClass("whitespace-normal", "break-words");
  });
});

describe("WorkspaceDashboardKpiRow", () => {
  it("supports a balanced five-column dashboard row at the shared desktop breakpoint", () => {
    const { container } = render(
      <WorkspaceDashboardKpiRow metrics={[]} columns={5} />
    );

    expect(container.firstElementChild).toHaveClass("md:grid-cols-2", "xl:grid-cols-5");
    expect(container.firstElementChild).not.toHaveClass("2xl:grid-cols-5");
  });
});
