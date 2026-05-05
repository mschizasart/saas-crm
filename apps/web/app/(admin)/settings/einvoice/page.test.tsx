import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EInvoiceSettingsPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const SETTINGS = {
  id: 'ei1',
  organizationId: 'org1',
  format: 'PEPPOL_UBL_2_1',
  senderId: '1234567890123',
  senderIdScheme: '0088',
  senderName: 'Acme GmbH',
  senderTaxId: 'DE123',
  senderAddress: 'Hauptstr. 1',
  senderCity: 'Berlin',
  senderPostcode: '10115',
  senderCountry: 'DE',
  defaultCurrency: 'EUR',
  paymentMeansCode: '30',
  customXmlSnippet: '',
  enabled: false,
};

function setupApiMock(settings: unknown = SETTINGS) {
  globalThis.mockApiFetch.mockImplementation(async () => jsonOk(settings));
}

describe('E-Invoice settings page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupApiMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the E-Invoice heading', async () => {
    render(<EInvoiceSettingsPage />);
    expect(
      await screen.findByRole('heading', { name: /e-invoice/i }),
    ).toBeInTheDocument();
  });

  it('renders the format radio options', async () => {
    render(<EInvoiceSettingsPage />);
    expect(await screen.findByText(/peppol ubl 2\.1/i)).toBeInTheDocument();
    // "Factur-X" is also mentioned in the page description text — assert
    // at least one match (the radio label).
    expect(screen.getAllByText(/factur-x/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/generic ubl 2\.1/i)).toBeInTheDocument();
  });

  it('renders the sender block', async () => {
    render(<EInvoiceSettingsPage />);
    expect(await screen.findByText(/sender \(your organization\)/i)).toBeInTheDocument();
  });

  it('renders the activation toggle', async () => {
    render(<EInvoiceSettingsPage />);
    expect(await screen.findByText(/^activation$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/e-invoice generation is active/i),
    ).toBeInTheDocument();
  });

  it('renders the document-defaults and custom-xml sections', async () => {
    render(<EInvoiceSettingsPage />);
    expect(await screen.findByText(/document defaults/i)).toBeInTheDocument();
    expect(screen.getByText(/custom xml snippet/i)).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<EInvoiceSettingsPage />);
    await screen.findByText(/peppol ubl 2\.1/i);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
