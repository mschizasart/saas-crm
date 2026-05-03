import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyState } from './empty-state';

describe('EmptyState component', () => {
  it('renders the title', () => {
    render(<EmptyState title="Nothing here" />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Nothing here' }),
    ).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(<EmptyState title="t" description="Try creating one." />);
    expect(screen.getByText('Try creating one.')).toBeInTheDocument();
  });

  it('renders the optional icon', () => {
    render(
      <EmptyState
        title="t"
        icon={<svg data-testid="icon" />}
      />,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders a Link when action.href is provided', () => {
    render(
      <EmptyState
        title="t"
        action={{ label: 'Create one', href: '/things/new' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Create one' });
    expect(link).toHaveAttribute('href', '/things/new');
  });

  it('renders a Button + fires onClick when action.onClick is provided', async () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="t" action={{ label: 'Do it', onClick }} />,
    );
    const btn = screen.getByRole('button', { name: 'Do it' });
    expect(btn).toBeInTheDocument();
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders without action / description / icon when omitted', () => {
    render(<EmptyState title="just a title" />);
    expect(screen.getByText('just a title')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('applies a custom className when provided', () => {
    const { container } = render(
      <EmptyState title="t" className="my-custom-cls" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain(
      'my-custom-cls',
    );
  });
});
