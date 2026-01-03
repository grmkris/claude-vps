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

interface EmailVerificationOtpProps {
  otp: string;
  userEmail: string;
  baseUrl: string;
}

export const EmailVerificationOTP = ({
  otp,
  userEmail,
  baseUrl,
}: EmailVerificationOtpProps) => {
  const verifyUrl = `${baseUrl}/verify-email?otp=${otp}&email=${encodeURIComponent(userEmail)}&type=email-verification`;
  return (
    <Html>
      <Head />
      <Preview>Your verification code is {otp}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Heading style={emailStyles.h1}>Verify your email</Heading>
          <Text style={emailStyles.text}>
            Enter this code to verify your email address ({userEmail}).
          </Text>
          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otp}</Text>
          </Section>
          <Section style={emailStyles.buttonContainer}>
            <Button href={verifyUrl} style={emailStyles.button}>
              Verify email instantly
            </Button>
          </Section>
          <Text style={emailStyles.smallText}>
            {emailCopy.linkInstructions}
          </Text>
          <Link href={verifyUrl} style={emailStyles.link}>
            {verifyUrl}
          </Link>
          <Text style={emailStyles.text}>{emailCopy.expirationWarning}</Text>
          <Text style={emailStyles.footer}>{emailCopy.securityNote}</Text>
        </Container>
      </Body>
    </Html>
  );
};
