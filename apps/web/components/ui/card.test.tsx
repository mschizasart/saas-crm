import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardBody, CardFooter } from './card';

describe('Card component', () => {
  it('renders children', () => {
    render(
      <Card>
        <p>Hello</p>
      </Card>,
    );
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies the base border + rounded + bg classes by default', () => {
    const { container } = render(<Card>x</Card>);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain('rounded-xl');
    expect(root.className).toContain('border');
    expect(root.className).toContain('shadow-sm');
  });

  it('does not apply padding when padding=none (default)', () => {
    const { container } = render(<Card>x</Card>);
    const root = container.firstChild as HTMLElement;
    // PADDING_CLASSES.none === '' — root shouldn't carry p-* classes from this map
    expect(/(^|\s)p-(3|4|6)(\s|$)/.test(root.className)).toBe(false);
  });

  it('applies padding="md" when requested', () => {
    const { container } = render(<Card padding="md">x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('p-4');
  });

  it('merges a custom className prop', () => {
    const { container } = render(<Card className="custom-cls">x</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('custom-cls');
  });

  it('forwards extra div props (data-*, aria-*)', () => {
    render(
      <Card data-testid="c" aria-label="My card">
        x
      </Card>,
    );
    const c = screen.getByTestId('c');
    expect(c).toHaveAttribute('aria-label', 'My card');
  });

  it('CardHeader, CardBody, and CardFooter render with their default padding', () => {
    const { container } = render(
      <Card>
        <CardHeader>head</CardHeader>
        <CardBody>body</CardBody>
        <CardFooter>foot</CardFooter>
      </Card>,
    );
    const [head, body, foot] = container.querySelectorAll(':scope > div > div');
    expect(head.className).toContain('p-4');
    expect(body.className).toContain('p-4');
    expect(foot.className).toContain('p-4');
    // Header has bottom border, footer has top border + bg
    expect(head.className).toContain('border-b');
    expect(foot.className).toContain('border-t');
  });
});
