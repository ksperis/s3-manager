import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ExecutionContext } from "../../api/executionContexts";
import TopbarContextAccountSelector from "../TopbarContextAccountSelector";
import { SELECTOR_TAGS_PREFERENCE_KEY } from "../../utils/selectorTagsPreference";

const baseCapabilities = {
  can_manage_iam: true,
  sts_capable: true,
  admin_api_capable: true,
};

function makeContext(overrides: Partial<ExecutionContext>): ExecutionContext {
  return {
    kind: "account",
    id: "ctx-default",
    display_name: "Default",
    tags: [],
    endpoint_tags: [],
    capabilities: baseCapabilities,
    ...overrides,
  };
}

function renderSelector(params: {
  contexts: ExecutionContext[];
  selectedContextId?: string | null;
  onContextChange?: (selectedValue: string) => void;
}) {
  const { contexts, selectedContextId = contexts[0]?.id ?? null, onContextChange = () => undefined } = params;
  render(
    <TopbarContextAccountSelector
      contexts={contexts}
      selectedContextId={selectedContextId}
      onContextChange={onContextChange}
      selectedLabel="Selected context"
      identityLabel={null}
      defaultEndpointId={null}
      defaultEndpointName="Default"
    />
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Select context account" }));
  return screen.findByRole("listbox", { name: "Select context account" });
}

function visibleOptionLabels(listbox: HTMLElement): string[] {
  return within(listbox)
    .getAllByRole("option")
    .map((option) => {
      const title = option.querySelector("span.block.truncate.ui-caption.font-semibold");
      return (title?.textContent ?? "").trim();
    });
}

describe("TopbarContextAccountSelector", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sorts contexts by type then by name", async () => {
    const user = userEvent.setup();
    const contexts = [
      makeContext({ id: "conn-delta", kind: "connection", display_name: "Delta connection" }),
      makeContext({ id: "acc-zulu", kind: "account", display_name: "Zulu account" }),
      makeContext({ id: "legacy-echo", kind: "legacy_user", display_name: "Echo user" }),
      makeContext({ id: "acc-alpha", kind: "account", display_name: "Alpha account" }),
      makeContext({ id: "conn-charlie", kind: "connection", display_name: "Charlie connection" }),
      makeContext({ id: "legacy-bravo", kind: "legacy_user", display_name: "Bravo user" }),
    ];
    renderSelector({ contexts, selectedContextId: "acc-zulu" });

    const listbox = await openMenu(user);
    expect(visibleOptionLabels(listbox)).toEqual([
      "Alpha account",
      "Zulu account",
      "Bravo user · S3 user",
      "Echo user · S3 user",
      expect.stringContaining("Charlie connection · Connection"),
      expect.stringContaining("Delta connection · Connection"),
    ]);
  });

  it("uses id as deterministic tie-breaker when type, name and label are identical", async () => {
    const user = userEvent.setup();
    const onContextChange = vi.fn();
    const contexts = [
      makeContext({ id: "acc-2", kind: "account", display_name: "Twin" }),
      makeContext({ id: "acc-1", kind: "account", display_name: "Twin" }),
      makeContext({ id: "acc-3", kind: "account", display_name: "Twin" }),
    ];
    renderSelector({ contexts, selectedContextId: null, onContextChange });

    const listbox = await openMenu(user);
    const options = within(listbox).getAllByRole("option");
    await user.click(options[0]);

    expect(onContextChange).toHaveBeenCalledWith("acc-1");
  });

  it("keeps search filter behavior when context count is above threshold", async () => {
    const user = userEvent.setup();
    const contexts = [
      makeContext({ id: "acc-1", display_name: "Alpha" }),
      makeContext({ id: "acc-2", display_name: "Beta" }),
      makeContext({ id: "acc-3", display_name: "Gamma" }),
      makeContext({ id: "acc-4", display_name: "Delta" }),
      makeContext({ id: "acc-5", display_name: "Epsilon" }),
      makeContext({ id: "acc-6", display_name: "Zeta" }),
      makeContext({ id: "acc-7", display_name: "Filter target" }),
    ];
    renderSelector({ contexts, selectedContextId: "acc-1" });

    const listbox = await openMenu(user);
    const input = screen.getByPlaceholderText("Search account...");
    expect(input).toBeInTheDocument();

    await user.type(input, "f");
    await user.type(input, "ilter target");
    expect(visibleOptionLabels(listbox)).toEqual(["Filter target"]);
  });

  it("keeps search input hidden when context count is at or below threshold", async () => {
    const user = userEvent.setup();
    const contexts = [
      makeContext({ id: "acc-1", display_name: "Alpha" }),
      makeContext({ id: "acc-2", display_name: "Beta" }),
      makeContext({ id: "acc-3", display_name: "Gamma" }),
      makeContext({ id: "acc-4", display_name: "Delta" }),
      makeContext({ id: "acc-5", display_name: "Epsilon" }),
      makeContext({ id: "acc-6", display_name: "Zeta" }),
    ];
    renderSelector({ contexts, selectedContextId: "acc-1" });

    await openMenu(user);
    expect(screen.queryByPlaceholderText("Search account...")).not.toBeInTheDocument();
  });

  it("renders entity and endpoint tags when the selector preference is enabled", async () => {
    localStorage.setItem(SELECTOR_TAGS_PREFERENCE_KEY, "1");
    const user = userEvent.setup();
    renderSelector({
      contexts: [
        makeContext({
          id: "acc-1",
          display_name: "Alpha",
          tags: [
            { id: 1, label: "gold", color_key: "amber", scope: "standard" },
            { id: 2, label: "team-a", color_key: "blue", scope: "administrative" },
          ],
          endpoint_tags: [
            { id: 3, label: "ceph", color_key: "slate", scope: "standard" },
            { id: 4, label: "prod", color_key: "emerald", scope: "administrative" },
          ],
        }),
      ],
      selectedContextId: "acc-1",
    });

    const trigger = screen.getByRole("button", { name: "Select context account" });
    const valueSlot = trigger.querySelector('[data-slot="topbar-trigger-value"]');
    const addonSlot = trigger.querySelector('[data-slot="topbar-trigger-addon"]');
    expect(valueSlot).toHaveTextContent("Selected context");
    expect(addonSlot).toHaveTextContent("gold");
    expect(addonSlot).toHaveClass("items-center");
    expect(trigger).toHaveTextContent("gold");
    expect(trigger).toHaveTextContent("ceph");
    expect(trigger).not.toHaveTextContent("team-a");
    expect(trigger).not.toHaveTextContent("prod");
    const triggerGoldBadge = screen.getByText("gold").parentElement;
    expect(triggerGoldBadge).toHaveClass("bg-amber-50");
    expect(triggerGoldBadge).not.toHaveClass("bg-slate-50");

    const listbox = await openMenu(user);
    expect(within(listbox).getByText("gold")).toBeInTheDocument();
    expect(within(listbox).getByText("ceph")).toBeInTheDocument();
    expect(within(listbox).queryByText("team-a")).not.toBeInTheDocument();
    expect(within(listbox).queryByText("prod")).not.toBeInTheDocument();
  });
});
