import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from './password-input';

describe('PasswordInput component', () => {
  it('renders a password-typed input by default', () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('exposes an accessible toggle button with the show label', () => {
    render(<PasswordInput aria-label="Password" />);
    const toggle = screen.getByRole('button', { name: /show password/i });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles input type to text when the toggle is clicked', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const toggle = screen.getByRole('button', { name: /show password/i });

    await user.click(toggle);
    expect(input.type).toBe('text');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(toggle).toHaveAccessibleName(/hide password/i);
  });

  it('toggles back to password type on second click', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const toggle = screen.getByRole('button');

    await user.click(toggle);
    await user.click(toggle);
    expect(input.type).toBe('password');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('honours custom show/hide labels', async () => {
    const user = userEvent.setup();
    render(
      <PasswordInput
        aria-label="Pin"
        showLabel="Reveal PIN"
        hideLabel="Conceal PIN"
      />,
    );
    expect(screen.getByRole('button', { name: 'Reveal PIN' })).toBeInTheDocument();

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: 'Conceal PIN' })).toBeInTheDocument();
  });

  it('accepts user typing without losing focus when toggled', async () => {
    const user = userEvent.setup();
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText('Password') as HTMLInputElement;

    await user.type(input, 'secret123');
    expect(input.value).toBe('secret123');
  });

  it('forwards ref to the underlying input', () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<PasswordInput ref={ref} aria-label="Password" />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
