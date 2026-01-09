import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { internalProcedure } from "../internal-procedure";

// Platform routers - called by platform services (ssh-bastion, etc.)
// Auth: INTERNAL_API_KEY via internalProcedure

export const platformRouter = {
  ssh: {
    lookup: internalProcedure
      .route({ method: "GET", path: "/platform/ssh/lookup" })
      .input(z.object({ subdomain: z.string() }))
      .output(
        z.object({
          containerName: z.string(),
        })
      )
      .handler(async ({ context, input }) => {
        const boxRecord = await context.boxService.getBySubdomain(
          input.subdomain
        );

        if (!boxRecord) {
          throw new ORPCError("NOT_FOUND", { message: "Box not found" });
        }

        if (boxRecord.status !== "running") {
          throw new ORPCError("BAD_REQUEST", { message: "Box not running" });
        }

        if (!boxRecord.containerName) {
          throw new ORPCError("BAD_REQUEST", {
            message: "Box not fully configured",
          });
        }

        return {
          containerName: boxRecord.containerName,
        };
      }),

    boxes: internalProcedure
      .route({ method: "GET", path: "/platform/ssh/boxes" })
      .output(
        z.object({
          boxes: z.array(
            z.object({
              subdomain: z.string(),
              containerName: z.string(),
            })
          ),
        })
      )
      .handler(async ({ context }) => {
        const boxes = await context.boxService.listRunningBoxes();
        return { boxes };
      }),
  },
};
