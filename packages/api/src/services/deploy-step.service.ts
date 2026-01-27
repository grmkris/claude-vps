import type {
  BoxDeployStepStatus,
  Database,
  SelectBoxDeployStepSchema,
} from "@vps-claude/db";
import type { BoxDeployStepId, BoxId } from "@vps-claude/shared";

import { boxDeployStep } from "@vps-claude/db";
import { and, asc, eq } from "drizzle-orm";
import { type Result, err, ok } from "neverthrow";

import type { BoxDeployStepsOutput } from "../routers/schemas";

export type DeployStepServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "VALIDATION_FAILED"; message: string };

export const BASE_DEPLOY_STEPS = [
  { key: "CREATE_SPRITE", order: 1, name: "Creating sprite" },
  { key: "SETUP_SERVICES", order: 2, name: "Setting up services" },
  {
    key: "INSTALL_SKILLS",
    order: 3,
    name: "Installing skills",
    optional: true,
  },
  { key: "ENABLE_PUBLIC_ACCESS", order: 4, name: "Enabling public access" },
  { key: "HEALTH_CHECK", order: 5, name: "Verifying services" },
] as const;

export const SETUP_SUBSTEPS = [
  { key: "SETUP_DOWNLOAD_AGENT", order: 1, name: "Downloading box-agent" },
  { key: "SETUP_CREATE_DIRS", order: 2, name: "Creating directories" },
  { key: "SETUP_ENV_VARS", order: 3, name: "Setting env vars" },
  { key: "SETUP_CREATE_ENV_FILE", order: 4, name: "Creating env file" },
  {
    key: "SETUP_BOX_AGENT_SERVICE",
    order: 5,
    name: "Creating box-agent service",
  },
  { key: "SETUP_INSTALL_NGINX", order: 6, name: "Installing nginx" },
  { key: "SETUP_NGINX_SERVICE", order: 7, name: "Creating nginx service" },
  { key: "SETUP_CLONE_AGENT_APP", order: 8, name: "Cloning agent-app" },
  { key: "SETUP_INSTALL_AGENT_APP", order: 9, name: "Installing agent-app" },
  {
    key: "SETUP_AGENT_APP_SERVICE",
    order: 10,
    name: "Creating agent-app service",
  },
] as const;

interface DeployStepServiceDeps {
  db: Database;
}

export interface CreateStepParams {
  stepKey: string;
  name: string;
  parentId?: BoxDeployStepId;
  order: number;
  metadata?: Record<string, unknown>;
}

export interface InitializeStepsConfig {
  hasSkills: boolean;
  skills?: string[];
}

