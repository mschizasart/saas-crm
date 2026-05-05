import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import TasksPage from './page';

const TASKS_RESPONSE = {
  data: [
    {
      id: 't1',
      name: 'Write proposal',
      status: 'in_progress',
      priority: 'high',
      dueDate: '2026-04-10',
      project: { id: 'pr1', name: 'Website refresh' },
      assignments: [{ user: { id: 'u1', firstName: 'Marios', lastName: 'S' } }],
    },
    {
      id: 't2',
      name: 'Review PR',
      status: 'not_started',
      priority: 'medium',
      dueDate: null,
      project: null,
      assignments: [],
    },
  ],
};

function setupFetchMock(body: unknown = TASKS_RESPONSE) {
  window.localStorage.setItem('access_token', 'test-token');
  global.fetch = vi.fn(async () =>
    ({ ok: true, status: 200, json: async () => body } as unknown as Response),
  ) as unknown as typeof fetch;
}

describe('Tasks page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFetchMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Tasks heading', async () => {
    render(<TasksPage />);
    expect(
      await screen.findByRole('heading', { name: /^tasks$/i }),
    ).toBeInTheDocument();
  });

  it('renders the "New Task" CTA pointing at /tasks/new', async () => {
    render(<TasksPage />);
    const link = await screen.findByRole('link', { name: /new task/i });
    expect(link).toHaveAttribute('href', '/tasks/new');
  });

  it('renders the All Tasks / My Tasks tabs', async () => {
    render(<TasksPage />);
    expect(await screen.findByRole('tab', { name: /all tasks/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /my tasks/i })).toBeInTheDocument();
  });

  it('renders rows for each task', async () => {
    render(<TasksPage />);
    expect(await screen.findByText('Write proposal')).toBeInTheDocument();
    expect(screen.getByText('Review PR')).toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<TasksPage />);
    await screen.findByText('Write proposal');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
