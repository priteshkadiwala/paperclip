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
import { PageTabBar } from "../components/PageTabBar";
import { Tabs } from "@/components/ui/tabs";
import { CircleDot, ShieldCheck } from "lucide-react";
import { ApprovalCard } from "../components/ApprovalCard";
import { IssueThreadInteractionCard } from "../components/IssueThreadInteractionCard";
import { PageSkeleton } from "../components/PageSkeleton";
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

export function Approvals() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const pathSegment = location.pathname.split("/").pop() ?? "pending";
  const statusFilter: StatusFilter = pathSegment === "all" ? "all" : "pending";
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Approvals" }]);
  }, [setBreadcrumbs]);

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

  const filtered = (data ?? [])
    .filter(
      (a) => statusFilter === "all" || a.status === "pending" || a.status === "revision_requested",
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const pendingCount = (data ?? []).filter(
    (a) => a.status === "pending" || a.status === "revision_requested",
  ).length + pendingInteractions.length;

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
              <span className={cn(
                "ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                "bg-yellow-500/20 text-yellow-500"
              )}>
                {pendingCount}
              </span>
            )}</> },
            { value: "all", label: "All" },
          ]} />
        </Tabs>
      </div>

      {error && <p className="text-sm text-destructive">{error.message}</p>}
      {actionError && <p className="text-sm text-destructive">{actionError}</p>}

      {pendingInteractions.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            Decisions waiting on you
          </h2>
          {pendingInteractions.map((interaction) => (
            <div key={interaction.id} className="rounded-lg border border-border/60 p-3 space-y-2">
              <Link
                to={`/issues/${interaction.issue.identifier ?? interaction.issueId}`}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <CircleDot className="h-3.5 w-3.5" />
                <span className="font-mono">{interaction.issue.identifier ?? ""}</span>
                <span className="truncate">{interaction.issue.title}</span>
              </Link>
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
          ))}
        </div>
      )}

      {filtered.length === 0 && pendingInteractions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <ShieldCheck className="h-8 w-8 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">
            {statusFilter === "pending" ? "No pending approvals." : "No approvals yet."}
          </p>
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid gap-3">
          {filtered.map((approval) => (
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
          ))}
        </div>
      )}
    </div>
  );
}
