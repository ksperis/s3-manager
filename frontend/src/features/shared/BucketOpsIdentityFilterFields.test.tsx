/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsIdentityFilterFields from "./BucketOpsIdentityFilterFields";
import { defaultAdvancedFilter } from "./bucketOpsAdvancedFilterModel";
import { buildAdvancedFilterFieldState } from "./bucketOpsAdvancedFilterUiProjection";

type IdentityController = ComponentProps<
  typeof BucketOpsIdentityFilterFields
>["controller"];

function createController(
  overrides: Partial<IdentityController> = {},
): IdentityController {
  const fieldState = buildAdvancedFilterFieldState(false, false);
  return {
    ownerDraftEffectiveMatchMode: "contains",
    ownerDraftForcesExact: false,
    ownerFieldState: fieldState,
    ownerNameDraftEffectiveMatchMode: "contains",
    ownerNameDraftForcesExact: false,
    ownerNameFieldState: fieldState,
    ownerSuspendedFieldState: fieldState,
    s3TagsDraftEffectiveMatchMode: "contains",
    s3TagsDraftForcesExact: false,
    s3TagsFieldState: fieldState,
    tenantDraftEffectiveMatchMode: "contains",
    tenantDraftForcesExact: false,
    tenantFieldState: fieldState,
    updateAdvancedField: vi.fn(),
    updateAdvancedMatchMode: vi.fn(),
    updateAdvancedOwnerNameScope: vi.fn(),
    updateAdvancedOwnerSuspended: vi.fn(),
    ...overrides,
  };
}

describe("BucketOpsIdentityFilterFields", () => {
  it("delegates identity values, match modes, and owner selectors", () => {
    const controller = createController();
    render(
      <BucketOpsIdentityFilterFields
        advancedDraft={defaultAdvancedFilter}
        controller={controller}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("tenant-a, tenant-b"), {
      target: { value: "finance" },
    });
    fireEvent.change(screen.getByPlaceholderText("owner uid(s)"), {
      target: { value: "tenant$alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("display name(s)"), {
      target: { value: "Alice" },
    });
    fireEvent.change(screen.getByPlaceholderText("env=prod, team=storage"), {
      target: { value: "env=prod" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Exact" })[0]);
    fireEvent.change(screen.getByTitle("Owner entity scope"), {
      target: { value: "account" },
    });
    fireEvent.change(screen.getAllByRole("combobox")[1], {
      target: { value: "true" },
    });

    expect(controller.updateAdvancedField).toHaveBeenCalledWith(
      "tenant",
      "finance",
    );
    expect(controller.updateAdvancedField).toHaveBeenCalledWith(
      "owner",
      "tenant$alice",
    );
    expect(controller.updateAdvancedField).toHaveBeenCalledWith(
      "ownerName",
      "Alice",
    );
    expect(controller.updateAdvancedField).toHaveBeenCalledWith(
      "s3Tags",
      "env=prod",
    );
    expect(controller.updateAdvancedMatchMode).toHaveBeenCalledWith(
      "tenantMatchMode",
      "exact",
    );
    expect(controller.updateAdvancedOwnerNameScope).toHaveBeenCalledWith(
      "account",
    );
    expect(controller.updateAdvancedOwnerSuspended).toHaveBeenCalledWith(
      "true",
    );
  });

  it("locks match-mode buttons for pasted exact lists", () => {
    render(
      <BucketOpsIdentityFilterFields
        advancedDraft={{
          ...defaultAdvancedFilter,
          tenant: "finance, archive",
        }}
        controller={createController({
          tenantDraftEffectiveMatchMode: "exact",
          tenantDraftForcesExact: true,
        })}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Contains" })[0]).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Exact" })[0]).toBeDisabled();
  });
});
