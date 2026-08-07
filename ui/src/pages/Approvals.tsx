import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useLocation } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { approvalsApi } from "../api/approvals";
import { agentsApi } from "../api/agents";
import { authApi } from "../api/auth";
import { issuesApi } from "../api/issues";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/timeAgo";
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { ArrowUpDown, Check, CircleDot, Layers, ListFilter, ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { IssueThreadInteractionCard } from "../components/IssueThreadInteractionCard";
import { IssueGroupHeader } from "../components/IssueGroupHeader";
import { PageSkeleton } from "../components/PageSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  APPROVALS_GROUP_BY_OPTIONS,
  APPROVALS_SORT_OPTIONS,
  buildApprovalsFilterOptions,
  countActiveApprovalsFilters,
  defaultApprovalsFilterState,
  filterApprovalsItems,
  groupApprovalsItems,
  loadApprovalsFilters,
  loadApprovalsGroupBy,
  loadApprovalsSortOrder,
  saveApprovalsFilters,
  saveApprovalsGroupBy,
  saveApprovalsSortOrder,
  sortApprovalsItems,
  type ApprovalsFilterState,
  type ApprovalsGroupBy,
  type ApprovalsItem,
  type ApprovalsSortOrder,
} from "../lib/approvals-view";
import type {
  AskUserQuestionsAnswer,
  AskUserQuestionsInteraction,
  IssueThreadInteraction,
} from "../lib/issue-thread-interactions";

type StatusFilter = "pending" | "all";

type ActionableInteraction = Extract<
  IssueThreadInteraction,
  { kind: "suggest_tasks" | "request_confirmation" | "request_checkbox_confirmation" }
>;

