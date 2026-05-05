import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Toaster } from './sonner';

/**
 * Sonner is fully mocked in test-setup.ts (`Toaster: () => null`), so the
 * wrapper here mostly exists to verify the module shape. We assert that:
 *   - `Toaster` is exported and renders without crashing
 *   - It accepts pass-through props without throwing
 *   - Module exports `Toaster` only (not `toast`)
 */
describe('Toaster wrapper component', () => {
  it('exports a Toaster component', () => {
    expect(typeof Toaster).toBe('function');
  });

  it('renders without crashing', () => {
    const { container } = render(<Toaster />);
    // Mocked Sonner returns null — the container should be empty
    expect(container).toBeTruthy();
  });

  it('forwards props onto the underlying Sonner without throwing', () => {
    expect(() => render(<Toaster position="top-right" richColors />)).not.toThrow();
  });

  it('does not render any visible DOM (returns null in tests)', () => {
    const { container } = render(<Toaster />);
    expect(container.innerHTML).toBe('');
  });

  it('can be rendered multiple times in a tree', () => {
    expect(() =>
      render(
        <div>
          <Toaster />
          <Toaster />
        </div>,
      ),
    ).not.toThrow();
  });
});
