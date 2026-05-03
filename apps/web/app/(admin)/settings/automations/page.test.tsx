import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AutomationsListPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const RULES = [
  {
    id: 'a1',
    name: 'Auto-tag VIP leads',
    trigger: 'lead_created',
    conditions: { rules: [{ field: 'budget', op: 'gt', value: 10000 }] },
    actions: [{ type: 'tag', value: 'vip' }],
    active: true,
    createdAt: '2026-04-01T00:00:00Z',
    lastRunAt: '2026-04-15T00:00:00Z',
  },
  {
    id: 'a2',
    name: 'Welcome email on client signup',
    trigger: 'client_created',
    conditions: null,
    actions: [{ type: 'email', template: 'welcome' }],
    active: false,
    createdAt: '2026-04-02T00:00:00Z',
    lastRunAt: null,
  },
];

describe('Settings → Automations page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the page heading and a "New automation" link', async () => {
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonOk(RULES));
    render(<AutomationsListPage />);

    expect(
      await screen.findByRole('heading', { name: /automations/i }),
    ).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /new automation/i });
    expect(cta).toHaveAttribute('href', '/settings/automations/new');
  });

  it('renders one row per automation with name + active toggle', async () => {
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonOk(RULES));
    render(<AutomationsListPage />);

    expect(await screen.findByText('Auto-tag VIP leads')).toBeInTheDocument();
    expect(screen.getByText('Welcome email on client signup')).toBeInTheDocument();
    // One Disable, one Enable based on .active
    expect(screen.getByLabelText('Disable automation')).toBeInTheDocument();
    expect(screen.getByLabelText('Enable automation')).toBeInTheDocument();
  });

  it('shows the empty state when the API returns []', async () => {
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonOk([]));
    render(<AutomationsListPage />);

    expect(await screen.findByText(/no automations yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /create automation/i }),
    ).toHaveAttribute('href', '/settings/automations/new');
  });

  it('renders Edit + Delete actions per row', async () => {
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonOk(RULES));
    render(<AutomationsListPage />);
    await screen.findByText('Auto-tag VIP leads');
    const editLinks = screen.getAllByRole('link', { name: /edit/i });
    expect(editLinks.length).toBe(RULES.length);
    const deleteBtns = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteBtns.length).toBe(RULES.length);
  });

  it('toggles active state via PATCH on switch click', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch
      .mockResolvedValueOnce(jsonOk(RULES))
      .mockResolvedValueOnce(jsonOk({})); // PATCH

    render(<AutomationsListPage />);
    await screen.findByText('Auto-tag VIP leads');

    await user.click(screen.getByLabelText('Disable automation'));

    await waitFor(() => {
      expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/automations/a1',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
  });

  it('does not surface React render errors during render', async () => {
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonOk(RULES));
    render(<AutomationsListPage />);
    await screen.findByText('Auto-tag VIP leads');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
