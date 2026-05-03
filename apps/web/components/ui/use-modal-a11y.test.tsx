import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useModalA11y } from './use-modal-a11y';

/**
 * Tiny harness component — exercises the hook in a realistic shape:
 * an outer trigger button that toggles open state, and a dialog with
 * two focusable buttons inside.
 */
function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useModalA11y(open, () => {
    onClose();
    setOpen(false);
  });

  return (
    <>
      <button onClick={() => setOpen(true)}>Open dialog</button>
      {open ? (
        <div ref={ref} role="dialog" aria-label="Test">
          <button>First</button>
          <button>Second</button>
        </div>
      ) : null}
    </>
  );
}

describe('useModalA11y hook', () => {
  it('moves focus to the first focusable element when opened', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    // After mount the hook should focus "First".
    const first = screen.getByRole('button', { name: 'First' });
    expect(first).toHaveFocus();
  });

  it('fires onClose when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element on unmount', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const opener = screen.getByRole('button', { name: 'Open dialog' });
    opener.focus();
    expect(opener).toHaveFocus();

    await user.click(opener);
    await user.keyboard('{Escape}');

    // After Escape, the dialog unmounts; the hook restores focus to opener.
    expect(opener).toHaveFocus();
  });

  it('locks body scroll while open and restores on close', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);

    expect(document.body.style.overflow).toBe('');
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('traps Tab focus — Tab from last element wraps back to first', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });

    // Move focus to "Second", then Tab — should wrap.
    second.focus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it('traps Shift+Tab focus — Shift+Tab from first wraps to last', async () => {
    const user = userEvent.setup();
    render(<Harness onClose={() => {}} />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const first = screen.getByRole('button', { name: 'First' });
    const second = screen.getByRole('button', { name: 'Second' });

    first.focus();
    await user.tab({ shift: true });
    expect(second).toHaveFocus();
  });

  it('does nothing while isOpen=false', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    // Without opening, body shouldn't be locked and Escape should not fire.
    expect(document.body.style.overflow).toBe('');
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });
});
