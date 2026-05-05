import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PageHeader } from './page-header';

describe('PageHeader component', () => {
  it('renders the title as an <h1>', () => {
    render(<PageHeader title="My page" />);
    const h = screen.getByRole('heading', { level: 1, name: 'My page' });
    expect(h).toBeInTheDocument();
  });

  it('renders the optional subtitle', () => {
    render(<PageHeader title="Clients" subtitle="Manage your accounts" />);
    expect(screen.getByText('Manage your accounts')).toBeInTheDocument();
  });

  it('renders a back link when backHref is provided', () => {
    render(<PageHeader title="Detail" backHref="/clients" />);
    const back = screen.getByRole('link', { name: /back/i });
    expect(back).toHaveAttribute('href', '/clients');
  });

  it('renders a primary action as a link when href is given', () => {
    render(
      <PageHeader
        title="Clients"
        primaryAction={{ label: 'New client', href: '/clients/new' }}
      />,
    );
    const link = screen.getByRole('link', { name: /new client/i });
    expect(link).toHaveAttribute('href', '/clients/new');
  });

  it('renders a primary action as a button + fires onClick when no href is given', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PageHeader
        title="Clients"
        primaryAction={{ label: 'Refresh', onClick }}
      />,
    );
    const btn = screen.getByRole('button', { name: /refresh/i });
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders multiple secondary actions in order before the primary', () => {
    render(
      <PageHeader
        title="X"
        primaryAction={{ label: 'Save' }}
        secondaryActions={[
          { label: 'Export' },
          { label: 'Import' },
        ]}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Last button is the primary action — secondary first.
    const labels = buttons.map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Export', 'Import', 'Save']);
  });

  it('renders extra children inline (e.g. status pills)', () => {
    render(
      <PageHeader title="X">
        <span data-testid="extras">extras</span>
      </PageHeader>,
    );
    expect(screen.getByTestId('extras')).toBeInTheDocument();
  });

  it('does not render a back link when backHref is omitted', () => {
    render(<PageHeader title="Plain" />);
    expect(screen.queryByRole('link', { name: /back/i })).not.toBeInTheDocument();
  });
});
