import type { Logger } from "@vps-claude/logger";

import { render } from "@react-email/render";
import { Inbound } from "inboundemail";

import { AgentReply } from "../emails/agent-reply";
import { EmailVerificationOTP } from "../emails/email-verification-otp";
import { ForgetPasswordOTP } from "../emails/forget-password-otp";
import { SignInOTP } from "../emails/sign-in-otp";

export const emailConfig = {
  defaultFrom: "VPS Claude <agent@inbnd.dev>",
} as const;

export const emailStyles = {
  main: {
    backgroundColor: "#ffffff",
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  container: {
    margin: "0 auto",
    padding: "20px 0 48px",
    maxWidth: "560px",
  },
  h1: {
    color: "#333",
    fontSize: "24px",
    fontWeight: "600" as const,
    margin: "0 0 20px",
  },
  text: {
    color: "#333",
    fontSize: "16px",
    lineHeight: "26px",
    margin: "0 0 16px",
  },
  codeContainer: {
    background: "#f4f4f5",
    borderRadius: "8px",
    padding: "24px",
    textAlign: "center" as const,
    margin: "24px 0",
  },
  code: {
    fontSize: "32px",
    fontWeight: "700" as const,
    letterSpacing: "6px",
    color: "#333",
    margin: "0",
  },
  buttonContainer: {
    textAlign: "center" as const,
    margin: "24px 0",
  },
  button: {
    backgroundColor: "#4f46e5",
    borderRadius: "8px",
    color: "#fff",
    padding: "12px 24px",
    textDecoration: "none",
    fontWeight: "600" as const,
  },
  link: {
    color: "#4f46e5",
    fontSize: "14px",
    wordBreak: "break-all" as const,
  },
  smallText: {
    color: "#666",
    fontSize: "14px",
    margin: "16px 0 8px",
  },
  footer: {
    color: "#999",
    fontSize: "12px",
    marginTop: "24px",
  },
} as const;

export const emailCopy = {
  linkInstructions: "Or copy and paste this link into your browser:",
  expirationWarning: "This code will expire in 10 minutes.",
  securityNote: "For security reasons, never share this code with anyone.",
};

export type EmailParams =
  | {
      type: "sign-in-otp";
      to: string;
      otp: string;
      userEmail: string;
      baseUrl: string;
    }
  | {
      type: "email-verification-otp";
      to: string;
      otp: string;
      userEmail: string;
      baseUrl: string;
    }
  | {
      type: "forget-password-otp";
      to: string;
      otp: string;
      userEmail: string;
      baseUrl: string;
    };

const emailTemplates = {
  "sign-in-otp": (params: Extract<EmailParams, { type: "sign-in-otp" }>) => ({
    subject: `Your sign-in code is ${params.otp}`,
    react: SignInOTP({
      otp: params.otp,
      userEmail: params.userEmail,
      baseUrl: params.baseUrl,
    }),
  }),
  "email-verification-otp": (
    params: Extract<EmailParams, { type: "email-verification-otp" }>
  ) => ({
    subject: `Your verification code is ${params.otp}`,
    react: EmailVerificationOTP({
      otp: params.otp,
      userEmail: params.userEmail,
      baseUrl: params.baseUrl,
    }),
  }),
  "forget-password-otp": (
    params: Extract<EmailParams, { type: "forget-password-otp" }>
  ) => ({
    subject: `Your password reset code is ${params.otp}`,
    react: ForgetPasswordOTP({
      otp: params.otp,
      userEmail: params.userEmail,
      baseUrl: params.baseUrl,
    }),
  }),
} as const;

export interface RawEmailParams {
  from?: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface EmailClient {
  sendEmail: (params: EmailParams) => Promise<string>;
  sendRawEmail: (params: RawEmailParams) => Promise<string>;
}

export interface EmailClientConfig {
  apiKey: string;
  from?: string;
  logger?: Logger;
}

export function createEmailClient(config: EmailClientConfig): EmailClient {
  const { apiKey, from = emailConfig.defaultFrom, logger } = config;
  const inbound = new Inbound({ apiKey });

  return {
    sendEmail: async (params) => {
      const template = emailTemplates[params.type];
      const { subject, react } = template(params as never);
      const html = await render(react);

      logger?.debug({ type: params.type, to: params.to }, "Sending email");

      const result = await inbound.emails.send({
        from,
        to: params.to,
        subject,
        html,
      });

      if (!result?.id) {
        logger?.error({ result }, "Email send failed");
        throw new Error("Failed to send email");
      }

      logger?.info({ emailId: result.id, type: params.type }, "Email sent");
      return result.id;
    },

    sendRawEmail: async (params) => {
      logger?.debug(
        { to: params.to, subject: params.subject },
        "Sending raw email"
      );

      const result = await inbound.emails.send({
        from: params.from ?? from,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
        reply_to: params.replyTo,
        headers: params.headers,
      });

      if (!result?.id) {
        logger?.error({ result }, "Raw email send failed");
        throw new Error("Failed to send email");
      }

      logger?.info({ emailId: result.id }, "Raw email sent");
      return result.id;
    },
  };
}

export function createMockEmailClient(): EmailClient {
  return {
    sendEmail: async () => "mock-email-id",
    sendRawEmail: async () => "mock-email-id",
  };
}

/**
 * Render markdown body to HTML using the agent reply template
 */
export async function renderAgentEmail(body: string): Promise<string> {
  return render(AgentReply({ body }));
}

/**
 * Convert markdown to plain text for email fallback
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/#{1,6}\s+/g, "") // Remove headers
    .replace(/\*\*([^*]+)\*\*/g, "$1") // Bold
    .replace(/\*([^*]+)\*/g, "$1") // Italic
    .replace(/`([^`]+)`/g, "$1") // Inline code
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```\w*\n?/g, "")) // Code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Links
    .replace(/^\s*[-*+]\s+/gm, "• ") // Unordered lists
    .replace(/^\s*\d+\.\s+/gm, "• ") // Ordered lists
    .replace(/>\s*/gm, "") // Blockquotes
    .replace(/\n{3,}/g, "\n\n") // Multiple newlines
    .trim();
}
