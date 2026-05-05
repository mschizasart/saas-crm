import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Spinner } from './spinner';

describe('Spinner component', () => {
  it('renders with role=status by default', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the medium size by default', () => {
    const { container } = render(<Spinner />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('w-6')).toBe(true);
    expect(svg?.classList.contains('h-6')).toBe(true);
  });

  it('applies the small size class when size="sm"', () => {
    const { container } = render(<Spinner size="sm" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('w-4')).toBe(true);
    expect(svg?.classList.contains('h-4')).toBe(true);
  });

  it('applies the large size class when size="lg"', () => {
    const { container } = render(<Spinner size="lg" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('w-8')).toBe(true);
    expect(svg?.classList.contains('h-8')).toBe(true);
  });

  it('animates the inner icon', () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector('svg')?.classList.contains('animate-spin')).toBe(true);
  });

  it('renders an sr-only label when one is provided', () => {
    render(<Spinner label="Loading data" />);
    const label = screen.getByText('Loading data');
    expect(label).toBeInTheDocument();
    expect(label.classList.contains('sr-only')).toBe(true);
  });

  it('forwards a custom className onto the wrapper span', () => {
    const { container } = render(<Spinner className="my-extra-cls" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('my-extra-cls');
    // base classes still present
    expect(root.className).toContain('text-primary');
  });
});
