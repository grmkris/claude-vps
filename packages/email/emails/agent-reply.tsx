import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { Markdown } from "@react-email/markdown";

import { emailStyles } from "../src/email-client";

interface AgentReplyProps {
  body: string;
  preview?: string;
}

export const AgentReply = ({ body, preview }: AgentReplyProps) => {
  const previewText = preview || body.slice(0, 100).replace(/[#*`]/g, "");

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={emailStyles.main}>
        <Container style={styles.container}>
          <Section style={styles.content}>
            <Markdown
              markdownContainerStyles={styles.markdown}
              markdownCustomStyles={{
                h1: { fontSize: "24px", marginBottom: "16px", marginTop: "0" },
                h2: {
                  fontSize: "20px",
                  marginBottom: "12px",
                  marginTop: "24px",
                },
                h3: {
                  fontSize: "16px",
                  marginBottom: "8px",
                  marginTop: "16px",
                },
                p: { marginBottom: "12px", lineHeight: "1.6" },
                ul: { marginBottom: "12px", paddingLeft: "24px" },
                ol: { marginBottom: "12px", paddingLeft: "24px" },
                li: { marginBottom: "4px" },
                blockQuote: {
                  borderLeft: "3px solid #e5e7eb",
                  paddingLeft: "16px",
                  marginLeft: "0",
                  color: "#6b7280",
                },
                codeInline: {
                  backgroundColor: "#f3f4f6",
                  padding: "2px 6px",
                  borderRadius: "4px",
                  fontSize: "14px",
                },
                codeBlock: {
                  backgroundColor: "#f3f4f6",
                  padding: "16px",
                  borderRadius: "8px",
                  overflow: "auto",
                },
                link: { color: "#4f46e5" },
              }}
            >
              {body}
            </Markdown>
          </Section>
          <Text style={styles.footer}>Sent via VPS Claude</Text>
        </Container>
      </Body>
    </Html>
  );
};

const styles = {
  container: {
    margin: "0 auto",
    padding: "20px",
    maxWidth: "600px",
  },
  content: {
    backgroundColor: "#ffffff",
    borderRadius: "8px",
    padding: "24px",
  },
  markdown: {
    fontFamily:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    fontSize: "16px",
    color: "#1f2937",
    lineHeight: "1.6",
  },
  footer: {
    color: "#9ca3af",
    fontSize: "12px",
    textAlign: "center" as const,
    marginTop: "24px",
  },
};

export default AgentReply;
