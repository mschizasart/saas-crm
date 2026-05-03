import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * react-signature-canvas wraps a real <canvas> with mouse/touch handlers,
 * which jsdom doesn't paint. Mock it with a minimal stub that exposes the
 * same imperative API the SignaturePad component reaches into:
 *   ref.current.isEmpty(), .clear(), .toDataURL()
 *
 * Tests can drive these by reading `mockSigState`.
 */
const { mockSigState } = vi.hoisted(() => ({
  mockSigState: { empty: true, cleared: 0, toDataUrlCalls: 0 },
}));

vi.mock('react-signature-canvas', async () => {
  const React = await import('react');
  const Canvas = React.forwardRef<unknown, any>(function MockCanvas(
    props: any,
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => mockSigState.empty,
      clear: () => {
        mockSigState.cleared++;
        mockSigState.empty = true;
      },
      toDataURL: (_mime: string) => {
        mockSigState.toDataUrlCalls++;
        return 'data:image/png;base64,FAKE_SIG';
      },
    }));
    return React.createElement('canvas', {
      'data-testid': 'sig-canvas',
      onMouseUp: props.onEnd,
      ...(props.canvasProps ?? {}),
    });
  });
  return { __esModule: true, default: Canvas };
});

import { SignaturePad } from './signature-pad';

beforeEach(() => {
  mockSigState.empty = true;
  mockSigState.cleared = 0;
  mockSigState.toDataUrlCalls = 0;
});

describe('SignaturePad component', () => {
  it('renders the canvas + clear button + consent text', () => {
    render(<SignaturePad onSignature={() => {}} />);
    expect(screen.getByTestId('sig-canvas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
    expect(
      screen.getByText(/by signing, i agree to the document content above/i),
    ).toBeInTheDocument();
  });

  it('shows the "Sign here" placeholder when the pad is empty', () => {
    render(<SignaturePad onSignature={() => {}} />);
    expect(screen.getByText(/sign here/i)).toBeInTheDocument();
  });

  it('calls onSignature(null) when Clear is clicked', async () => {
    const user = userEvent.setup();
    const onSignature = vi.fn();
    render(<SignaturePad onSignature={onSignature} />);
    await user.click(screen.getByRole('button', { name: /clear/i }));
    expect(mockSigState.cleared).toBe(1);
    expect(onSignature).toHaveBeenCalledWith(null);
  });

  it('emits a data URL via onSignature on stroke end (non-empty)', async () => {
    const user = userEvent.setup();
    const onSignature = vi.fn();
    render(<SignaturePad onSignature={onSignature} />);

    // Simulate user finishing a stroke by firing the canvas's onEnd through mouseUp.
    mockSigState.empty = false;
    await user.click(screen.getByTestId('sig-canvas'));

    expect(mockSigState.toDataUrlCalls).toBeGreaterThanOrEqual(1);
    expect(onSignature).toHaveBeenCalledWith(
      expect.stringMatching(/^data:image\/png;base64,/),
    );
  });

  it('emits null on stroke end when the pad reports empty', async () => {
    const user = userEvent.setup();
    const onSignature = vi.fn();
    render(<SignaturePad onSignature={onSignature} />);

    mockSigState.empty = true;
    await user.click(screen.getByTestId('sig-canvas'));

    expect(mockSigState.toDataUrlCalls).toBe(0);
    expect(onSignature).toHaveBeenCalledWith(null);
  });

  it('shows "Signature captured" once the pad has content', async () => {
    const user = userEvent.setup();
    render(<SignaturePad onSignature={() => {}} />);
    mockSigState.empty = false;
    await user.click(screen.getByTestId('sig-canvas'));
    expect(await screen.findByText(/signature captured/i)).toBeInTheDocument();
  });

  it('respects the height prop on the canvas wrapper style', () => {
    render(<SignaturePad height={250} onSignature={() => {}} />);
    const canvas = screen.getByTestId('sig-canvas') as HTMLCanvasElement;
    // canvasProps.style.height === `${height}px`
    expect(canvas.style.height).toBe('250px');
  });
});
