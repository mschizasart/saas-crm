import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReportsHubPage from './page';

describe('Reports hub page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Reports heading', () => {
    render(<ReportsHubPage />);
    expect(screen.getByRole('heading', { level: 1, name: /^reports$/i })).toBeInTheDocument();
  });

  it('renders a card for each canonical report', () => {
    render(<ReportsHubPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /sales report/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /leads report/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /income & expenses/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /clients report/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /time tracking/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /support tickets/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /profit & loss/i })).toBeInTheDocument();
  });

  it('renders each card as a link to /reports/*', () => {
    render(<ReportsHubPage />);
    expect(screen.getByRole('link', { name: /sales report/i })).toHaveAttribute(
      'href',
      '/reports/sales',
    );
    expect(screen.getByRole('link', { name: /leads report/i })).toHaveAttribute(
      'href',
      '/reports/leads',
    );
    expect(screen.getByRole('link', { name: /clients report/i })).toHaveAttribute(
      'href',
      '/reports/clients',
    );
  });

  it('renders the page subtitle / description', () => {
    render(<ReportsHubPage />);
    expect(
      screen.getByText(/analytics across sales, leads, finance/i),
    ).toBeInTheDocument();
  });

  it('does not surface React render errors', () => {
    render(<ReportsHubPage />);
    expect(consoleError).not.toHaveBeenCalled();
  });
});
