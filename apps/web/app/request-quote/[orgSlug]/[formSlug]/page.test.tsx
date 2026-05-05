import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/navigation');
  return {
    ...actual,
    useRouter: () => globalThis.mockRouter,
    useSearchParams: () => globalThis.mockSearchParams,
    usePathname: () => '/request-quote/acme/estimate',
    useParams: () => ({ orgSlug: 'acme', formSlug: 'estimate' }),
    redirect: vi.fn(),
    notFound: vi.fn(),
  };
});

import PublicEstimateRequestFormPage from './page';

const FORM = {
  name: 'Estimate Request',
  title: 'Request a quote',
  description: "We'll get back to you within 1 business day.",
  captchaEnabled: false,
  redirectUrl: null,
  fields: [
    { key: 'company', label: 'Company', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'phone', label: 'Phone', type: 'phone', required: false },
    { key: 'budget', label: 'Budget (USD)', type: 'number', required: false },
    {
      key: 'project_type',
      label: 'Project type',
      type: 'select',
      required: false,
      options: ['Website', 'Mobile app', 'Consulting'],
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

describe('Public estimate-request form page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the form title and description', async () => {
    render(<PublicEstimateRequestFormPage />);
    expect(await screen.findByRole('heading', { name: /request a quote/i })).toBeInTheDocument();
    expect(screen.getByText(/get back to you within/i)).toBeInTheDocument();
  });

  it('renders one input/control per public field', async () => {
    render(<PublicEstimateRequestFormPage />);
    expect(await screen.findByLabelText(/company/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/budget/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/project type/i)).toBeInTheDocument();
  });

  it('renders a disabled submit button until required fields are filled', async () => {
    render(<PublicEstimateRequestFormPage />);
    const btn = await screen.findByRole('button', { name: /submit/i });
    expect(btn).toBeDisabled();
  });

  it('renders the "Form not available" state when the API returns 404', async () => {
    setupFetchMock({}, false, 404);
    render(<PublicEstimateRequestFormPage />);
    expect(await screen.findByRole('heading', { name: /form not available/i })).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<PublicEstimateRequestFormPage />);
    await screen.findByRole('heading', { name: /request a quote/i });
    expect(consoleError).not.toHaveBeenCalled();
  });
});
