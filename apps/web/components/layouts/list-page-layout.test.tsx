import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ListPageLayout } from './list-page-layout';

describe('ListPageLayout component', () => {
  it('renders the page title as a heading', () => {
    render(
      <ListPageLayout title="Invoices">
        <div />
      </ListPageLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Invoices' })).toBeInTheDocument();
  });

  it('renders the subtitle when provided', () => {
    render(
      <ListPageLayout title="Invoices" subtitle="Track money in flight">
        <div />
      </ListPageLayout>,
    );
    expect(screen.getByText('Track money in flight')).toBeInTheDocument();
  });

  it('renders a primary action link', () => {
    render(
      <ListPageLayout
        title="Clients"
        primaryAction={{ label: 'New', href: '/clients/new' }}
      >
        <div />
      </ListPageLayout>,
    );
    const link = screen.getByRole('link', { name: /new/i });
    expect(link).toHaveAttribute('href', '/clients/new');
  });

  it('renders secondary actions and triggers onClick', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ListPageLayout
        title="X"
        secondaryActions={[{ label: 'Export', onClick }]}
      >
        <div />
      </ListPageLayout>,
    );
    await user.click(screen.getByRole('button', { name: /export/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders the filters slot above the children', () => {
    render(
      <ListPageLayout
        title="X"
        filters={<div data-testid="filters">filters</div>}
      >
        <div data-testid="content">content</div>
      </ListPageLayout>,
    );
    expect(screen.getByTestId('filters')).toBeInTheDocument();
    expect(screen.getByTestId('content')).toBeInTheDocument();
  });

  it('renders the pagination slot under the children', () => {
    render(
      <ListPageLayout
        title="X"
        pagination={<nav data-testid="pagination" aria-label="Pagination" />}
      >
        <div data-testid="content">c</div>
      </ListPageLayout>,
    );
    expect(screen.getByTestId('pagination')).toBeInTheDocument();
  });

  it('always renders children inside the layout', () => {
    render(
      <ListPageLayout title="X">
        <table data-testid="table" />
      </ListPageLayout>,
    );
    expect(screen.getByTestId('table')).toBeInTheDocument();
  });

  it('applies fullHeight wrapper classes when fullHeight is true', () => {
    const { container } = render(
      <ListPageLayout title="X" fullHeight>
        <div data-testid="c" />
      </ListPageLayout>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('flex');
    expect(root.className).toContain('h-full');
  });
});
