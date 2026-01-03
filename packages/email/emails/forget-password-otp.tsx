import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { emailCopy, emailStyles } from "../src/email-client";

interface ForgetPasswordOtpProps {
  otp: string;
  userEmail: string;
  baseUrl: string;
}

export const ForgetPasswordOTP = ({
  otp,
  userEmail,
  baseUrl,
}: ForgetPasswordOtpProps) => {
  const resetUrl = `${baseUrl}/reset-password?otp=${otp}&email=${encodeURIComponent(userEmail)}&type=forget-password`;
  return (
    <Html>
      <Head />
      <Preview>Your password reset code is {otp}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Heading style={emailStyles.h1}>Reset your password</Heading>
          <Text style={emailStyles.text}>
            Enter this code to reset your password for {userEmail}.
          </Text>
          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otp}</Text>
          </Section>
          <Section style={emailStyles.buttonContainer}>
            <Button href={resetUrl} style={emailStyles.button}>
              Reset password instantly
            </Button>
          </Section>
          <Text style={emailStyles.smallText}>
            {emailCopy.linkInstructions}
          </Text>
          <Link href={resetUrl} style={emailStyles.link}>
            {resetUrl}
          </Link>
          <Text style={emailStyles.text}>{emailCopy.expirationWarning}</Text>
          <Text style={emailStyles.footer}>{emailCopy.securityNote}</Text>
        </Container>
      </Body>
    </Html>
  );
};
