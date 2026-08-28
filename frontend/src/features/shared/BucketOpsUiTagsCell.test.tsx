/*
 * Copyright (c) 2026 Laurent Barbe
 * Licensed under the Apache License, Version 2.0
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BucketOpsUiTagsCell, {
  type BucketOpsUiTagsCellController,
} from "./BucketOpsUiTagsCell";

vi.mock("./BucketUiTagSettingsBadge", () => ({
  default: ({
    disabled,
    initiallyOpen,
    tag,
  }: {
    disabled?: boolean;
    initiallyOpen?: boolean;
    tag: { label: string };
  }) => (
    <span
      data-testid={`settings:${tag.label}`}
      data-disabled={disabled || undefined}
      data-open={initiallyOpen || undefined}
    >
      {tag.label}
    </span>
  ),
}));

const target = {
  key: "storage-ops:7:archive",
  endpointId: 7,
  identity: '[7,"","archive"]',
  name: "archive",
  tenant: null,
  contextId: "account-1",
};
const assignedTag = {
  id: 1,
  label: "critical",
  color_key: "red",
  scope: "standard" as const,
  visibility: "shared" as const,
};
const suggestedTag = {
  ...assignedTag,
  id: 2,
  label: "retained",
  visibility: "private" as const,
};
const creationDraft = {
  draftId: "draft-1",
  label: "new-tag",
  color_key: "neutral",
  scope: "standard" as const,
  visibility: "private" as const,
};

function controller(
  projection: ReturnType<BucketOpsUiTagsCellController["getRowTagProjection"]>,
): BucketOpsUiTagsCellController {
  return {
    addExistingTagForBucket: vi.fn(),
    addTagDraftForBucket: vi.fn(),
    getRowTagProjection: vi.fn(() => projection),
    removeTagCreationDraft: vi.fn(),
    removeTagForBucket: vi.fn(),
    setTagSuggestionBucket: vi.fn(),
    stageTagsForBucket: vi.fn(),
    updateBucketUiTagDefinition: vi.fn(),
    updateTagCreationDraft: vi.fn(),
    updateTagDraft: vi.fn(),
  };
}

describe("BucketOpsUiTagsCell", () => {
  it("reports a missing physical endpoint target", () => {
    const rowController = controller({
      creationDrafts: [],
      draft: "",
      showSuggestions: false,
      suggestions: [],
      tags: [],
    });
    render(
      <BucketOpsUiTagsCell
        assignedTags={[]}
        controller={rowController}
        isStorageOps
        target={null}
        updatingDefinitionIds={new Set()}
      />,
    );

    expect(screen.getByText("Endpoint required")).toHaveAttribute(
      "title",
      "UI tags require a configured storage endpoint.",
    );
    expect(rowController.getRowTagProjection).not.toHaveBeenCalled();
  });

  it("renders assigned and draft tags and delegates input interactions", () => {
    const rowController = controller({
      creationDrafts: [creationDraft],
      draft: "candidate",
      showSuggestions: false,
      suggestions: [],
      tags: [assignedTag],
    });
    render(
      <BucketOpsUiTagsCell
        assignedTags={[assignedTag]}
        controller={rowController}
        isStorageOps
        target={target}
        updatingDefinitionIds={new Set([1])}
      />,
    );

    expect(screen.getByTestId("settings:critical")).toHaveAttribute(
      "data-disabled",
      "true",
    );
    expect(screen.getByTestId("settings:new-tag")).toHaveAttribute(
      "data-open",
      "true",
    );
    const input = screen.getByLabelText("Add UI tags to archive");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "next" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(rowController.setTagSuggestionBucket).toHaveBeenCalledWith(
      target.key,
    );
    expect(rowController.updateTagDraft).toHaveBeenCalledWith(
      target.key,
      "next",
    );
    expect(rowController.stageTagsForBucket).toHaveBeenCalledWith(
      target,
      "candidate",
    );
  });

  it("adds an existing suggestion and clears the draft", () => {
    const rowController = controller({
      creationDrafts: [],
      draft: "ret",
      showSuggestions: true,
      suggestions: [suggestedTag],
      tags: [],
    });
    render(
      <BucketOpsUiTagsCell
        assignedTags={[]}
        controller={rowController}
        isStorageOps={false}
        target={target}
        updatingDefinitionIds={new Set()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "retained, Private" }),
    );

    expect(rowController.addExistingTagForBucket).toHaveBeenCalledWith(
      target,
      suggestedTag,
    );
    expect(rowController.updateTagDraft).toHaveBeenCalledWith(target.key, "");
  });
});
