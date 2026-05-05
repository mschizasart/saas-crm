import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// Layer a useParams mock on top of the global next/navigation mock from
// test-setup.ts. We reuse the existing usePathname/useRouter/useSearchParams
// shapes provided there.
vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/navigation');
  return {
    ...actual,
    useRouter: () => globalThis.mockRouter,
    useSearchParams: () => globalThis.mockSearchParams,
    usePathname: () => '/forms/acme/lead',
    useParams: () => ({ orgSlug: 'acme', formSlug: 'lead' }),
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});

import PublicLeadFormPage from './page';

const FORM = {
  name: 'Lead Capture',
  title: 'Get a quote',
  description: 'Tell us about your project.',
  captchaEnabled: false,
  redirectUrl: null,
  fields: [
    { key: 'name', label: 'Your name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'message', label: 'Message', type: 'textarea', required: false },
    {
      key: 'budget',
      label: 'Budget',
      type: 'select',
      required: false,
      options: ['<$1k', '$1k-$10k', '>$10k'],
    },
  ],
};

function setupFetchMock(body: unknown = FORM, ok = true, status = 200) {
  global.fetch = vi.fn(async () =>
    ({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as unknown as Response),
  ) as unknown as typeof fetch;
}

describe('Public lead form page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the form title and description from the API', async () => {
    render(<PublicLeadFormPage />);
    expect(await screen.findByRole('heading', { name: /get a quote/i })).toBeInTheDocument();
    expect(screen.getByText(/tell us about your project/i)).toBeInTheDocument();
  });

  it('renders one input/control per public field', async () => {
    render(<PublicLeadFormPage />);
    expect(await screen.findByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/message/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/budget/i)).toBeInTheDocument();
  });

  it('renders the submit button (initially disabled until required fields fill)', async () => {
    render(<PublicLeadFormPage />);
    const btn = await screen.findByRole('button', { name: /submit/i });
    expect(btn).toBeDisabled();
  });

  it('renders an "AppoinlyCRM" attribution footer', async () => {
    render(<PublicLeadFormPage />);
    expect(await screen.findByText(/powered by appoinlycrm/i)).toBeInTheDocument();
  });

  it('renders the "Form not available" state on 404', async () => {
    setupFetchMock({}, false, 404);
    render(<PublicLeadFormPage />);
    expect(await screen.findByRole('heading', { name: /form not available/i })).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<PublicLeadFormPage />);
    await screen.findByRole('heading', { name: /get a quote/i });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
