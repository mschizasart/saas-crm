import { Body, Button, Container, Head, Heading, Html, Preview, Text, Hr } from '@react-email/components';
import * as React from 'react';

interface PasswordResetEmailProps {
  firstName: string;
  resetUrl: string;
  organizationName: string;
}

export function PasswordResetEmail({ firstName, resetUrl, organizationName }: PasswordResetEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Reset your {organizationName} CRM password</Preview>
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'sans-serif' }}>
        <Container style={{ maxWidth: '580px', margin: '0 auto', padding: '20px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '32px' }}>
            <Heading as="h2" style={{ color: '#1a1a2e' }}>Reset your password</Heading>
            <Text>Hi {firstName},</Text>
            <Text>We received a request to reset your password. Click the button below to create a new one.</Text>
            <Button
              href={resetUrl}
              style={{ backgroundColor: '#3b82f6', color: '#fff', padding: '12px 24px', borderRadius: '6px', fontWeight: 600 }}
            >
              Reset Password
            </Button>
            <Text style={{ color: '#9ca3af', fontSize: '12px', marginTop: '16px' }}>
              This link expires in 1 hour. If you didn't request this, ignore this email.
            </Text>
            <Hr style={{ borderColor: '#e5e7eb' }} />
            <Text style={{ color: '#9ca3af', fontSize: '12px' }}>{organizationName}</Text>
          </div>
        </Container>
      </Body>
    </Html>
  );
}
