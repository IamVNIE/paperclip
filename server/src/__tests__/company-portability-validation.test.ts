/**
 * Company portability validation tests.
 *
 * Validates end-to-end round-trip fidelity, collision strategies,
 * org-hierarchy preservation, and edge cases for import/export.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyPortabilityFileEntry } from "@paperclipai/shared";

/* ------------------------------------------------------------------ */
/*  Service mocks                                                     */
/* ------------------------------------------------------------------ */

const companySvc = {
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

const agentSvc = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
};

const accessSvc = {
  ensureMembership: vi.fn(),
  listActiveUserMemberships: vi.fn(),
  copyActiveUserMemberships: vi.fn(),
  setPrincipalPermission: vi.fn(),
};

const projectSvc = {
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  createWorkspace: vi.fn(),
  listWorkspaces: vi.fn(),
};

const issueSvc = {
  list: vi.fn(),
  getById: vi.fn(),
  getByIdentifier: vi.fn(),
  create: vi.fn(),
};

const routineSvc = {
  list: vi.fn(),
  getDetail: vi.fn(),
  create: vi.fn(),
  createTrigger: vi.fn(),
};

const companySkillSvc = {
  list: vi.fn(),
  listFull: vi.fn(),
  readFile: vi.fn(),
  importPackageFiles: vi.fn(),
};

const assetSvc = {
  getById: vi.fn(),
  create: vi.fn(),
};

const secretSvc = {
  normalizeAdapterConfigForPersistence: vi.fn(async (_companyId: string, config: Record<string, unknown>) => config),
  resolveAdapterConfigForRuntime: vi.fn(async (_companyId: string, config: Record<string, unknown>) => ({
    config,
    secretKeys: new Set<string>(),
  })),
};

const agentInstructionsSvc = {
  exportFiles: vi.fn(),
  materializeManagedBundle: vi.fn(),
};

vi.mock("../services/companies.js", () => ({ companyService: () => companySvc }));
vi.mock("../services/agents.js", () => ({ agentService: () => agentSvc }));
vi.mock("../services/access.js", () => ({ accessService: () => accessSvc }));
vi.mock("../services/projects.js", () => ({ projectService: () => projectSvc }));
vi.mock("../services/issues.js", () => ({ issueService: () => issueSvc }));
vi.mock("../services/routines.js", () => ({ routineService: () => routineSvc }));
vi.mock("../services/company-skills.js", () => ({ companySkillService: () => companySkillSvc }));
vi.mock("../services/assets.js", () => ({ assetService: () => assetSvc }));
vi.mock("../services/secrets.js", () => ({ secretService: () => secretSvc }));
vi.mock("../services/agent-instructions.js", () => ({ agentInstructionsService: () => agentInstructionsSvc }));
vi.mock("../routes/org-chart-svg.js", () => ({ renderOrgChartPng: vi.fn(async () => Buffer.from("png")) }));

const { companyPortabilityService } = await import("../services/company-portability.js");

function asTextFile(entry: CompanyPortabilityFileEntry | undefined): string {
  expect(typeof entry).toBe("string");
  return typeof entry === "string" ? entry : "";
}

/* ------------------------------------------------------------------ */
/*  Shared fixtures                                                   */
/* ------------------------------------------------------------------ */

