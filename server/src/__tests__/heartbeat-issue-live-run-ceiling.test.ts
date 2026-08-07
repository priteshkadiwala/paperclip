import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  agentRuntimeState,
  agentWakeupRequests,
  companies,
  companySkills,
  createDb,
  environmentLeases,
  environments,
  heartbeatRunEvents,
  heartbeatRuns,
  issueComments,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { heartbeatService } from "../services/heartbeat.ts";
import { runningProcesses } from "../adapters/index.ts";

const mockAdapterExecute = vi.hoisted(() =>
  vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    errorMessage: null,
    summary: "Live-run ceiling test run.",
    provider: "test",
    model: "test-model",
  })),
);

vi.mock("../adapters/index.ts", async () => {
  const actual = await vi.importActual<typeof import("../adapters/index.ts")>("../adapters/index.ts");
  return {
    ...actual,
    getServerAdapter: vi.fn(() => ({
      supportsLocalAgentJwt: false,
      execute: mockAdapterExecute,
    })),
  };
});

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres live-run ceiling tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("heartbeat issue live-run ceiling", () => {
  let db!: ReturnType<typeof createDb>;
  let heartbeat!: ReturnType<typeof heartbeatService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-live-run-ceiling-");
    db = createDb(tempDb.connectionString);
    heartbeat = heartbeatService(db);
  }, 20_000);

  afterEach(async () => {
    const runIds = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .then((runs) => runs.map((run) => run.id));
    await Promise.all(runIds.map((runId) => heartbeat.waitForRunExecutionDrain(runId)));
    runningProcesses.clear();
    await db.delete(environmentLeases);
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(heartbeatRunEvents);
    await db.delete(heartbeatRuns);
    await db.delete(agentWakeupRequests);
    await db.delete(agentRuntimeState);
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(environments);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await db.transaction(async (tx) => {
          await tx.delete(companySkills);
          await tx.delete(companies);
        });
        break;
      } catch (error) {
        if (attempt === 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAgentOnIssue(options: { maxConcurrentRuns?: number } = {}) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "StoreOps",
      role: "engineer",
      status: "active",
      adapterType: "codex_local",
      adapterConfig: {},
      runtimeConfig: {
        heartbeat: { wakeOnDemand: true, maxConcurrentRuns: options.maxConcurrentRuns ?? 8 },
      },
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Launch preconditions",
      status: "in_progress",
      priority: "medium",
      assigneeAgentId: agentId,
      responsibleUserId: "responsible-user",
    });

    return { companyId, agentId, issueId };
  }

  async function insertRunningSibling(
    seed: { companyId: string; agentId: string; issueId: string },
    options: { lastOutputAt: Date | null },
  ) {
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: seed.companyId,
      agentId: seed.agentId,
      status: "running",
      invocationSource: "automation",
      triggerDetail: "system",
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      processStartedAt: new Date(Date.now() - 5 * 60 * 1000),
      lastOutputAt: options.lastOutputAt,
      contextSnapshot: { issueId: seed.issueId, wakeReason: "issue_commented" },
    });
    return runId;
  }

  async function wakeOnIssue(seed: { agentId: string; issueId: string }) {
    return heartbeat.wakeup(seed.agentId, {
      source: "automation",
      triggerDetail: "system",
      reason: "issue_commented",
      payload: { issueId: seed.issueId },
      contextSnapshot: { issueId: seed.issueId, wakeReason: "issue_commented" },
    });
  }

  it("holds a wake back when the agent already has the ceiling of live runs on the issue", async () => {
    const seed = await seedAgentOnIssue();
    // Untracked by this process (no runningProcesses entry) but still emitting
    // output — the shape that let the MEL-56 burst through the coalescer.
    await insertRunningSibling(seed, { lastOutputAt: new Date() });
    await insertRunningSibling(seed, { lastOutputAt: new Date() });

    const wake = await wakeOnIssue(seed);
    expect(wake).toBeNull();

    const wakeRequests = await db
      .select({
        status: agentWakeupRequests.status,
        reason: agentWakeupRequests.reason,
        payload: agentWakeupRequests.payload,
      })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, seed.agentId));

    expect(wakeRequests).toHaveLength(1);
    expect(wakeRequests[0]?.status).toBe("skipped");
    expect(wakeRequests[0]?.reason).toBe("issue_live_run_ceiling");
    expect((wakeRequests[0]?.payload as { heartbeatSkip?: { liveRunCount?: number } })?.heartbeatSkip)
      .toMatchObject({ liveRunCount: 2, ceiling: 2 });

    const runCount = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, seed.agentId));
    expect(runCount).toHaveLength(2);
  });

  it("ignores long-silent runs so stale rows cannot leave an issue permanently deaf", async () => {
    const seed = await seedAgentOnIssue();
    const staleAt = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await insertRunningSibling(seed, { lastOutputAt: staleAt });
    await insertRunningSibling(seed, { lastOutputAt: staleAt });

    await wakeOnIssue(seed);

    const ceilingSkips = await db
      .select({ reason: agentWakeupRequests.reason })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, seed.agentId))
      .then((rows) => rows.filter((row) => row.reason === "issue_live_run_ceiling"));
    expect(ceilingSkips).toHaveLength(0);
  });

  it("folds a wake into an already-queued run instead of starting a second one", async () => {
    // maxConcurrentRuns 1 plus a live run keeps the queued sibling from being
    // claimed mid-test, so the merge branch is exercised deterministically.
    const seed = await seedAgentOnIssue({ maxConcurrentRuns: 1 });
    await insertRunningSibling(seed, { lastOutputAt: new Date() });

    const queuedRunId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: queuedRunId,
      companyId: seed.companyId,
      agentId: seed.agentId,
      status: "queued",
      invocationSource: "automation",
      triggerDetail: "system",
      contextSnapshot: { issueId: seed.issueId, wakeReason: "issue_commented" },
    });

    await wakeOnIssue(seed);

    const coalesced = await db
      .select({
        status: agentWakeupRequests.status,
        reason: agentWakeupRequests.reason,
        runId: agentWakeupRequests.runId,
      })
      .from(agentWakeupRequests)
      .where(eq(agentWakeupRequests.agentId, seed.agentId));

    expect(coalesced).toHaveLength(1);
    expect(coalesced[0]?.status).toBe("coalesced");
    expect(coalesced[0]?.runId).toBe(queuedRunId);

    // The running sibling and the queued run, and nothing new.
    const runs = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(eq(heartbeatRuns.agentId, seed.agentId));
    expect(runs).toHaveLength(2);
  });
});
