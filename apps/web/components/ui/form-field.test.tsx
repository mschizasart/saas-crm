import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from './form-field';

describe('FormField component', () => {
  it('renders a label that points at the wrapped input', () => {
    render(
      <FormField label="Email">
        <input data-testid="i" />
      </FormField>,
    );
    const label = screen.getByText('Email');
    const input = screen.getByTestId('i');
    expect(label.tagName).toBe('LABEL');
    // FormField cloned the child to give it the same id the label uses
    expect(label).toHaveAttribute('for', input.id);
    expect(input.id).toBeTruthy();
  });

  it('marks the label with a red asterisk when required', () => {
    const { container } = render(
      <FormField label="Email" required>
        <input />
      </FormField>,
    );
    const star = container.querySelector('label span[aria-hidden="true"]');
    expect(star).toBeTruthy();
    expect(star?.textContent).toBe('*');
  });

  it('passes aria-required onto the input when required', () => {
    render(
      <FormField label="Email" required>
        <input data-testid="i" />
      </FormField>,
    );
    expect(screen.getByTestId('i')).toHaveAttribute('aria-required', 'true');
  });

  it('renders the error message with role=alert and wires aria-invalid + aria-describedby', () => {
    render(
      <FormField label="Email" error="Invalid address">
        <input data-testid="i" />
      </FormField>,
    );
    const err = screen.getByRole('alert');
    expect(err).toHaveTextContent('Invalid address');
    const input = screen.getByTestId('i');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toContain(err.id);
  });

  it('renders a hint when no error is present, but suppresses the hint when an error exists', () => {
    const { rerender } = render(
      <FormField label="Email" hint="We never spam.">
        <input />
      </FormField>,
    );
    expect(screen.getByText('We never spam.')).toBeInTheDocument();

    rerender(
      <FormField label="Email" hint="We never spam." error="Invalid">
        <input />
      </FormField>,
    );
    expect(screen.queryByText('We never spam.')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid');
  });

  it('respects a disabled child input (disabled is the input owner; FormField does not strip it)', () => {
    render(
      <FormField label="Email">
        <input disabled data-testid="i" />
      </FormField>,
    );
    expect(screen.getByTestId('i')).toBeDisabled();
  });

  it('uses the provided htmlFor + child id when supplied', () => {
    render(
      <FormField label="Custom" htmlFor="my-field">
        <input id="my-field" data-testid="i" />
      </FormField>,
    );
    expect(screen.getByText('Custom')).toHaveAttribute('for', 'my-field');
    expect(screen.getByTestId('i')).toHaveAttribute('id', 'my-field');
  });
});
