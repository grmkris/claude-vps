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

interface SignInOtpProps {
  otp: string;
  userEmail: string;
  baseUrl: string;
}

export const SignInOTP = ({ otp, userEmail, baseUrl }: SignInOtpProps) => {
  const loginUrl = `${baseUrl}/login?otp=${otp}&email=${encodeURIComponent(userEmail)}&type=sign-in`;
  return (
    <Html>
      <Head />
      <Preview>Your sign-in code is {otp}</Preview>
      <Body style={emailStyles.main}>
        <Container style={emailStyles.container}>
          <Heading style={emailStyles.h1}>Sign in to your account</Heading>
          <Text style={emailStyles.text}>
            Enter this code to sign in to your account ({userEmail}).
          </Text>
          <Section style={emailStyles.codeContainer}>
            <Text style={emailStyles.code}>{otp}</Text>
          </Section>
          <Section style={emailStyles.buttonContainer}>
            <Button href={loginUrl} style={emailStyles.button}>
              Sign in instantly
            </Button>
          </Section>
          <Text style={emailStyles.smallText}>
            {emailCopy.linkInstructions}
          </Text>
          <Link href={loginUrl} style={emailStyles.link}>
            {loginUrl}
          </Link>
          <Text style={emailStyles.text}>{emailCopy.expirationWarning}</Text>
          <Text style={emailStyles.footer}>{emailCopy.securityNote}</Text>
        </Container>
      </Body>
    </Html>
  );
};
