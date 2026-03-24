import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { InlinePolicy } from "../../api/managerIamPolicies";
import InlinePolicyDraftEditor, { type InlinePolicyDraftEditorMode } from "./InlinePolicyDraftEditor";

function Harness({ initialDrafts }: { initialDrafts: InlinePolicy[] }) {
  const [drafts, setDrafts] = useState<InlinePolicy[]>(initialDrafts);
  const [selectedDraftName, setSelectedDraftName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftText, setDraftText] = useState("");
  const [mode, setMode] = useState<InlinePolicyDraftEditorMode>(initialDrafts.length > 0 ? "idle" : "create");

  const handleSelectDraft = (name: string | null) => {
    if (!name) {
      setSelectedDraftName(null);
      setDraftName("");
      setDraftText("");
      setMode(drafts.length > 0 ? "idle" : "create");
      return;
    }
    const draft = drafts.find((item) => item.name === name);
    if (!draft) return;
    setSelectedDraftName(draft.name);
    setDraftName(draft.name);
    setDraftText(JSON.stringify(draft.document ?? {}, null, 2));
    setMode("edit");
  };

  const handleSaveDraft = () => {
    const trimmed = draftName.trim();
    const parsed = draftText.trim() ? JSON.parse(draftText) : {};
    setDrafts((prev) => {
      const filtered = prev.filter((item) => item.name !== trimmed && item.name !== selectedDraftName);
      return [...filtered, { name: trimmed, document: parsed }];
    });
    setSelectedDraftName(trimmed);
    setDraftName(trimmed);
    setDraftText(JSON.stringify(parsed, null, 2));
    setMode("edit");
  };

  return (
    <InlinePolicyDraftEditor
      drafts={drafts}
      selectedDraftName={selectedDraftName}
      draftName={draftName}
      draftText={draftText}
      entityLabel="user"
      mode={mode}
      onCreateDraft={() => {
        setSelectedDraftName(null);
        setDraftName("");
        setDraftText("");
        setMode("create");
      }}
      onSelectDraft={handleSelectDraft}
      onDraftNameChange={setDraftName}
      onDraftTextChange={setDraftText}
      onSaveDraft={handleSaveDraft}
      onRemoveDraft={(name) => {
        setDrafts((prev) => prev.filter((item) => item.name !== name));
        if (selectedDraftName === name) {
          setSelectedDraftName(null);
          setDraftName("");
          setDraftText("");
          setMode(drafts.length > 1 ? "idle" : "create");
        }
      }}
      onClearDrafts={() => {
        setDrafts([]);
        setSelectedDraftName(null);
        setDraftName("");
        setDraftText("");
        setMode("create");
      }}
      onInsertTemplate={() => setDraftText('{\n  "Version": "2012-10-17",\n  "Statement": []\n}')}
    />
  );
}

describe("InlinePolicyDraftEditor", () => {
  it("shows saved drafts before the editor when drafts already exist", () => {
    render(
      <Harness
        initialDrafts={[
          {
            name: "readonly-inline",
            document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }] },
          },
        ]}
      />
    );

    expect(screen.getByText("Saved inline policies")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /readonly-inline/i })[0]).toBeInTheDocument();
    expect(screen.getByText("Select a saved inline policy to edit, or create a new one.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Inline policy name")).not.toBeInTheDocument();
  });

  it("loads a selected draft into the editor", () => {
    render(
      <Harness
        initialDrafts={[
          {
            name: "readonly-inline",
            document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }] },
          },
        ]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /readonly-inline/i })[0]);

    expect(screen.getByLabelText("Inline policy name")).toHaveValue("readonly-inline");
    expect(screen.getByRole("button", { name: "Update draft" })).toBeInTheDocument();
  });

  it("warns when a draft name matches another saved draft", () => {
    render(
      <Harness
        initialDrafts={[
          {
            name: "readonly-inline",
            document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:GetObject"], Resource: "*" }] },
          },
          {
            name: "write-inline",
            document: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["s3:PutObject"], Resource: "*" }] },
          },
        ]}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: /readonly-inline/i })[0]);
    fireEvent.change(screen.getByLabelText("Inline policy name"), { target: { value: "write-inline" } });

    expect(screen.getByText('Saving this draft will replace the existing draft "write-inline".')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update draft" })).toBeInTheDocument();
  });
});
