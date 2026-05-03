'use client';

/**
 * Signature pad — a mobile-friendly canvas the client draws on. Returns a
 * base64 PNG data URL via `onSignature(dataUrl)`. Calls `onSignature(null)`
 * when cleared / empty.
 *
 * Wraps `react-signature-canvas` (already in deps). Touch + mouse work out
 * of the box. The "Sign here" placeholder fades when the user starts
 * drawing.
 *
 * Usage:
 *   <SignaturePad
 *     width={600}
 *     height={180}
 *     onSignature={(dataUrl) => setSig(dataUrl)}
 *   />
 */

import { useRef, useState, useEffect } from 'react';
// `react-signature-canvas` ships JS without bundled types — import as
// `unknown` and treat the ref as `any`. The package's runtime API is small
// (clear / isEmpty / toDataURL / onEnd) and stable.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no type declarations available
import SignatureCanvas from 'react-signature-canvas';

interface Props {
  width?: number;
  height?: number;
  onSignature: (dataUrl: string | null) => void;
}

export function SignaturePad({ width = 600, height = 180, onSignature }: Props) {
  const sigRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [actualWidth, setActualWidth] = useState(width);

  // Resize the canvas to its container width on mount + on resize. The
  // signature-canvas library doesn't auto-resize.
  useEffect(() => {
    if (!wrapperRef.current) return;
    const measure = () => {
      const w = wrapperRef.current?.clientWidth ?? width;
      setActualWidth(Math.min(Math.max(w, 200), width));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [width]);

  function handleEnd() {
    const empty = sigRef.current?.isEmpty() ?? true;
    setIsEmpty(empty);
    if (empty) {
      onSignature(null);
      return;
    }
    // toDataURL returns a PNG data URL ("data:image/png;base64,...")
    const dataUrl = sigRef.current?.toDataURL('image/png') ?? null;
    onSignature(dataUrl);
  }

  function clearPad() {
    sigRef.current?.clear();
    setIsEmpty(true);
    onSignature(null);
  }

  return (
    <div className="space-y-2">
      <div
        ref={wrapperRef}
        className="relative border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 overflow-hidden"
      >
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-gray-300 dark:text-gray-600 select-none z-0">
            Sign here
          </div>
        )}
        <SignatureCanvas
          ref={sigRef}
          penColor="#111827"
          minWidth={1.2}
          maxWidth={2.6}
          velocityFilterWeight={0.7}
          onEnd={handleEnd}
          canvasProps={{
            width: actualWidth,
            height,
            className: 'w-full block touch-none cursor-crosshair relative z-10',
            style: { width: '100%', height: `${height}px` },
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clearPad}
          className="text-xs text-gray-500 dark:text-gray-400 hover:text-primary underline"
        >
          Clear
        </button>
        {!isEmpty && (
          <span className="text-xs text-green-600 dark:text-green-400">Signature captured</span>
        )}
      </div>
      <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        By signing, I agree to the document content above and acknowledge this
        is a legal signature equivalent to a wet-ink signature.
      </p>
    </div>
  );
}

export default SignaturePad;
