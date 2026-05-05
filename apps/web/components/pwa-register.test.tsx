import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PwaRegister } from './pwa-register';

/**
 * The component registers /sw.js after page load and listens for "sw:navigate"
 * messages from the service worker. We stub navigator.serviceWorker so the
 * registration is deterministic in jsdom.
 */
describe('PwaRegister component', () => {
  let registerSpy: ReturnType<typeof vi.fn>;
  let addListenerSpy: ReturnType<typeof vi.fn>;
  let removeListenerSpy: ReturnType<typeof vi.fn>;
  let originalSW: PropertyDescriptor | undefined;
  let originalReadyState: PropertyDescriptor | undefined;

  beforeEach(() => {
    registerSpy = vi.fn(() => Promise.resolve());
    addListenerSpy = vi.fn();
    removeListenerSpy = vi.fn();

    originalSW = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        register: registerSpy,
        addEventListener: addListenerSpy,
        removeEventListener: removeListenerSpy,
      },
    });

    originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState');
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      get: () => 'complete',
    });
  });

  afterEach(() => {
    if (originalSW) Object.defineProperty(navigator, 'serviceWorker', originalSW);
    else delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    if (originalReadyState) Object.defineProperty(document, 'readyState', originalReadyState);
  });

  it('returns null and renders nothing visible', () => {
    const { container } = render(<PwaRegister />);
    expect(container.innerHTML).toBe('');
  });

  it('registers /sw.js after mount when readyState is complete', () => {
    render(<PwaRegister />);
    expect(registerSpy).toHaveBeenCalledTimes(1);
    expect(registerSpy).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('attaches a message listener to the service worker', () => {
    render(<PwaRegister />);
    expect(addListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('routes via next/router when a "sw:navigate" message arrives', () => {
    render(<PwaRegister />);
    const handler = addListenerSpy.mock.calls.find(([type]) => type === 'message')?.[1] as
      | ((e: MessageEvent) => void)
      | undefined;
    expect(handler).toBeTypeOf('function');

    handler?.({ data: { type: 'sw:navigate', url: '/invoices/inv-1' } } as MessageEvent);
    expect(globalThis.mockRouter.push).toHaveBeenCalledWith('/invoices/inv-1');
  });

  it('ignores unrelated postMessage payloads', () => {
    render(<PwaRegister />);
    const handler = addListenerSpy.mock.calls.find(([type]) => type === 'message')?.[1] as
      | ((e: MessageEvent) => void)
      | undefined;
    handler?.({ data: { type: 'something-else' } } as MessageEvent);
    expect(globalThis.mockRouter.push).not.toHaveBeenCalled();
  });

  it('cleans up the message listener on unmount', () => {
    const { unmount } = render(<PwaRegister />);
    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('no-ops gracefully when serviceWorker is unavailable', () => {
    delete (navigator as unknown as { serviceWorker?: unknown }).serviceWorker;
    expect(() => render(<PwaRegister />)).not.toThrow();
  });
});