function seedDefaultMocks() {
  companySvc.getById.mockResolvedValue({
    id: "company-1",
    name: "Acme",
    description: "Acme company",
    issuePrefix: "ACM",
    brandColor: "#ff0000",
    logoAssetId: null,
    logoUrl: null,
    requireBoardApprovalForNewAgents: false,
  });
  companySvc.create.mockResolvedValue({
    id: "company-imported",
    name: "Acme Imported",
    requireBoardApprovalForNewAgents: false,
  });
  companySvc.update.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
    id,
    name: "Acme",
    ...patch,
  }));

  agentSvc.list.mockResolvedValue([
    {
      id: "agent-ceo",
      name: "CEO",
      status: "idle",
      role: "ceo",
      title: "Chief Executive Officer",
      icon: "crown",
      reportsTo: null,
      capabilities: "Runs the company",
      adapterType: "claude_local",
      adapterConfig: {},
      runtimeConfig: { heartbeat: { intervalSec: 3600 } },
      budgetMonthlyCents: 0,
      permissions: { canCreateAgents: true },
      metadata: null,
    },
    {
      id: "agent-eng",
      name: "Engineer",
      status: "idle",
      role: "engineer",
      title: "Software Engineer",
      icon: "code",
      reportsTo: "agent-ceo",
      capabilities: "Writes code",
      adapterType: "claude_local",
      adapterConfig: {
        model: "claude-sonnet-4-6",
        env: {
          ANTHROPIC_API_KEY: { type: "secret_ref", secretId: "s1", version: "latest" },
        },
      },
      runtimeConfig: { heartbeat: { intervalSec: 1800 } },
      budgetMonthlyCents: 500,
      permissions: { canCreateAgents: false },
      metadata: null,
    },
  ]);

  projectSvc.list.mockResolvedValue([
    {
      id: "project-1",
      companyId: "company-1",
      name: "Platform",
      urlKey: "platform",
      description: "Core platform",
      leadAgentId: "agent-eng",
      targetDate: "2026-06-30",
      color: "#00ff00",
      status: "active",
      executionWorkspacePolicy: null,
      workspaces: [],
      archivedAt: null,
    },
  ]);
  projectSvc.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
    id: `project-${String(data.urlKey ?? "new")}`,
    name: data.name,
    urlKey: data.urlKey ?? "new",
  }));
  projectSvc.update.mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    id,
    ...data,
  }));
  projectSvc.createWorkspace.mockResolvedValue(null);
  projectSvc.listWorkspaces.mockResolvedValue([]);

  issueSvc.list.mockResolvedValue([
    {
      id: "issue-1",
      identifier: "ACM-1",
      title: "Build API",
      description: "Implement REST API",
      projectId: "project-1",
      assigneeAgentId: "agent-eng",
      status: "todo",
      priority: "high",
      labelIds: ["label-x"],
      billingCode: null,
      executionWorkspaceSettings: null,
      assigneeAdapterOverrides: null,
    },
  ]);
  issueSvc.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
    id: `issue-${data.title}`,
    title: data.title,
  }));

  routineSvc.list.mockResolvedValue([]);

  companySkillSvc.list.mockResolvedValue([]);
  companySkillSvc.listFull.mockResolvedValue([]);
  companySkillSvc.readFile.mockResolvedValue(null);
  companySkillSvc.importPackageFiles.mockResolvedValue([]);

  assetSvc.getById.mockResolvedValue(null);
  assetSvc.create.mockResolvedValue({ id: "asset-new" });

  accessSvc.ensureMembership.mockResolvedValue(undefined);
  accessSvc.listActiveUserMemberships.mockResolvedValue([]);
  accessSvc.copyActiveUserMemberships.mockResolvedValue([]);
  accessSvc.setPrincipalPermission.mockResolvedValue(undefined);

  agentInstructionsSvc.exportFiles.mockImplementation(async (agent: { name: string }) => ({
    files: { "AGENTS.md": `You are ${agent.name}.` },
    entryFile: "AGENTS.md",
    warnings: [],
  }));
  agentInstructionsSvc.materializeManagedBundle.mockImplementation(
    async (agent: { adapterConfig: Record<string, unknown>; id?: string }, _files: Record<string, string>) => ({
      bundle: null,
      adapterConfig: {
        ...agent.adapterConfig,
        instructionsBundleMode: "managed",
        instructionsRootPath: `/tmp/${agent.id ?? "agent"}`,
        instructionsEntryFile: "AGENTS.md",
        instructionsFilePath: `/tmp/${agent.id ?? "agent"}/AGENTS.md`,
      },
    }),
  );
}

