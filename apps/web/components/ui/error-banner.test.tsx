import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBanner } from './error-banner';

describe('ErrorBanner component', () => {
  it('renders the message and uses role=alert', () => {
    render(<ErrorBanner message="Something went wrong" />);
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(alert).toHaveTextContent('Something went wrong');
  });

  it('does NOT render a Retry button when onRetry is omitted', () => {
    render(<ErrorBanner message="boom" />);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('fires onRetry when the Retry button is clicked', async () => {
    const onRetry = vi.fn();
    render(<ErrorBanner message="oops" onRetry={onRetry} />);
    const btn = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows a dismiss button when onDismiss is provided and fires it on click', async () => {
    const onDismiss = vi.fn();
    render(<ErrorBanner message="x" onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss error/i });
    await userEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('renders both retry + dismiss when both handlers are provided', () => {
    render(
      <ErrorBanner message="x" onRetry={() => {}} onDismiss={() => {}} />,
    );
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dismiss error/i })).toBeInTheDocument();
  });

  it('accepts a ReactNode message (not just a string)', () => {
    render(
      <ErrorBanner
        message={
          <span>
            Failed: <strong>connection lost</strong>
          </span>
        }
      />,
    );
    expect(screen.getByText('connection lost')).toBeInTheDocument();
  });

  it('applies a custom className when provided', () => {
    const { container } = render(
      <ErrorBanner message="x" className="my-extra-cls" />,
    );
    expect((container.firstChild as HTMLElement).className).toContain('my-extra-cls');
  });
});
