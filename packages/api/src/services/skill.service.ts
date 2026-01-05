import type { Database } from "@vps-claude/db";

import { skill, type Skill } from "@vps-claude/db";
import { type SkillId, type UserId } from "@vps-claude/shared";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { Result, ok, err } from "neverthrow";

export type SkillServiceError =
  | { type: "NOT_FOUND"; message: string }
  | { type: "ALREADY_EXISTS"; message: string }
  | { type: "FORBIDDEN"; message: string };

interface SkillServiceDeps {
  db: Database;
}

export function createSkillService({ deps }: { deps: SkillServiceDeps }) {
  const { db } = deps;

  return {
    async list(userId: UserId): Promise<Skill[]> {
      return db.query.skill.findMany({
        where: or(isNull(skill.userId), eq(skill.userId, userId)),
        orderBy: skill.name,
      });
    },

    async getById(
      id: SkillId,
      userId: UserId
    ): Promise<Result<Skill, SkillServiceError>> {
      const result = await db.query.skill.findFirst({
        where: and(
          eq(skill.id, id),
          or(isNull(skill.userId), eq(skill.userId, userId))
        ),
      });

      if (!result) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      if (result.userId !== null && result.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      return ok(result);
    },

    async getByIds(ids: SkillId[], userId: UserId): Promise<Skill[]> {
      if (ids.length === 0) return [];

      return db.query.skill.findMany({
        where: and(
          inArray(skill.id, ids),
          or(isNull(skill.userId), eq(skill.userId, userId))
        ),
      });
    },

    async create(
      userId: UserId,
      input: {
        slug: string;
        name: string;
        description: string;
        aptPackages?: string[];
        npmPackages?: string[];
        pipPackages?: string[];
        skillMdContent?: string;
      }
    ): Promise<Result<Skill, SkillServiceError>> {
      const existing = await db
        .select()
        .from(skill)
        .where(and(eq(skill.userId, userId), eq(skill.slug, input.slug)))
        .limit(1);

      if (existing.length > 0) {
        return err({
          type: "ALREADY_EXISTS",
          message: "Skill with this slug already exists",
        });
      }

      const [created] = await db
        .insert(skill)
        .values({
          userId,
          slug: input.slug,
          name: input.name,
          description: input.description,
          aptPackages: input.aptPackages ?? [],
          npmPackages: input.npmPackages ?? [],
          pipPackages: input.pipPackages ?? [],
          skillMdContent: input.skillMdContent ?? null,
        })
        .returning();

      return ok(created!);
    },

    async update(
      id: SkillId,
      userId: UserId,
      input: Partial<{
        name: string;
        description: string;
        aptPackages: string[];
        npmPackages: string[];
        pipPackages: string[];
        skillMdContent: string | null;
      }>
    ): Promise<Result<Skill, SkillServiceError>> {
      const existing = await db.query.skill.findFirst({
        where: and(eq(skill.id, id), eq(skill.userId, userId)),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      if (existing.userId === null) {
        return err({
          type: "FORBIDDEN",
          message: "Cannot modify global skills",
        });
      }

      if (existing.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      const [updated] = await db
        .update(skill)
        .set(input)
        .where(eq(skill.id, id))
        .returning();

      return ok(updated!);
    },

    async delete(
      id: SkillId,
      userId: UserId
    ): Promise<Result<void, SkillServiceError>> {
      const existing = await db.query.skill.findFirst({
        where: and(eq(skill.id, id), eq(skill.userId, userId)),
      });

      if (!existing) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      if (existing.userId === null) {
        return err({
          type: "FORBIDDEN",
          message: "Cannot delete global skills",
        });
      }

      if (existing.userId !== userId) {
        return err({ type: "NOT_FOUND", message: "Skill not found" });
      }

      await db.delete(skill).where(eq(skill.id, id));
      return ok(undefined);
    },

    async seedGlobalSkills(
      skills: Array<{
        slug: string;
        name: string;
        description: string;
        aptPackages: string[];
        npmPackages: string[];
        pipPackages: string[];
        skillMdContent?: string;
      }>
    ): Promise<void> {
      for (const s of skills) {
        const existing = await db
          .select()
          .from(skill)
          .where(and(isNull(skill.userId), eq(skill.slug, s.slug)))
          .limit(1);

        if (existing.length === 0) {
          await db.insert(skill).values({
            userId: null,
            slug: s.slug,
            name: s.name,
            description: s.description,
            aptPackages: s.aptPackages,
            npmPackages: s.npmPackages,
            pipPackages: s.pipPackages,
            skillMdContent: s.skillMdContent ?? null,
          });
        } else {
          await db
            .update(skill)
            .set({
              name: s.name,
              description: s.description,
              aptPackages: s.aptPackages,
              npmPackages: s.npmPackages,
              pipPackages: s.pipPackages,
              skillMdContent: s.skillMdContent ?? null,
            })
            .where(eq(skill.id, existing[0]!.id));
        }
      }
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
