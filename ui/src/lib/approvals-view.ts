import type { Agent, Approval, CompanyPendingInteraction } from "@paperclipai/shared";

/**
 * View state (filter / group / sort) for the Approvals page.
 *
 * The page merges two record types — agent decision gates (issue-thread
 * interactions) and formal company approvals (budget overrides, hiring) — so
 * the helpers below work on a small union rather than on either type directly.
 * Conventions deliberately mirror `lib/attention.ts` (option tuples, localStorage
 * keys, defensive load/save) so the two surfaces stay familiar to each other.
 */

export type ApprovalsItem =
  | { kind: "interaction"; id: string; createdAt: string | Date; interaction: CompanyPendingInteraction }
  | { kind: "approval"; id: string; createdAt: string | Date; approval: Approval };

export type ApprovalsGroupBy = "none" | "task" | "agent" | "type";
export type ApprovalsSortOrder = "newest" | "oldest";

export interface ApprovalsFilterState {
  types: string[];
  agentIds: string[];
}

export const APPROVALS_GROUP_BY_OPTIONS: ReadonlyArray<[ApprovalsGroupBy, string]> = [
  ["none", "No grouping"],
  ["task", "Task"],
  ["agent", "Agent"],
  ["type", "Type"],
];

export const APPROVALS_SORT_OPTIONS: ReadonlyArray<[ApprovalsSortOrder, string]> = [
  ["oldest", "Waiting longest"],
  ["newest", "Newest first"],
];

export const APPROVALS_GROUP_BY_KEY = "paperclip:approvals:group-by";
export const APPROVALS_SORT_KEY = "paperclip:approvals:sort";
export const APPROVALS_FILTERS_KEY_PREFIX = "paperclip:approvals:filters";

export const defaultApprovalsFilterState: ApprovalsFilterState = { types: [], agentIds: [] };

export function itemTypeKey(item: ApprovalsItem): string {
  return item.kind === "interaction" ? item.interaction.kind : `approval:${item.approval.type}`;
}

export function itemTypeLabel(item: ApprovalsItem): string {
  if (item.kind === "approval") return "Budget & hiring";
  switch (item.interaction.kind) {
    case "request_confirmation":
      return "Confirmation";
    case "request_checkbox_confirmation":
      return "Checklist confirmation";
    case "ask_user_questions":
      return "Questions";
    case "suggest_tasks":
      return "Suggested tasks";
    default:
      return item.interaction.kind;
  }
}

/**
 * Interactions do not record the agent that raised them (`createdByAgentId` is
 * null in practice), so attribute a gate to the assignee of its task — the agent
 * whose work is actually blocked, which is what a reader wants to filter on.
 */
export function itemAgentId(item: ApprovalsItem): string | null {
  return item.kind === "interaction"
    ? item.interaction.issue.assigneeAgentId ?? null
    : item.approval.requestedByAgentId ?? null;
}

export function itemTaskKey(item: ApprovalsItem): string | null {
  return item.kind === "interaction" ? item.interaction.issue.identifier ?? item.interaction.issueId : null;
}

export function buildApprovalsFilterOptions(
  items: ApprovalsItem[],
  agentMap: ReadonlyMap<string, Agent>,
): { types: Array<[string, string]>; agents: Array<[string, string]> } {
  const types = new Map<string, string>();
  const agents = new Map<string, string>();
  for (const item of items) {
    types.set(itemTypeKey(item), itemTypeLabel(item));
    const agentId = itemAgentId(item);
    if (agentId) agents.set(agentId, agentMap.get(agentId)?.name ?? agentId.slice(0, 8));
  }
  const byLabel = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1]);
  return { types: [...types].sort(byLabel), agents: [...agents].sort(byLabel) };
}

export function countActiveApprovalsFilters(filters: ApprovalsFilterState): number {
  return filters.types.length + filters.agentIds.length;
}