export function createDeployStepService({
  deps,
}: {
  deps: DeployStepServiceDeps;
}) {
  const { db } = deps;

  return {
    async createStep(
      boxId: BoxId,
      attempt: number,
      params: CreateStepParams
    ): Promise<Result<SelectBoxDeployStepSchema, DeployStepServiceError>> {
      const result = await db
        .insert(boxDeployStep)
        .values({
          boxId,
          deploymentAttempt: attempt,
          stepKey: params.stepKey,
          stepOrder: params.order,
          name: params.name,
          parentId: params.parentId,
          metadata: params.metadata,
          status: "pending",
        })
        .returning();

      const created = result[0];
      if (!created) {
        return err({
          type: "VALIDATION_FAILED",
          message: "Failed to create deploy step",
        });
      }

      return ok(created);
    },

    async initializeSteps(
      boxId: BoxId,
      attempt: number,
      config: InitializeStepsConfig
    ): Promise<Result<SelectBoxDeployStepSchema[], DeployStepServiceError>> {
      const stepsToCreate: Array<{
        stepKey: string;
        name: string;
        order: number;
        parentId?: BoxDeployStepId;
      }> = [];

      // Add base steps
      for (const step of BASE_DEPLOY_STEPS) {
        // Skip INSTALL_SKILLS if no skills
        if (step.key === "INSTALL_SKILLS" && !config.hasSkills) {
          continue;
        }
        stepsToCreate.push({
          stepKey: step.key,
          name: step.name,
          order: step.order,
        });
      }

      // Insert all steps and get IDs
      const insertedSteps: SelectBoxDeployStepSchema[] = [];

      for (const step of stepsToCreate) {
        const result = await db
          .insert(boxDeployStep)
          .values({
            boxId,
            deploymentAttempt: attempt,
            stepKey: step.stepKey,
            stepOrder: step.order,
            name: step.name,
            status: "pending",
          })
          .returning();

        if (result[0]) {
          insertedSteps.push(result[0]);
        }
      }

      // Find SETUP_SERVICES parent to add children
      const setupParent = insertedSteps.find(
        (s) => s.stepKey === "SETUP_SERVICES"
      );
      if (setupParent) {
        for (const substep of SETUP_SUBSTEPS) {
          const result = await db
            .insert(boxDeployStep)
            .values({
              boxId,
              deploymentAttempt: attempt,
              stepKey: substep.key,
              stepOrder: substep.order,
              name: substep.name,
              parentId: setupParent.id,
              status: "pending",
            })
            .returning();

          if (result[0]) {
            insertedSteps.push(result[0]);
          }
        }
      }

      // Add skill install steps if skills present
      if (config.hasSkills && config.skills) {
        const skillsParent = insertedSteps.find(
          (s) => s.stepKey === "INSTALL_SKILLS"
        );
        if (skillsParent) {
          for (let i = 0; i < config.skills.length; i++) {
            const skillId = config.skills[i];
            const result = await db
              .insert(boxDeployStep)
              .values({
                boxId,
                deploymentAttempt: attempt,
                stepKey: `SKILL_${skillId}`,
                stepOrder: i + 1,
                name: `Installing skill: ${skillId}`,
                parentId: skillsParent.id,
                status: "pending",
                metadata: { skillId },
              })
              .returning();

            if (result[0]) {
              insertedSteps.push(result[0]);
            }
          }
        }
      }

      return ok(insertedSteps);
    },

    async startStep(
      stepId: BoxDeployStepId
    ): Promise<Result<void, DeployStepServiceError>> {
      const result = await db
        .update(boxDeployStep)
        .set({
          status: "running",
          startedAt: new Date(),
        })
        .where(eq(boxDeployStep.id, stepId))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Step not found" });
      }

      return ok(undefined);
    },

    async completeStep(
      stepId: BoxDeployStepId,
      metadata?: Record<string, unknown>
    ): Promise<Result<void, DeployStepServiceError>> {
      const updateData: Partial<typeof boxDeployStep.$inferInsert> = {
        status: "completed",
        completedAt: new Date(),
      };

      if (metadata) {
        // Merge metadata
        const existing = await db.query.boxDeployStep.findFirst({
          where: eq(boxDeployStep.id, stepId),
        });
        updateData.metadata = { ...existing?.metadata, ...metadata };
      }

      const result = await db
        .update(boxDeployStep)
        .set(updateData)
        .where(eq(boxDeployStep.id, stepId))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Step not found" });
      }

      return ok(undefined);
    },

    async failStep(
      stepId: BoxDeployStepId,
      errorMessage: string,
      metadata?: Record<string, unknown>
    ): Promise<Result<void, DeployStepServiceError>> {
      const updateData: Partial<typeof boxDeployStep.$inferInsert> = {
        status: "failed",
        completedAt: new Date(),
        errorMessage,
      };

      if (metadata) {
        const existing = await db.query.boxDeployStep.findFirst({
          where: eq(boxDeployStep.id, stepId),
        });
        updateData.metadata = { ...existing?.metadata, ...metadata };
      }

      const result = await db
        .update(boxDeployStep)
        .set(updateData)
        .where(eq(boxDeployStep.id, stepId))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Step not found" });
      }

      return ok(undefined);
    },

    async skipStep(
      stepId: BoxDeployStepId
    ): Promise<Result<void, DeployStepServiceError>> {
      const result = await db
        .update(boxDeployStep)
        .set({
          status: "skipped",
          completedAt: new Date(),
        })
        .where(eq(boxDeployStep.id, stepId))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: "Step not found" });
      }

      return ok(undefined);
    },

    async getSteps(
      boxId: BoxId,
      attempt?: number
    ): Promise<Result<BoxDeployStepsOutput, DeployStepServiceError>> {
      const conditions = [eq(boxDeployStep.boxId, boxId)];

      if (attempt !== undefined) {
        conditions.push(eq(boxDeployStep.deploymentAttempt, attempt));
      }

      const steps = await db.query.boxDeployStep.findMany({
        where: and(...conditions),
        orderBy: [asc(boxDeployStep.stepOrder)],
      });

      return ok({ steps, deploymentAttempt: attempt ?? 1 });
    },

    async getStepByKey(
      boxId: BoxId,
      attempt: number,
      stepKey: string,
      parentId?: BoxDeployStepId
    ): Promise<
      Result<SelectBoxDeployStepSchema | null, DeployStepServiceError>
    > {
      const conditions = [
        eq(boxDeployStep.boxId, boxId),
        eq(boxDeployStep.deploymentAttempt, attempt),
        eq(boxDeployStep.stepKey, stepKey),
      ];

      if (parentId) {
        conditions.push(eq(boxDeployStep.parentId, parentId));
      }

      const step = await db.query.boxDeployStep.findFirst({
        where: and(...conditions),
      });

      return ok(step ?? null);
    },

    async getResumePoint(
      boxId: BoxId,
      attempt: number
    ): Promise<
      Result<SelectBoxDeployStepSchema | null, DeployStepServiceError>
    > {
      const failedTopLevel = await db.query.boxDeployStep.findFirst({
        where: and(
          eq(boxDeployStep.boxId, boxId),
          eq(boxDeployStep.deploymentAttempt, attempt),
          eq(boxDeployStep.status, "failed")
        ),
        orderBy: [asc(boxDeployStep.stepOrder)],
      });

      if (failedTopLevel) {
        return ok(failedTopLevel);
      }

      const pendingStep = await db.query.boxDeployStep.findFirst({
        where: and(
          eq(boxDeployStep.boxId, boxId),
          eq(boxDeployStep.deploymentAttempt, attempt),
          eq(boxDeployStep.status, "pending")
        ),
        orderBy: [asc(boxDeployStep.stepOrder)],
      });

      return ok(pendingStep ?? null);
    },

    async updateStepStatus(
      boxId: BoxId,
      attempt: number,
      stepKey: string,
      status: BoxDeployStepStatus,
      options?: {
        errorMessage?: string;
        metadata?: Record<string, unknown>;
        parentId?: BoxDeployStepId;
      }
    ): Promise<Result<void, DeployStepServiceError>> {
      const conditions = [
        eq(boxDeployStep.boxId, boxId),
        eq(boxDeployStep.deploymentAttempt, attempt),
        eq(boxDeployStep.stepKey, stepKey),
      ];

      if (options?.parentId) {
        conditions.push(eq(boxDeployStep.parentId, options.parentId));
      }

      const updateData: Partial<typeof boxDeployStep.$inferInsert> = {
        status,
      };

      if (status === "running") {
        updateData.startedAt = new Date();
      } else if (
        status === "completed" ||
        status === "failed" ||
        status === "skipped"
      ) {
        updateData.completedAt = new Date();
      }

      if (options?.errorMessage) {
        updateData.errorMessage = options.errorMessage;
      }

      if (options?.metadata) {
        const existing = await db.query.boxDeployStep.findFirst({
          where: and(...conditions),
        });
        updateData.metadata = { ...existing?.metadata, ...options.metadata };
      }

      const result = await db
        .update(boxDeployStep)
        .set(updateData)
        .where(and(...conditions))
        .returning();

      if (result.length === 0) {
        return err({ type: "NOT_FOUND", message: `Step ${stepKey} not found` });
      }

      return ok(undefined);
    },

    async shouldSkipStep(
      boxId: BoxId,
      attempt: number,
      stepKey: string,
      resumeFromStepKey?: string
    ): Promise<boolean> {
      if (!resumeFromStepKey) return false;

      const stepResult = await this.getStepByKey(boxId, attempt, stepKey);
      if (stepResult.isErr() || !stepResult.value) return false;

      const resumeResult = await this.getStepByKey(
        boxId,
        attempt,
        resumeFromStepKey
      );
      if (resumeResult.isErr() || !resumeResult.value) return false;

      return stepResult.value.stepOrder < resumeResult.value.stepOrder;
    },

    async getStepsTree(
      boxId: BoxId,
      attempt?: number
    ): Promise<Result<BoxDeployStepsOutput, DeployStepServiceError>> {
      const stepsResult = await this.getSteps(boxId, attempt);
      if (stepsResult.isErr()) return err(stepsResult.error);

      const steps = stepsResult.value;
      const topLevel = steps.steps.filter((s) => !s.parentId);
      const children = steps.steps.filter((s) => s.parentId);

      const tree = topLevel.map((parent) => ({
        ...parent,
        children: children
          .filter((c) => c.parentId === parent.id)
          .sort((a, b) => a.stepOrder - b.stepOrder),
      }));

      return ok({ steps: tree, deploymentAttempt: attempt ?? 1 });
    },

    async deleteSteps(
      boxId: BoxId,
      attempt: number
    ): Promise<Result<void, DeployStepServiceError>> {
      await db
        .delete(boxDeployStep)
        .where(
          and(
            eq(boxDeployStep.boxId, boxId),
            eq(boxDeployStep.deploymentAttempt, attempt)
          )
        );

      return ok(undefined);
    },

    /**
     * Get all steps for a box/attempt (flat list)
     */
    async getStepsByBox(
      boxId: BoxId,
      attempt: number
    ): Promise<Result<SelectBoxDeployStepSchema[], DeployStepServiceError>> {
      const steps = await db
        .select()
        .from(boxDeployStep)
        .where(
          and(
            eq(boxDeployStep.boxId, boxId),
            eq(boxDeployStep.deploymentAttempt, attempt)
          )
        )
        .orderBy(asc(boxDeployStep.stepOrder));

      return ok(steps);
    },

    /**
     * Reset failed steps to pending (for retry)
     */
    async resetFailedSteps(
      boxId: BoxId,
      attempt: number
    ): Promise<Result<number, DeployStepServiceError>> {
      const result = await db
        .update(boxDeployStep)
        .set({
          status: "pending",
          errorMessage: null,
          startedAt: null,
          completedAt: null,
        })
        .where(
          and(
            eq(boxDeployStep.boxId, boxId),
            eq(boxDeployStep.deploymentAttempt, attempt),
            eq(boxDeployStep.status, "failed")
          )
        )
        .returning();

      return ok(result.length);
    },
  };
}

export type DeployStepService = ReturnType<typeof createDeployStepService>;
