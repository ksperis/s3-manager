import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import BrowserPathNavigator from "./BrowserPathNavigator";

const buildProps = (
  overrides: Partial<ComponentProps<typeof BrowserPathNavigator>> = {},
): ComponentProps<typeof BrowserPathNavigator> => ({
  inputRef: createRef<HTMLInputElement>(),
  editing: false,
  value: "",
  disabled: false,
  suggestions: [],
  suggestionsLoading: false,
  activeSuggestionIndex: -1,
  breadcrumbs: [],
  canGoUp: false,
  onStartEditing: vi.fn(),
  onChange: vi.fn(),
  onBlur: vi.fn(),
  onKeyDown: vi.fn(),
  onHoverSuggestion: vi.fn(),
  onSelectSuggestion: vi.fn(),
  onGoUp: vi.fn(),
  onSelectPrefix: vi.fn(),
  ...overrides,
});

describe("BrowserPathNavigator", () => {
  it("opens path editing from the root display", () => {
    const onStartEditing = vi.fn();
    render(<BrowserPathNavigator {...buildProps({ onStartEditing })} />);

    expect(screen.getByRole("button", { name: "Parent folder" })).toBeDisabled();
    fireEvent.click(screen.getByText("(root)"));

    expect(onStartEditing).toHaveBeenCalledOnce();
  });

  it("navigates breadcrumbs without entering edit mode", () => {
    const onStartEditing = vi.fn();
    const onGoUp = vi.fn();
    const onSelectPrefix = vi.fn();
    render(
      <BrowserPathNavigator
        {...buildProps({
          breadcrumbs: [
            { label: "reports", prefix: "reports/" },
            { label: "2026", prefix: "reports/2026/" },
          ],
          canGoUp: true,
          onStartEditing,
          onGoUp,
          onSelectPrefix,
        })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Parent folder" }));
    fireEvent.click(screen.getByRole("button", { name: "root" }));
    fireEvent.click(screen.getByRole("button", { name: "reports" }));

    expect(onGoUp).toHaveBeenCalledOnce();
    expect(onSelectPrefix).toHaveBeenNthCalledWith(1, "");
    expect(onSelectPrefix).toHaveBeenNthCalledWith(2, "reports/");
    expect(onStartEditing).not.toHaveBeenCalled();
  });

  it("preserves the editable path combobox and suggestion callbacks", () => {
    const onChange = vi.fn();
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    const onHoverSuggestion = vi.fn();
    const onSelectSuggestion = vi.fn();
    const suggestion = {
      label: "archive",
      value: "reports/archive/",
      source: "history" as const,
    };
    render(
      <BrowserPathNavigator
        {...buildProps({
          editing: true,
          value: "reports/a",
          suggestions: [
            suggestion,
            {
              label: "annual",
              value: "reports/annual/",
              source: "local",
            },
          ],
          suggestionsLoading: true,
          activeSuggestionIndex: 0,
          onChange,
          onBlur,
          onKeyDown,
          onHoverSuggestion,
          onSelectSuggestion,
        })}
      />,
    );

    const input = screen.getByRole("combobox", { name: "Path" });
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      "browser-path-suggestion-0",
    );
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(screen.getByText("Visible")).toBeInTheDocument();
    expect(screen.getByText("Searching more folders...")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "reports/ar" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.blur(input);
    const archiveOption = screen.getByRole("option", { name: /archive/ });
    fireEvent.mouseEnter(archiveOption);
    fireEvent.mouseDown(archiveOption);

    expect(onChange).toHaveBeenCalledWith("reports/ar");
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(onBlur).toHaveBeenCalledOnce();
    expect(onHoverSuggestion).toHaveBeenCalledWith(0);
    expect(onSelectSuggestion).toHaveBeenCalledWith(suggestion);
  });

  it("announces an in-flight suggestion search before results arrive", () => {
    render(
      <BrowserPathNavigator
        {...buildProps({ editing: true, suggestionsLoading: true })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Path" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Searching folders...")).toBeInTheDocument();
  });
});
