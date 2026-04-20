'use client';
import { useEffect, useRef } from 'react';

/**
 * Accessibility hook for modal dialogs.
 *
 * - Traps Tab/Shift+Tab focus within the modal panel.
 * - Closes the modal on Escape.
 * - Moves initial focus to the first focusable element.
 * - Restores focus to the previously-focused element on close.
 * - Locks body scroll while the modal is open.
 *
 * Usage:
 *   const containerRef = useModalA11y(isOpen, onClose);
 *   ...
 *   return isOpen ? (
 *     <div className="backdrop">
 *       <div ref={containerRef} role="dialog" aria-modal="true" aria-labelledby="id">
 *         ...
 *       </div>
 *     </div>
 *   ) : null;
 */
export function useModalA11y(isOpen: boolean, onClose: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.activeElement as HTMLElement | null;
    // focus first focusable element on mount
    const selectors =
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = containerRef.current?.querySelector<HTMLElement>(selectors);
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusables =
        containerRef.current?.querySelectorAll<HTMLElement>(selectors);
      if (!focusables || focusables.length === 0) return;
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        lastEl.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        firstEl.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [isOpen, onClose]);
  return containerRef;
}
