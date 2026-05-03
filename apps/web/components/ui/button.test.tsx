import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button component', () => {
  it('renders children with primary variant + medium size by default', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn).toBeInTheDocument();
    // default styles applied
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('px-4');
    // default type=button (not submit) — important to avoid surprise form submits
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('applies the right classes for each variant', () => {
    const { rerender } = render(<Button variant="secondary">x</Button>);
    expect(screen.getByRole('button').className).toContain('border-gray-200');

    rerender(<Button variant="ghost">x</Button>);
    expect(screen.getByRole('button').className).toContain('hover:bg-gray-50');

    rerender(<Button variant="destructive">x</Button>);
    expect(screen.getByRole('button').className).toContain('bg-red-600');
  });

  it('applies the right classes for each size', () => {
    const { rerender } = render(<Button size="sm">x</Button>);
    expect(screen.getByRole('button').className).toContain('px-3');

    rerender(<Button size="lg">x</Button>);
    expect(screen.getByRole('button').className).toContain('px-5');
  });

  it('shows the loading spinner and disables interaction when loading', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const btn = screen.getByRole('button', { name: /saving/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    // spinner has aria-hidden so it's part of the button's a11y tree as decoration
    const spinner = btn.querySelector('svg');
    expect(spinner).toBeTruthy();
    expect(spinner?.classList.contains('animate-spin')).toBe(true);

    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires onClick when enabled and not loading', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    await user.click(screen.getByRole('button', { name: /click me/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('respects the disabled prop and ignores clicks', async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Nope
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders the optional leading icon', () => {
    render(
      <Button icon={<span data-testid="icon">★</span>}>With icon</Button>,
    );
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /with icon/i })).toBeInTheDocument();
  });

  it('forwards extra HTML attributes (aria-label, data-*) to the button element', () => {
    render(
      <Button aria-label="Custom" data-testid="b">
        x
      </Button>,
    );
    const b = screen.getByTestId('b');
    expect(b).toHaveAttribute('aria-label', 'Custom');
  });
});
