import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import * as React from 'react';

interface InvoiceEmailProps {
  clientName: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string;
  invoiceUrl: string;
  organizationName: string;
  organizationLogo?: string;
}

export function InvoiceEmail({
  clientName,
  invoiceNumber,
  amount,
  dueDate,
  invoiceUrl,
  organizationName,
}: InvoiceEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Invoice {invoiceNumber} from {organizationName} — {amount} due {dueDate}</Preview>
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'sans-serif' }}>
        <Container style={{ maxWidth: '580px', margin: '0 auto', padding: '20px' }}>
          <Section style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '32px' }}>
            <Heading as="h2" style={{ color: '#1a1a2e', marginBottom: '8px' }}>
              Invoice {invoiceNumber}
            </Heading>
            <Text style={{ color: '#555', marginBottom: '24px' }}>
              Hi {clientName},
            </Text>
            <Text style={{ color: '#555' }}>
              A new invoice has been created for you from <strong>{organizationName}</strong>.
            </Text>

            <Section style={{ backgroundColor: '#f6f9fc', borderRadius: '6px', padding: '20px', margin: '24px 0' }}>
              <Text style={{ margin: '4px 0', color: '#333' }}>
                <strong>Invoice:</strong> {invoiceNumber}
              </Text>
              <Text style={{ margin: '4px 0', color: '#333' }}>
                <strong>Amount:</strong> {amount}
              </Text>
              <Text style={{ margin: '4px 0', color: '#333' }}>
                <strong>Due Date:</strong> {dueDate}
              </Text>
            </Section>

            <Button
              href={invoiceUrl}
              style={{
                backgroundColor: '#3b82f6',
                color: '#fff',
                padding: '12px 24px',
                borderRadius: '6px',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              View & Pay Invoice
            </Button>

            <Hr style={{ margin: '32px 0', borderColor: '#e5e7eb' }} />
            <Text style={{ color: '#9ca3af', fontSize: '12px' }}>
              {organizationName} · This is an automated email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