export function filterApprovalsItems(items: ApprovalsItem[], filters: ApprovalsFilterState): ApprovalsItem[] {
  return items.filter((item) => {
    if (filters.types.length > 0 && !filters.types.includes(itemTypeKey(item))) return false;
    if (filters.agentIds.length > 0) {
      const agentId = itemAgentId(item);
      if (!agentId || !filters.agentIds.includes(agentId)) return false;
    }
    return true;
  });
}

export function sortApprovalsItems(items: ApprovalsItem[], order: ApprovalsSortOrder): ApprovalsItem[] {
  return [...items].sort((a, b) => {
    const delta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return order === "oldest" ? delta : -delta;
  });
}

export function groupApprovalsItems(
  items: ApprovalsItem[],
  groupBy: ApprovalsGroupBy,
  agentMap: ReadonlyMap<string, Agent>,
): Array<{ key: string; label: string; items: ApprovalsItem[] }> {
  if (groupBy === "none") return [{ key: "all", label: "", items }];

  const groups = new Map<string, { key: string; label: string; items: ApprovalsItem[] }>();
  for (const item of items) {
    let key: string;
    let label: string;
    if (groupBy === "task") {
      key = itemTaskKey(item) ?? "no-task";
      label = item.kind === "interaction"
        ? `${item.interaction.issue.identifier ?? "Task"} · ${item.interaction.issue.title}`
        : "Not tied to a task";
    } else if (groupBy === "agent") {
      const agentId = itemAgentId(item);
      key = agentId ?? "no-agent";
      label = agentId ? agentMap.get(agentId)?.name ?? agentId.slice(0, 8) : "No agent";
    } else {
      key = itemTypeKey(item);
      label = itemTypeLabel(item);
    }
    const existing = groups.get(key);
    if (existing) existing.items.push(item);
    else groups.set(key, { key, label, items: [item] });
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}

function isApprovalsGroupBy(value: unknown): value is ApprovalsGroupBy {
  return value === "none" || value === "task" || value === "agent" || value === "type";
}

export function loadApprovalsGroupBy(): ApprovalsGroupBy {
  try {
    const raw = localStorage.getItem(APPROVALS_GROUP_BY_KEY);
    return isApprovalsGroupBy(raw) ? raw : "none";
  } catch {
    return "none";
  }
}

export function saveApprovalsGroupBy(groupBy: ApprovalsGroupBy) {
  try {
    localStorage.setItem(APPROVALS_GROUP_BY_KEY, groupBy);
  } catch {
    // Ignore localStorage failures.
  }
}

export function loadApprovalsSortOrder(): ApprovalsSortOrder {
  try {
    const raw = localStorage.getItem(APPROVALS_SORT_KEY);
    return raw === "newest" ? "newest" : "oldest";
  } catch {
    return "oldest";
  }
}

export function saveApprovalsSortOrder(order: ApprovalsSortOrder) {
  try {
    localStorage.setItem(APPROVALS_SORT_KEY, order);
  } catch {
    // Ignore localStorage failures.
  }
}

export function loadApprovalsFilters(companyId: string | null | undefined): ApprovalsFilterState {
  if (!companyId) return { ...defaultApprovalsFilterState };
  try {
    const raw = localStorage.getItem(`${APPROVALS_FILTERS_KEY_PREFIX}:${companyId}`);
    if (!raw) return { ...defaultApprovalsFilterState };
    const parsed = JSON.parse(raw) as Partial<ApprovalsFilterState>;
    return {
      types: Array.isArray(parsed.types) ? parsed.types.filter((v): v is string => typeof v === "string") : [],
      agentIds: Array.isArray(parsed.agentIds) ? parsed.agentIds.filter((v): v is string => typeof v === "string") : [],
    };
  } catch {
    return { ...defaultApprovalsFilterState };
  }
}

export function saveApprovalsFilters(companyId: string | null | undefined, filters: ApprovalsFilterState) {
  if (!companyId) return;
  try {
    localStorage.setItem(`${APPROVALS_FILTERS_KEY_PREFIX}:${companyId}`, JSON.stringify(filters));
  } catch {
    // Ignore localStorage failures.
  }
}