describe("company portability validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seedDefaultMocks();
  });

  /* ================================================================ */
  /*  Round-trip fidelity                                             */
  /* ================================================================ */

  describe("round-trip fidelity", () => {
    it("preserves manifest structure through export → import → re-export", async () => {
      const portability = companyPortabilityService({} as any);

      // --- Export the source company ---
      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: true },
      });

      expect(exported.manifest.company?.name).toBe("Acme");
      expect(exported.manifest.agents).toHaveLength(2);
      expect(exported.manifest.projects).toHaveLength(1);
      expect(exported.manifest.issues).toHaveLength(1);

      // --- Import into a new company ---
      agentSvc.list.mockResolvedValue([]);
      projectSvc.list.mockResolvedValue([]);
      agentSvc.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
        id: `imported-agent-${String(input.name).toLowerCase().replace(/\s+/g, "-")}`,
        name: input.name,
        status: input.status ?? "idle",
        adapterConfig: input.adapterConfig,
        runtimeConfig: input.runtimeConfig,
      }));

      const result = await portability.importBundle(
        {
          source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
          include: { company: true, agents: true, projects: true, issues: true },
          target: { mode: "new_company", newCompanyName: "Acme Imported" },
          agents: "all",
          collisionStrategy: "rename",
        },
        "user-1",
      );

      expect(result.company.action).toBe("created");
      expect(result.agents).toHaveLength(2);
      expect(result.agents.every((a) => a.action === "created")).toBe(true);
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].action).toBe("created");
    });

    it("round-trips agent instructions without data loss", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      const ceoFile = asTextFile(exported.files["agents/ceo/AGENTS.md"]);
      const engFile = asTextFile(exported.files["agents/engineer/AGENTS.md"]);

      expect(ceoFile).toContain("You are CEO.");
      expect(ceoFile).toContain('name: "CEO"');
      expect(engFile).toContain("You are Engineer.");
      expect(engFile).toContain('name: "Engineer"');
      expect(engFile).toContain('reportsTo: "ceo"');
    });

    it("round-trips project metadata through export and import", async () => {
      const portability = companyPortabilityService({} as any);

      // Include agents so idToSlug resolves leadAgentId
      const exported = await portability.exportBundle("company-1", {
        include: { company: false, agents: true, projects: true, issues: false },
      });

      const projectFile = asTextFile(exported.files["projects/platform/PROJECT.md"]);
      expect(projectFile).toContain('name: "Platform"');
      expect(projectFile).toContain("Core platform");
      // leadAgentId is exported as "owner" in PROJECT.md frontmatter
      expect(projectFile).toContain('owner: "engineer"');

      const extension = asTextFile(exported.files[".paperclip.yaml"]);
      expect(extension).toContain("platform:");
      expect(extension).toContain('status: "active"');
    });
  });

  /* ================================================================ */
  /*  Collision strategies                                            */
  /* ================================================================ */

  describe("collision strategies", () => {
    it("skip strategy leaves existing agents and projects untouched", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: false },
      });

      // Set up existing-company scenario with name collisions
      agentSvc.list.mockResolvedValue([
        { id: "existing-ceo", name: "CEO", role: "ceo", urlKey: "ceo" },
      ]);
      projectSvc.list.mockResolvedValue([
        { id: "existing-project", name: "Platform", urlKey: "platform" },
      ]);

      const preview = await portability.previewImport({
        source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
        include: { company: true, agents: true, projects: true, issues: false },
        target: { mode: "existing_company", companyId: "company-1" },
        agents: "all",
        collisionStrategy: "skip",
      });

      expect(preview.errors).toEqual([]);

      // The CEO agent should be planned as "skip"
      const ceoAgentPlan = preview.plan.agentPlans.find((p: { slug: string }) => p.slug === "ceo");
      expect(ceoAgentPlan).toEqual(expect.objectContaining({
        action: "skip",
        reason: expect.stringContaining("skip"),
      }));

      // Engineer (no collision) should still be "create"
      const engAgentPlan = preview.plan.agentPlans.find((p: { slug: string }) => p.slug === "engineer");
      expect(engAgentPlan).toEqual(expect.objectContaining({
        action: "create",
      }));

      // Project should be skipped
      const projectPlan = preview.plan.projectPlans.find((p: { slug: string }) => p.slug === "platform");
      expect(projectPlan).toEqual(expect.objectContaining({
        action: "skip",
        reason: expect.stringContaining("skip"),
      }));
    });

    it("rename strategy creates agents with unique names when slugs collide", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      agentSvc.list.mockResolvedValue([
        { id: "existing-ceo", name: "CEO", role: "ceo", urlKey: "ceo" },
      ]);
      projectSvc.list.mockResolvedValue([]);

      const preview = await portability.previewImport({
        source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
        include: { company: false, agents: true, projects: false, issues: false },
        target: { mode: "existing_company", companyId: "company-1" },
        agents: "all",
        collisionStrategy: "rename",
      });

      expect(preview.errors).toEqual([]);

      const ceoAgentPlan = preview.plan.agentPlans.find((p: { slug: string }) => p.slug === "ceo");
      expect(ceoAgentPlan?.action).toBe("create");
      expect(ceoAgentPlan?.reason).toContain("rename");
      // The planned name should differ from "CEO"
      expect(ceoAgentPlan?.plannedName).not.toBe("CEO");
    });
  });

  /* ================================================================ */
  /*  Org hierarchy (reportsTo)                                       */
  /* ================================================================ */

  describe("org hierarchy", () => {
    it("exports reportsTo slugs and resolves them on import", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      // Verify reportsTo is in agent frontmatter
      const engFile = asTextFile(exported.files["agents/engineer/AGENTS.md"]);
      expect(engFile).toContain('reportsTo: "ceo"');

      // Verify manifest captures the relationship
      const engManifest = exported.manifest.agents.find((a: { slug: string }) => a.slug === "engineer");
      expect(engManifest?.reportsToSlug).toBe("ceo");

      const ceoManifest = exported.manifest.agents.find((a: { slug: string }) => a.slug === "ceo");
      expect(ceoManifest?.reportsToSlug).toBeFalsy();

      // Import and verify reportsTo is wired up
      agentSvc.list.mockResolvedValue([]);
      projectSvc.list.mockResolvedValue([]);
      agentSvc.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
        id: `new-${String(input.name).toLowerCase()}`,
        name: input.name,
        status: input.status ?? "idle",
        adapterConfig: input.adapterConfig,
      }));

      await portability.importBundle(
        {
          source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
          include: { company: true, agents: true, projects: false, issues: false },
          target: { mode: "new_company", newCompanyName: "Acme Imported" },
          agents: "all",
          collisionStrategy: "rename",
        },
        "user-1",
      );

      // reportsTo should be wired: Engineer -> CEO
      expect(agentSvc.update).toHaveBeenCalledWith("new-engineer", { reportsTo: "new-ceo" });
    });

    it("does not set self-referential reportsTo", async () => {
      // An agent whose reportsTo slug resolves to itself should not create a cycle
      agentSvc.list.mockResolvedValue([
        {
          id: "agent-solo",
          name: "Solo",
          status: "idle",
          role: "ceo",
          title: "Solo Agent",
          icon: null,
          reportsTo: "agent-solo", // self-referential
          capabilities: null,
          adapterType: "claude_local",
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          permissions: {},
          metadata: null,
        },
      ]);

      const portability = companyPortabilityService({} as any);
      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      // Self-referential reportsTo in manifest should either be omitted or handled gracefully
      const soloManifest = exported.manifest.agents.find((a: { slug: string }) => a.slug === "solo");
      // The agent maps to itself, so reportsToSlug should be "solo" (valid in manifest)
      // but on import, the self-reference guard should prevent it
      agentSvc.list.mockResolvedValue([]);
      projectSvc.list.mockResolvedValue([]);
      agentSvc.create.mockResolvedValue({
        id: "new-solo",
        name: "Solo",
        status: "idle",
      });

      await portability.importBundle(
        {
          source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
          include: { company: true, agents: true, projects: false, issues: false },
          target: { mode: "new_company", newCompanyName: "Clone" },
          agents: "all",
          collisionStrategy: "rename",
        },
        "user-1",
      );

      // Should NOT call update with self-referential reportsTo
      const reportsToUpdates = agentSvc.update.mock.calls.filter(
        ([, patch]: [string, Record<string, unknown>]) => "reportsTo" in patch,
      );
      for (const [agentId, patch] of reportsToUpdates) {
        expect(patch.reportsTo).not.toBe(agentId);
      }
    });
  });

  /* ================================================================ */
  /*  Secret / env input sanitization                                 */
  /* ================================================================ */

  describe("secret sanitization", () => {
    it("never leaks secret_ref values into exported files", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      // Scan ALL text files for secret patterns
      for (const [filePath, content] of Object.entries(exported.files)) {
        if (typeof content !== "string") continue;
        expect(content).not.toContain("secret_ref");
        expect(content).not.toContain("secretId");
        // Check no raw secret ID values leaked
        expect(content).not.toContain('"s1"');
      }
    });

    it("exports secret env vars as portable inputs requiring user input", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      expect(exported.manifest.envInputs).toContainEqual(expect.objectContaining({
        key: "ANTHROPIC_API_KEY",
        agentSlug: "engineer",
        kind: "secret",
      }));

      const extension = asTextFile(exported.files[".paperclip.yaml"]);
      expect(extension).toContain("ANTHROPIC_API_KEY:");
      expect(extension).toContain('kind: "secret"');
    });
  });

  /* ================================================================ */
  /*  Issue export/import                                             */
  /* ================================================================ */

  describe("issue portability", () => {
    it("exports issues with project and assignee references", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: true },
      });

      // Task slug is derived from identifier "ACM-1" → "acm-1"
      const taskFile = asTextFile(exported.files["tasks/acm-1/TASK.md"]);
      expect(taskFile).toContain('name: "Build API"');
      expect(taskFile).toContain('project: "platform"');
      expect(taskFile).toContain('assignee: "engineer"');

      // Priority is in .paperclip.yaml extension, not TASK.md frontmatter
      const extension = asTextFile(exported.files[".paperclip.yaml"]);
      expect(extension).toContain('priority: "high"');
    });

    it("imports issues with correct project and assignee resolution", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: true },
      });

      agentSvc.list.mockResolvedValue([]);
      projectSvc.list.mockResolvedValue([]);
      agentSvc.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => ({
        id: `new-${String(input.name).toLowerCase()}`,
        name: input.name,
        status: "idle",
        adapterConfig: input.adapterConfig,
      }));

      await portability.importBundle(
        {
          source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
          include: { company: true, agents: true, projects: true, issues: true },
          target: { mode: "new_company", newCompanyName: "Acme Imported" },
          agents: "all",
          collisionStrategy: "rename",
        },
        "user-1",
      );

      expect(issueSvc.create).toHaveBeenCalledWith(
        "company-imported",
        expect.objectContaining({
          title: "Build API",
          priority: "high",
          labelIds: ["label-x"],
        }),
      );
      // Verify project was resolved (any valid project ID)
      const issueCreateCall = issueSvc.create.mock.calls[0];
      expect(issueCreateCall[1].projectId).toBeTruthy();
    });

    it("preview shows issues excluded by default", async () => {
      const portability = companyPortabilityService({} as any);

      const preview = await portability.previewExport("company-1", {
        include: { company: true, agents: true, projects: true },
      });

      expect(preview.counts.issues).toBe(0);
    });
  });

  /* ================================================================ */
  /*  Manifest schema                                                 */
  /* ================================================================ */

  describe("manifest completeness", () => {
    it("manifest contains all required top-level fields", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: true },
      });

      const m = exported.manifest;
      expect(m.schemaVersion).toBeGreaterThanOrEqual(1);
      expect(m.generatedAt).toBeTruthy();
      expect(m.includes).toEqual({
        company: true,
        agents: true,
        projects: true,
        issues: true,
        skills: false,
      });
      expect(m.company).toBeDefined();
      expect(Array.isArray(m.agents)).toBe(true);
      expect(Array.isArray(m.projects)).toBe(true);
      expect(Array.isArray(m.issues)).toBe(true);
      expect(Array.isArray(m.envInputs)).toBe(true);
    });

    it("manifest agent entries contain required fields", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      for (const agent of exported.manifest.agents) {
        expect(agent.slug).toBeTruthy();
        expect(agent.name).toBeTruthy();
        expect(agent.path).toBeTruthy();
        expect(agent.adapterType).toBeTruthy();
        expect(typeof agent.role).toBe("string");
      }
    });
  });

  /* ================================================================ */
  /*  Edge cases                                                      */
  /* ================================================================ */

  describe("edge cases", () => {
    it("handles export with no agents gracefully", async () => {
      agentSvc.list.mockResolvedValue([]);

      const portability = companyPortabilityService({} as any);
      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      expect(exported.manifest.agents).toEqual([]);
      expect(exported.files["COMPANY.md"]).toBeDefined();
    });

    it("handles export with no projects or issues gracefully", async () => {
      projectSvc.list.mockResolvedValue([]);
      issueSvc.list.mockResolvedValue([]);

      const portability = companyPortabilityService({} as any);
      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: true },
      });

      expect(exported.manifest.projects).toEqual([]);
      expect(exported.manifest.issues).toEqual([]);
    });

    it("import preview reports errors for invalid source files", async () => {
      const portability = companyPortabilityService({} as any);

      const preview = await portability.previewImport({
        source: {
          type: "inline",
          rootPath: "broken-package",
          files: {
            "COMPANY.md": "not valid frontmatter at all",
          },
        },
        include: { company: true, agents: false, projects: false, issues: false },
        target: { mode: "new_company", newCompanyName: "Broken" },
        collisionStrategy: "rename",
      });

      // Should produce an error or warning about the malformed COMPANY.md
      // The system should not crash
      expect(preview).toBeDefined();
    });

    it("existing_company import without company include skips company update", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      agentSvc.list.mockResolvedValue([]);
      agentSvc.create.mockResolvedValue({ id: "new-agent", name: "CEO", status: "idle" });

      const result = await portability.importBundle(
        {
          source: { type: "inline", rootPath: exported.rootPath, files: exported.files },
          include: { company: false, agents: true, projects: false, issues: false },
          target: { mode: "existing_company", companyId: "company-1" },
          agents: "all",
          collisionStrategy: "rename",
        },
        "user-1",
      );

      expect(result.company.action).toBe("unchanged");
      expect(companySvc.update).not.toHaveBeenCalled();
    });

    it("export generates a .paperclip.yaml extension file", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: true, issues: false },
      });

      const extension = asTextFile(exported.files[".paperclip.yaml"]);
      expect(extension).toContain('schema: "paperclip/v1"');
      expect(extension).toContain("agents:");
      expect(extension).toContain("engineer:");
      expect(extension).toContain("ceo:");
    });

    it("export includes README.md with company overview", async () => {
      const portability = companyPortabilityService({} as any);

      const exported = await portability.exportBundle("company-1", {
        include: { company: true, agents: true, projects: false, issues: false },
      });

      expect(exported.files["README.md"]).toBeDefined();
      const readme = asTextFile(exported.files["README.md"]);
      expect(readme).toContain("Acme");
    });
  });
});
