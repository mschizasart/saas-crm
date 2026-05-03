import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { AiImproveButton } from './ai-improve-button';
import { jsonOk, jsonError } from '@/test-fixtures/api';

const LONG_TEXT =
  'Hello team, here is a draft of the announcement that we should send out tomorrow morning.';

describe('AiImproveButton component', () => {
  it('renders the trigger with the default "Improve" label', () => {
    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);
    expect(screen.getByRole('button', { name: /improve/i })).toBeInTheDocument();
  });

  it('disables the trigger when text is too short (<20 chars)', () => {
    render(<AiImproveButton text="Hi there" onAccept={() => {}} />);
    expect(screen.getByRole('button', { name: /improve/i })).toBeDisabled();
  });

  it('opens the tone-picker popover with all six tone radios on click', async () => {
    const user = userEvent.setup();
    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);

    await user.click(screen.getByRole('button', { name: /improve/i }));

    expect(await screen.findByRole('dialog', { name: /rewrite tone/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Professional/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Friendly/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Concise/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Persuasive/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Expand/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Shorten/i)).toBeInTheDocument();
  });

  it('calls /api/v1/ai/improve-text on submit and shows the review panel with the improved text', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch.mockResolvedValueOnce(
      jsonOk({ improved: 'Polished version of the draft.' }),
    );

    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);

    await user.click(screen.getByRole('button', { name: /improve/i }));
    // Click "Improve" inside the popover (it's the second button labelled "Improve").
    const buttons = screen.getAllByRole('button', { name: /improve/i });
    // The submit button is the last "Improve" rendered (inside the panel footer).
    await user.click(buttons[buttons.length - 1]);

    await waitFor(() => {
      expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/ai/improve-text',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    // Review panel shows up
    expect(await screen.findByText('Polished version of the draft.')).toBeInTheDocument();
    expect(screen.getByText(/use this/i)).toBeInTheDocument();
    expect(screen.getByText(/keep original/i)).toBeInTheDocument();
  });

  it('calls onAccept(improvedText) when the user clicks "Use this"', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    globalThis.mockApiFetch.mockResolvedValueOnce(
      jsonOk({ improved: 'Final version.' }),
    );

    render(<AiImproveButton text={LONG_TEXT} onAccept={onAccept} />);

    await user.click(screen.getByRole('button', { name: /improve/i }));
    const submits = screen.getAllByRole('button', { name: /improve/i });
    await user.click(submits[submits.length - 1]);

    const useThis = await screen.findByRole('button', { name: /use this/i });
    await user.click(useThis);

    expect(onAccept).toHaveBeenCalledWith('Final version.');
  });

  it('shows the actionable 503 message when AI is not configured', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonError(503));

    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);

    await user.click(screen.getByRole('button', { name: /improve/i }));
    const submits = screen.getAllByRole('button', { name: /improve/i });
    await user.click(submits[submits.length - 1]);

    expect(
      await screen.findByText(/ai features aren.t configured/i),
    ).toBeInTheDocument();
  });

  it('shows a generic error on unexpected failure (e.g. 500)', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch.mockResolvedValueOnce(jsonError(500));

    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);

    await user.click(screen.getByRole('button', { name: /improve/i }));
    const submits = screen.getAllByRole('button', { name: /improve/i });
    await user.click(submits[submits.length - 1]);

    expect(await screen.findByText(/couldn.t improve text/i)).toBeInTheDocument();
  });

  it('does not call sonner.toast.error on success', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch.mockResolvedValueOnce(
      jsonOk({ improved: 'Polished.' }),
    );
    render(<AiImproveButton text={LONG_TEXT} onAccept={() => {}} />);
    await user.click(screen.getByRole('button', { name: /improve/i }));
    const submits = screen.getAllByRole('button', { name: /improve/i });
    await user.click(submits[submits.length - 1]);
    await screen.findByText('Polished.');
    expect((toast as any).error).not.toHaveBeenCalled();
  });
});
