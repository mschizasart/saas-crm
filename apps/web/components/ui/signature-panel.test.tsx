import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignaturePanel } from './signature-panel';

const COMPLETED_SIG = {
  id: 'sig-1',
  signerName: 'Jane Doe',
  signerEmail: 'jane@example.com',
  signedAt: '2026-04-10T14:00:00Z',
  ipAddress: '203.0.113.42',
  userAgent: 'Mozilla/5.0 Test',
  geoCountry: 'US',
  isCompleted: true,
  imageUrl: 'data:image/png;base64,xxx',
  auditEvents: [
    { at: '2026-04-10T13:55:00Z', type: 'opened', ip: '203.0.113.42', detail: 'first view' },
    { at: '2026-04-10T14:00:00Z', type: 'signed', ip: '203.0.113.42' },
  ],
};

const AWAITING_SIG = {
  id: 'sig-2',
  signerName: '',
  signerEmail: '',
  signedAt: '',
  ipAddress: '',
  userAgent: '',
  isCompleted: false,
  auditEvents: [
    { at: '2026-04-09T10:00:00Z', type: 'sent', detail: 'email sent' },
  ],
};

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  globalThis.fetch = vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

describe('SignaturePanel component', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the loading state then the "Signed" status pill when complete', async () => {
    mockFetchOnce(COMPLETED_SIG);
    render(<SignaturePanel documentType="proposal" documentId="p1" />);
    expect(await screen.findByText('Signed')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByText('jane@example.com')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.42')).toBeInTheDocument();
    expect(screen.getByText('US')).toBeInTheDocument();
  });

  it('renders the audit trail table when events are present', async () => {
    mockFetchOnce(COMPLETED_SIG);
    render(<SignaturePanel documentType="contract" documentId="c1" />);
    await screen.findByText('Signed');
    expect(screen.getByText('Audit Trail')).toBeInTheDocument();
    expect(screen.getByText('opened')).toBeInTheDocument();
    expect(screen.getByText('signed')).toBeInTheDocument();
  });

  it('shows the "Awaiting signature" UI when isCompleted is false', async () => {
    mockFetchOnce(AWAITING_SIG);
    render(
      <SignaturePanel
        documentType="contract"
        documentId="c1"
        publicHash="abc123"
        publicLinkBase="/portal/contracts/sign"
      />,
    );
    expect(await screen.findByText(/awaiting signature/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    // Recent activity from auditEvents is rendered
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText('sent')).toBeInTheDocument();
  });

  it('opens the revoke confirmation modal when "Revoke signature" is clicked', async () => {
    mockFetchOnce(COMPLETED_SIG);
    const user = userEvent.setup();
    render(<SignaturePanel documentType="proposal" documentId="p1" />);
    await screen.findByText('Signed');
    await user.click(screen.getByRole('button', { name: /revoke signature/i }));
    expect(screen.getByText(/revoke this signature\?/i)).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/reason \(optional\)/i),
    ).toBeInTheDocument();
  });

  it('closes the revoke modal when Cancel is clicked', async () => {
    mockFetchOnce(COMPLETED_SIG);
    const user = userEvent.setup();
    render(<SignaturePanel documentType="proposal" documentId="p1" />);
    await screen.findByText('Signed');
    await user.click(screen.getByRole('button', { name: /revoke signature/i }));
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText(/revoke this signature\?/i)).not.toBeInTheDocument();
    });
  });

  it('renders nothing crashy when the fetch errors out', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('Network');
    }) as unknown as typeof fetch;

    render(<SignaturePanel documentType="contract" documentId="c1" />);
    // Component swallows the error and renders the awaiting block
    expect(await screen.findByText(/awaiting signature/i)).toBeInTheDocument();
  });
});
