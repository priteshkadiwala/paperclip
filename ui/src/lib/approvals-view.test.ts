import { describe, expect, it } from "vitest";
import type { Agent } from "@paperclipai/shared";
import {
  buildApprovalsFilterOptions,
  countActiveApprovalsFilters,
  filterApprovalsItems,
  groupApprovalsItems,
  itemAgentId,
  itemTypeLabel,
  sortApprovalsItems,
  type ApprovalsItem,
} from "./approvals-view";

const AGENT_A = "11111111-1111-1111-1111-111111111111";
const AGENT_B = "22222222-2222-2222-2222-222222222222";

const agentMap = new Map<string, Agent>([
  [AGENT_A, { id: AGENT_A, name: "Analyst" } as Agent],
  [AGENT_B, { id: AGENT_B, name: "Store Ops" } as Agent],
]);

function gate(
  id: string,
  kind: string,
  createdAt: string,
  identifier: string,
  assigneeAgentId: string | null,
): ApprovalsItem {
  return {
    kind: "interaction",
    id,
    createdAt,
    interaction: {
      id,
      kind,
      createdAt,
      issueId: `issue-${id}`,
      issue: { id: `issue-${id}`, identifier, title: `Task ${identifier}`, status: "in_review", assigneeAgentId },
    },
  } as unknown as ApprovalsItem;
}

const items = [
  gate("a", "request_confirmation", "2026-08-01T00:00:00.000Z", "MEL-1", AGENT_A),
  gate("b", "ask_user_questions", "2026-08-03T00:00:00.000Z", "MEL-2", AGENT_B),
  gate("c", "request_confirmation", "2026-08-02T00:00:00.000Z", "MEL-3", AGENT_A),
];

describe("approvals view state", () => {
  it("sorts waiting-longest first by default order", () => {
    expect(sortApprovalsItems(items, "oldest").map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(sortApprovalsItems(items, "newest").map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("does not mutate the input when sorting", () => {
    const before = items.map((i) => i.id);
    sortApprovalsItems(items, "newest");
    expect(items.map((i) => i.id)).toEqual(before);
  });

  it("filters by type and by agent, combining facets with AND", () => {
    expect(filterApprovalsItems(items, { types: ["request_confirmation"], agentIds: [] }).map((i) => i.id))
      .toEqual(["a", "c"]);
    expect(filterApprovalsItems(items, { types: [], agentIds: [AGENT_B] }).map((i) => i.id)).toEqual(["b"]);
    expect(filterApprovalsItems(items, { types: ["ask_user_questions"], agentIds: [AGENT_A] })).toEqual([]);
  });

  it("treats empty filter state as no filtering", () => {
    expect(filterApprovalsItems(items, { types: [], agentIds: [] })).toHaveLength(3);
    expect(countActiveApprovalsFilters({ types: [], agentIds: [] })).toBe(0);
    expect(countActiveApprovalsFilters({ types: ["x"], agentIds: [AGENT_A] })).toBe(2);
  });

  it("groups by agent, task, and type", () => {
    const byAgent = groupApprovalsItems(items, "agent", agentMap);
    expect(byAgent.map((g) => g.label)).toEqual(["Analyst", "Store Ops"]);
    expect(byAgent[0].items.map((i) => i.id)).toEqual(["a", "c"]);

    expect(groupApprovalsItems(items, "task", agentMap)).toHaveLength(3);

    const byType = groupApprovalsItems(items, "type", agentMap);
    expect(byType.map((g) => g.label).sort()).toEqual(["Confirmation", "Questions"]);
  });

  it("returns a single unlabelled group when grouping is off", () => {
    const groups = groupApprovalsItems(items, "none", agentMap);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(3);
  });

  it("builds filter options from the items present, resolving agent names", () => {
    const options = buildApprovalsFilterOptions(items, agentMap);
    expect(options.types.map(([, label]) => label)).toEqual(["Confirmation", "Questions"]);
    expect(options.agents.map(([, label]) => label)).toEqual(["Analyst", "Store Ops"]);
  });

  it("attributes a gate to the assignee of its task", () => {
    expect(itemAgentId(items[0])).toBe(AGENT_A);
    expect(itemTypeLabel(items[1])).toBe("Questions");
  });
});
