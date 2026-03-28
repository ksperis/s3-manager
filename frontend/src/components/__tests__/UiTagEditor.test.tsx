import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { TagColorKey, TagScope } from "../../api/tags";
import type { UiTagDefinition } from "../../utils/uiTags";
import UiTagEditor from "../UiTagEditor";

function StatefulEditor({
  initialTags,
  catalog,
  catalogMode,
  hint,
}: {
  initialTags?: UiTagDefinition[];
  catalog?: Array<{ id: number; label: string; color_key: TagColorKey; scope: TagScope }>;
  catalogMode?: "shared" | "private";
  hint?: string;
}) {
  const [tags, setTags] = useState<UiTagDefinition[]>(initialTags ?? []);
  return <UiTagEditor tags={tags} catalog={catalog} catalogMode={catalogMode} onChange={setTags} hint={hint} />;
}

async function openSettings(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `Edit tag ${label}` }));
  return screen.findByRole("group", { name: `Tag settings for ${label}` });
}

function getTagChip(label: string) {
  return screen.getByRole("button", { name: `Edit tag ${label}` }).closest("span");
}

describe("UiTagEditor", () => {
  it("adds an existing catalog tag from inline suggestions", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        catalog={[
          { id: 1, label: "gold", color_key: "amber", scope: "standard" },
          { id: 2, label: "ops", color_key: "teal", scope: "administrative" },
        ]}
      />
    );

    const input = screen.getByRole("textbox", { name: "Add a tag" });
    await user.click(input);
    await user.type(input, "gol");
    await user.click(screen.getByRole("button", { name: "Add tag gold" }));

    const badge = getTagChip("gold");
    expect(badge?.className).toContain("bg-amber-50");
  });

  it("creates a new tag from the inline input, then edits color and scope in the popover", async () => {
    const user = userEvent.setup();

    render(<StatefulEditor />);

    const input = screen.getByRole("textbox", { name: "Add a tag" });
    await user.type(input, "fresh{enter}");

    const settings = await openSettings("fresh");
    await user.click(within(settings).getByRole("button", { name: "Set fresh color to Blue" }));
    await user.click(within(settings).getByRole("button", { name: "Administrative" }));

    const badge = getTagChip("fresh");
    expect(badge?.className).toContain("bg-blue-50");
    expect(within(settings).getByText(/Administrative tags stay in management views\./)).toBeInTheDocument();
  });

  it("reuses the exact catalog tag instead of creating a duplicate", async () => {
    const user = userEvent.setup();

    render(<StatefulEditor catalog={[{ id: 1, label: "gold", color_key: "amber", scope: "standard" }]} />);

    const input = screen.getByRole("textbox", { name: "Add a tag" });
    await user.type(input, "gold{enter}");

    expect(screen.getAllByText("gold")).toHaveLength(1);
    const badge = getTagChip("gold");
    expect(badge?.className).toContain("bg-amber-50");
  });

  it("updates an existing shared tag through the popover", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        initialTags={[{ id: 1, label: "gold", color_key: "amber", scope: "standard" }]}
        catalog={[{ id: 1, label: "gold", color_key: "amber", scope: "standard" }]}
      />
    );

    const settings = await openSettings("gold");
    expect(within(settings).getByText("This tag is shared across the current domain.")).toBeInTheDocument();

    await user.click(within(settings).getByRole("button", { name: "Set gold color to Blue" }));
    await user.click(within(settings).getByRole("button", { name: "Administrative" }));

    const badge = getTagChip("gold");
    expect(badge?.className).toContain("bg-blue-50");
  });

  it("removes a tag from the inline row", async () => {
    const user = userEvent.setup();

    render(
      <StatefulEditor
        initialTags={[{ label: "draft-tag", color_key: "neutral", scope: "standard" }]}
      />
    );

    await user.click(screen.getByRole("button", { name: "Remove tag draft-tag" }));
    expect(screen.queryByText("draft-tag")).not.toBeInTheDocument();
  });

  it("uses the private wording for private tag catalogs", async () => {
    render(
      <StatefulEditor
        catalogMode="private"
        hint="Private tags are used for filtering and optional selector display."
        initialTags={[{ id: 1, label: "ops", color_key: "teal", scope: "standard" }]}
      />
    );

    expect(screen.getByText("Private tags are used for filtering and optional selector display.")).toBeInTheDocument();
    const settings = await openSettings("ops");
    expect(within(settings).getByText("This tag belongs to your private-connection tag catalog.")).toBeInTheDocument();
  });
});
