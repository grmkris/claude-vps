import { createApi } from "@vps-claude/api/create-api";
import { createApiKeyService } from "@vps-claude/api/services/api-key.service";
import { createBoxService } from "@vps-claude/api/services/box.service";
import { createEmailService } from "@vps-claude/api/services/email.service";
import { createSecretService } from "@vps-claude/api/services/secret.service";
import { createSkillService } from "@vps-claude/api/services/skill.service";
import {
  createDeployWorker,
  createDeleteWorker,
} from "@vps-claude/api/workers/deploy-box.worker";
import {
  createEmailDeliveryWorker,
  createEmailSendWorker,
} from "@vps-claude/api/workers/email-delivery.worker";
import { createAuth } from "@vps-claude/auth";
import { createDb, runMigrations } from "@vps-claude/db";
import { createEmailClient } from "@vps-claude/email";
import { createLogger } from "@vps-claude/logger";
import { createQueueClient } from "@vps-claude/queue";
import { createRedisClient } from "@vps-claude/redis";
import { SERVICE_URLS } from "@vps-claude/shared/services.schema";
import { createSpritesClient } from "@vps-claude/sprites";

import { env, BOX_AGENT_BINARY_URL } from "./env";

const logger = createLogger({ appName: "vps-claude-server" });

const db = createDb({
  type: "bun-sql",
  connectionString: env.DATABASE_URL,
});
await runMigrations(db, logger);

const redis = createRedisClient({ url: env.REDIS_URL });

const queueClient = createQueueClient({ redis });

const emailClient = createEmailClient({
  apiKey: env.INBOUND_EMAIL_API_KEY,
  logger,
});

const spritesClient = createSpritesClient({
  token: env.SPRITES_TOKEN,
});

const trustedOrigins = [
  SERVICE_URLS[env.APP_ENV].web,
  ...(env.APP_ENV === "dev" || env.APP_ENV === "local"
    ? [SERVICE_URLS[env.APP_ENV].api]
    : []),
];

const auth = createAuth({
  db,
  secret: env.BETTER_AUTH_SECRET,
  baseURL: SERVICE_URLS[env.APP_ENV].auth,
  trustedOrigins,
  emailClient,
  appEnv: env.APP_ENV,
});

const apiKeyService = createApiKeyService({ deps: { auth } });
const boxService = createBoxService({ deps: { db, queueClient } });
const emailService = createEmailService({ deps: { db, queueClient } });
const secretService = createSecretService({ deps: { db } });
const skillService = createSkillService({ deps: { db } });

const seedResult = await skillService.seedGlobalSkills([
  {
    slug: "hello-world",
    name: "Hello World",
    description:
      "A simple greeting skill to test Claude Code skills. Use when asked to greet or say hello.",
    aptPackages: [],
    npmPackages: [],
    pipPackages: [],
    skillMdContent: `---
name: hello-world
description: A simple greeting skill. Use when asked to greet or say hello.
---

# Hello World Skill

When greeting the user, be friendly and enthusiastic!

## Instructions
1. Start with a warm greeting
2. Ask how you can help today
3. Be conversational and approachable
`,
  },
  {
    slug: "image-processing",
    name: "Image Processing",
    description:
      "ImageMagick and libvips for image manipulation. Use when working with images, resizing, converting formats, or applying effects.",
    aptPackages: ["imagemagick", "libvips-tools"],
    npmPackages: [],
    pipPackages: [],
    skillMdContent: `---
name: image-processing
description: Process and manipulate images. Use when resizing, converting, or editing images.
---

# Image Processing Skill

Use ImageMagick and libvips for image manipulation.

## Available Tools

### ImageMagick (convert, identify, mogrify)
- \`convert input.jpg -resize 800x600 output.jpg\` - Resize image
- \`convert input.png -quality 85 output.jpg\` - Convert format
- \`identify image.jpg\` - Get image info
- \`mogrify -strip *.jpg\` - Remove metadata from all JPGs

### libvips (vips, vipsthumbnail)
- \`vipsthumbnail input.jpg -s 200x200 -o thumb.jpg\` - Create thumbnail
- \`vips resize input.jpg output.jpg 0.5\` - Scale by 50%

## Common Tasks
- Resize: \`convert in.jpg -resize 50% out.jpg\`
- Crop: \`convert in.jpg -crop 100x100+10+10 out.jpg\`
- Rotate: \`convert in.jpg -rotate 90 out.jpg\`
- Grayscale: \`convert in.jpg -colorspace Gray out.jpg\`
`,
  },
]);
if (seedResult.isErr()) {
  logger.error({
    msg: "Failed to seed global skills",
    error: seedResult.error.message,
  });
} else {
  logger.info({ msg: "Global skills seeded" });
}

const services = {
  apiKeyService,
  boxService,
  emailService,
  secretService,
  skillService,
  spritesClient,
};

const deployWorker = createDeployWorker({
  deps: {
    boxService,
    emailService,
    secretService,
    skillService,
    spritesClient,
    redis,
    logger,
    serverUrl: SERVICE_URLS[env.APP_ENV].api,
    boxAgentBinaryUrl: BOX_AGENT_BINARY_URL,
  },
});
const deleteWorker = createDeleteWorker({
  deps: { boxService, spritesClient, redis, logger },
});

const emailDeliveryWorker = createEmailDeliveryWorker({
  deps: {
    emailService,
    redis,
    logger,
  },
});
const emailSendWorker = createEmailSendWorker({
  deps: {
    emailService,
    sendEmail: async (params) => {
      await emailClient.sendRawEmail({
        to: params.to,
        subject: params.subject,
        text: params.body,
        replyTo: params.inReplyTo?.from,
      });
    },
    redis,
    logger,
  },
});

const { app } = createApi({
  db,
  logger,
  services,
  auth,
  corsOrigin: SERVICE_URLS[env.APP_ENV].web,
  agentsDomain: SERVICE_URLS[env.APP_ENV].agentsDomain,
  inboundWebhookSecret: env.INBOUND_WEBHOOK_SECRET,
});

logger.info({ msg: "Server started", port: 33000 });

const shutdown = async (signal: string) => {
  logger.info({ msg: `${signal} received, shutting down` });

  await deployWorker.close();
  await deleteWorker.close();
  await emailDeliveryWorker.close();
  await emailSendWorker.close();
  await queueClient.close();
  await redis.quit();

  process.exit(0);
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default {
  port: 33000,
  fetch: app.fetch,
};
