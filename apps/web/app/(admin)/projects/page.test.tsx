import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProjectsPage from './page';

const PROJECTS_RESPONSE = {
  data: [
    {
      id: 'p1',
      name: 'Website refresh',
      client: { id: 'c1', company: 'Acme Co' },
      clientId: 'c1',
      status: 'in_progress',
      progress: 50,
      deadline: '2026-06-01',
      _count: { tasks: 5, members: 2, timeEntries: 18 },
    },
    {
      id: 'p2',
      name: 'Mobile app v2',
      client: { id: 'c2', company: 'Globex' },
      clientId: 'c2',
      status: 'not_started',
      progress: 0,
      deadline: null,
      _count: { tasks: 0, members: 1, timeEntries: 0 },
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const STATS = {
  total: 2,
  not_started: 1,
  in_progress: 1,
  on_hold: 0,
  finished: 0,
  cancelled: 0,
};

function setupFetchMock(body: unknown = PROJECTS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes('/projects/stats')) {
      return { ok: true, status: 200, json: async () => STATS } as unknown as Response;
    }
    if (u.includes('/api/v1/projects')) {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe('Projects page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Projects heading', async () => {
    render(<ProjectsPage />);
    expect(
      await screen.findByRole('heading', { name: /^projects$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Project" CTA pointing at /projects/new', async () => {
    render(<ProjectsPage />);
    const link = await screen.findByRole('link', { name: /new project/i });
    expect(link).toHaveAttribute('href', '/projects/new');
  });

  it('renders project rows', async () => {
    render(<ProjectsPage />);
    // Mobile + desktop layouts both render the project name.
    expect((await screen.findAllByText('Website refresh')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mobile app v2').length).toBeGreaterThan(0);
  });

  it('renders the status filter chips', async () => {
    render(<ProjectsPage />);
    expect(await screen.findByRole('button', { name: /^all$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /not started/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /in progress/i })).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<ProjectsPage />);
    await screen.findAllByText('Website refresh');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
