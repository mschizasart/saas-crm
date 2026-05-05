import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './badge';

describe('Badge component', () => {
  it('renders children with the default variant', () => {
    render(<Badge>Hello</Badge>);
    const el = screen.getByText('Hello');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('bg-gray-100');
    expect(el.className).toContain('rounded-full');
  });

  it('applies the success variant classes', () => {
    render(<Badge variant="success">OK</Badge>);
    expect(screen.getByText('OK').className).toContain('bg-green-100');
  });

  it('applies the warning variant classes', () => {
    render(<Badge variant="warning">Watch</Badge>);
    expect(screen.getByText('Watch').className).toContain('bg-yellow-100');
  });

  it('applies the error variant classes', () => {
    render(<Badge variant="error">Bad</Badge>);
    expect(screen.getByText('Bad').className).toContain('bg-red-100');
  });

  it('applies the info variant classes', () => {
    render(<Badge variant="info">FYI</Badge>);
    expect(screen.getByText('FYI').className).toContain('bg-blue-100');
  });

  it('renders dot-only mode without text and aria-hidden', () => {
    const { container } = render(<Badge variant="success" dotOnly />);
    const dot = container.firstChild as HTMLElement;
    expect(dot.tagName).toBe('SPAN');
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot.className).toContain('bg-green-500');
    expect(dot.className).toContain('rounded-full');
    // children not rendered in dotOnly
    expect(dot.textContent).toBe('');
  });

  it('merges a custom className', () => {
    render(
      <Badge className="custom-cls" variant="info">
        x
      </Badge>,
    );
    expect(screen.getByText('x').className).toContain('custom-cls');
    expect(screen.getByText('x').className).toContain('bg-blue-100');
  });

  it('forwards extra HTML attributes (data-* / aria-label)', () => {
    render(
      <Badge data-testid="b" aria-label="Status">
        x
      </Badge>,
    );
    const b = screen.getByTestId('b');
    expect(b).toHaveAttribute('aria-label', 'Status');
  });
});