function FilterMenu({
  options,
  filters,
  onChange,
}: {
  options: { types: Array<[string, string]>; agents: Array<[string, string]> };
  filters: ApprovalsFilterState;
  onChange: (next: ApprovalsFilterState) => void;
}) {
  const toggle = (facet: "types" | "agentIds", value: string) => {
    const current = filters[facet];
    onChange({
      ...filters,
      [facet]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    });
  };

  const section = (
    label: string,
    facet: "types" | "agentIds",
    entries: Array<[string, string]>,
  ) => (
    entries.length > 0 ? (
      <div className="space-y-1">
        <p className="px-2 text-(length:--text-nano) font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {entries.map(([value, entryLabel]) => (
          <label
            key={value}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent/50"
          >
            <Checkbox
              checked={filters[facet].includes(value)}
              onCheckedChange={() => toggle(facet, value)}
            />
            <span className="truncate">{entryLabel}</span>
          </label>
        ))}
      </div>
    ) : null
  );

  const hasAny = options.types.length > 0 || options.agents.length > 0;

  return (
    <div className="max-h-80 space-y-2 overflow-y-auto p-2">
      {hasAny ? (
        <>
          {section("Type", "types", options.types)}
          {section("Agent", "agentIds", options.agents)}
          {countActiveApprovalsFilters(filters) > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground"
              onClick={() => onChange({ ...defaultApprovalsFilterState })}
            >
              Clear filters
            </Button>
          )}
        </>
      ) : (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing to filter yet.</p>
      )}
    </div>
  );
}

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<ApprovalsGroupBy>(() => loadApprovalsGroupBy());
  const [sortOrder, setSortOrder] = useState<ApprovalsSortOrder>(() => loadApprovalsSortOrder());
  const [filters, setFilters] = useState<ApprovalsFilterState>(defaultApprovalsFilterState);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

  // Filters are per-company; reload them whenever the active company changes.
  useEffect(() => {
    setFilters(loadApprovalsFilters(selectedCompanyId));
    setCollapsedGroups(new Set());
  }, [selectedCompanyId]);

  const updateFilters = (next: ApprovalsFilterState) => {
    setFilters(next);
    saveApprovalsFilters(selectedCompanyId, next);
  };
  const updateGroupBy = (next: ApprovalsGroupBy) => {
    setGroupBy(next);
    saveApprovalsGroupBy(next);
  };
  const updateSortOrder = (next: ApprovalsSortOrder) => {
    setSortOrder(next);
    saveApprovalsSortOrder(next);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.approvals.list(selectedCompanyId!),
    queryFn: () => approvalsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: session } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
  });
  const currentUserId = session?.user.id ?? session?.session.userId ?? null;

  const { data: pendingInteractions = [] } = useQuery({
    queryKey: queryKeys.approvals.companyInteractions(selectedCompanyId!),
    queryFn: () => issuesApi.listCompanyPendingInteractions(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.id, agent])),
    [agents],
  );

  const invalidateInteractionQueries = (issueId: string) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.approvals.companyInteractions(selectedCompanyId!),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.issues.interactions(issueId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(selectedCompanyId!) });
  };

  const acceptInteractionMutation = useMutation({
    mutationFn: (interaction: ActionableInteraction) =>
      issuesApi.acceptInteraction(interaction.issueId, interaction.id),
    onSuccess: (_result, interaction) => {
      setActionError(null);
      invalidateInteractionQueries(interaction.issueId);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to accept");
    },
  });

  const rejectInteractionMutation = useMutation({
    mutationFn: ({ interaction, reason }: { interaction: ActionableInteraction; reason?: string }) =>
      issuesApi.rejectInteraction(interaction.issueId, interaction.id, reason),
    onSuccess: (_result, { interaction }) => {
      setActionError(null);
      invalidateInteractionQueries(interaction.issueId);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const answerInteractionMutation = useMutation({
    mutationFn: ({
      interaction,
      answers,
    }: {
      interaction: AskUserQuestionsInteraction;
      answers: AskUserQuestionsAnswer[];
    }) => issuesApi.respondToInteraction(interaction.issueId, interaction.id, { answers }),
    onSuccess: (_result, { interaction }) => {
      setActionError(null);
      invalidateInteractionQueries(interaction.issueId);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to submit answers");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.approve(id),
    onSuccess: (_approval, id) => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
      navigate(`/approvals/${id}?resolved=approved`);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to approve");
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => approvalsApi.reject(id),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.list(selectedCompanyId!) });
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to reject");
    },
  });

  const visibleApprovals = (data ?? []).filter(
    (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
  );

  // One list so filter/group/sort treat gates and formal approvals alike.
  const allItems = useMemo<ApprovalsItem[]>(() => [
    ...pendingInteractions.map((interaction) => ({
      kind: "interaction" as const,
      id: interaction.id,
      createdAt: interaction.createdAt,
      interaction,
    })),
    ...visibleApprovals.map((approval) => ({
      kind: "approval" as const,
      id: approval.id,
      createdAt: approval.createdAt,
      approval,
    })),
  ], [pendingInteractions, visibleApprovals]);

  const filterOptions = useMemo(
    () => buildApprovalsFilterOptions(allItems, agentMap),
    [allItems, agentMap],
  );
  const groups = useMemo(
    () => groupApprovalsItems(sortApprovalsItems(filterApprovalsItems(allItems, filters), sortOrder), groupBy, agentMap),
    [allItems, filters, sortOrder, groupBy, agentMap],
  );
  const visibleCount = groups.reduce((total, group) => total + group.items.length, 0);
  const activeFilterCount = countActiveApprovalsFilters(filters);

  const pendingCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length + pendingInteractions.length;

  const renderItem = (item: ApprovalsItem) => {
    if (item.kind === "approval") {
      const approval = item.approval;
      return (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          requesterAgent={approval.requestedByAgentId ? (agents ?? []).find((a) => a.id === approval.requestedByAgentId) ?? null : null}
          onApprove={() => approveMutation.mutate(approval.id)}
          onReject={() => rejectMutation.mutate(approval.id)}
          detailLink={`/approvals/${approval.id}`}
          isPending={approveMutation.isPending || rejectMutation.isPending}
          pendingAction={
            approveMutation.isPending ? "approve" : rejectMutation.isPending ? "reject" : null
          }
        />
      );
    }

    const interaction = item.interaction;
    return (
      <div key={interaction.id} className="min-w-0 rounded-lg border border-border/60 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/issues/${interaction.issue.identifier ?? interaction.issueId}`}
            className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <CircleDot className="h-3.5 w-3.5 shrink-0" />
            <span className="font-mono">{interaction.issue.identifier ?? ""}</span>
            <span className="truncate">{interaction.issue.title}</span>
          </Link>
          <span className="shrink-0 text-xs text-muted-foreground" title={new Date(interaction.createdAt).toLocaleString()}>
            {timeAgo(interaction.createdAt)}
          </span>
        </div>
        <IssueThreadInteractionCard
          interaction={interaction}
          agentMap={agentMap}
          currentUserId={currentUserId}
          onAcceptInteraction={(target) => acceptInteractionMutation.mutateAsync(target as ActionableInteraction).then(() => undefined)}
          onRejectInteraction={(target, reason) =>
            rejectInteractionMutation.mutateAsync({ interaction: target as ActionableInteraction, reason }).then(() => undefined)
          }
          onSubmitInteractionAnswers={(target, answers) =>
            answerInteractionMutation.mutateAsync({ interaction: target, answers }).then(() => undefined)
          }
        />
      </div>
    );
  };

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  if (isLoading) {
    return <PageSkeleton variant="approvals" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Tabs value={statusFilter} onValueChange={(v) => navigate(`/approvals/${v}`)}>
          <PageTabBar items={[
            { value: "pending", label: <>Pending{pendingCount > 0 && (
              <Badge variant="ghost" className={cn(
                "ml-1.5 px-1.5 text-(length:--text-nano)",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {pendingCount}
              </Badge>
            )}</> },
            { value: "all", label: "All" },
          ]} />
        </Tabs>

        <div className="flex items-center gap-2">
          {visibleCount > 0 && (
            <span className="text-sm text-muted-foreground">
              {visibleCount} {visibleCount === 1 ? "item" : "items"}
            </span>
          )}
          {/* Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("h-8 w-8 shrink-0", activeFilterCount > 0 && "bg-accent")}
                title="Filter"
                aria-label="Filter"
              >
                <ListFilter className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-0">
              <FilterMenu options={filterOptions} filters={filters} onChange={updateFilters} />
            </PopoverContent>
          </Popover>
          {/* Group by */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("h-8 w-8 shrink-0", groupBy !== "none" && "bg-accent")}
                title="Group"
                aria-label="Group"
              >
                <Layers className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-2">
              <div className="space-y-0.5">
                {APPROVALS_GROUP_BY_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm",
                      groupBy === value ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50",
                    )}
                    onClick={() => updateGroupBy(value)}
                  >
                    <span>{label}</span>
                    {groupBy === value ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0"
                title="Sort"
                aria-label="Sort"
              >
                <ArrowUpDown className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-44 p-2">
              <div className="space-y-0.5">
                {APPROVALS_SORT_OPTIONS.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm",
                      sortOrder === value ? "bg-accent/50 text-foreground" : "text-muted-foreground hover:bg-accent/50",
                    )}
                    onClick={() => updateSortOrder(value)}
                  >
                    <span>{label}</span>
                    {sortOrder === value ? <Check className="h-3.5 w-3.5" /> : null}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {visibleCount === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {activeFilterCount > 0
              ? "Nothing matches these filters."
              : statusFilter === "pending"
                ? "No pending approvals."
                : "No approvals yet."}
          </p>
          {activeFilterCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 text-muted-foreground"
              onClick={() => updateFilters({ ...defaultApprovalsFilterState })}
            >
              Clear filters
            </Button>
          )}
        </div>
      )}

      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.key);
        return (
          <div key={group.key} className="space-y-3">
            {groupBy !== "none" && (
              <IssueGroupHeader
                label={group.label}
                collapsible
                collapsed={collapsed}
                onToggle={() =>
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
                trailing={<span className="text-xs text-muted-foreground">{group.items.length}</span>}
              />
            )}
            {/* min-w-0 on both track and item: grid children default to
                min-width:auto and would otherwise refuse to shrink below the
                width of a long task title, scrolling the whole page sideways. */}
            {!collapsed && <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">{group.items.map(renderItem)}</div>}
          </div>
        );
      })}
    </div>
  );
}
