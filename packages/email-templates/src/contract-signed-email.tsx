import { Body, Container, Head, Heading, Html, Preview, Text } from '@react-email/components';
import * as React from 'react';

export function ContractSignedEmail(props: Record<string, string>) {
  return (
    <Html>
      <Head />
      <Preview>Contract signed — {contractSubject}</Preview>
      <Body style={{ backgroundColor: '#f6f9fc', fontFamily: 'sans-serif' }}>
        <Container style={{ maxWidth: '580px', margin: '0 auto', padding: '20px' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '8px', padding: '32px' }}>
            <Heading as="h2" style={{ color: '#1a1a2e' }}>ContractSignedEmail</Heading>
            <Text>{JSON.stringify(props)}</Text>
          </div>
        </Container>
      </Body>
    </Html>
  );
}
