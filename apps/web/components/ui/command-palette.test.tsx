import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { CommandPalette } from './command-palette';
import { jsonOk } from '@/test-fixtures/api';

/**
 * Helper — open the palette via the global Cmd+K listener.
 */
function pressCmdK() {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }),
    );
  });
}

describe('CommandPalette component', () => {
  beforeEach(() => {
    globalThis.mockApiFetch.mockResolvedValue(jsonOk({ results: [] }));
  });

  it('does not render anything when closed', () => {
    const { container } = render(<CommandPalette />);
    expect(container.firstChild).toBeNull();
  });

  it('opens on Cmd+K and shows the search input', async () => {
    render(<CommandPalette />);
    pressCmdK();
    expect(
      await screen.findByRole('dialog', { name: /command palette/i }),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/type to search/i)).toBeInTheDocument();
  });

  it('opens on Ctrl+K too', async () => {
    render(<CommandPalette />);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
      );
    });
    expect(
      await screen.findByRole('dialog', { name: /command palette/i }),
    ).toBeInTheDocument();
  });

  it('renders the static Actions section', async () => {
    render(<CommandPalette />);
    pressCmdK();
    expect(await screen.findByText('Actions')).toBeInTheDocument();
    expect(screen.getByText('Create new lead')).toBeInTheDocument();
    expect(screen.getByText('Create new client')).toBeInTheDocument();
    expect(screen.getByText('Create new invoice')).toBeInTheDocument();
  });

  it('filters static items by typed query', async () => {
    render(<CommandPalette />);
    pressCmdK();
    const input = (await screen.findByPlaceholderText(
      /type to search/i,
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'invoice' } });

    await waitFor(() => {
      expect(screen.getByText('Create new invoice')).toBeInTheDocument();
      expect(screen.queryByText('Create new lead')).not.toBeInTheDocument();
    });
  });

  it('debounces /api/v1/search when query length >= 2', async () => {
    render(<CommandPalette />);
    pressCmdK();

    const input = (await screen.findByPlaceholderText(
      /type to search/i,
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'ac' } });

    // Right after the keystroke — no API call yet.
    expect(globalThis.mockApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/search'),
    );

    // The component debounces by ~300ms; waitFor polls up to 1s by default.
    await waitFor(
      () => {
        expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/v1/search?q=ac'),
        );
      },
      { timeout: 1000 },
    );
  });

  it('navigates via router.push when Enter is pressed on the active row', async () => {
    render(<CommandPalette />);
    pressCmdK();
    const input = (await screen.findByPlaceholderText(
      /type to search/i,
    )) as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(globalThis.mockRouter.push).toHaveBeenCalledWith('/leads/new');
  });

  it('moves selection down on ArrowDown then Enter activates the new row', async () => {
    render(<CommandPalette />);
    pressCmdK();
    const input = (await screen.findByPlaceholderText(
      /type to search/i,
    )) as HTMLInputElement;

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // 2nd item in ACTIONS is "Create new client"
    expect(globalThis.mockRouter.push).toHaveBeenCalledWith('/clients/new');
  });

  it('opens via the open-command-palette custom window event', async () => {
    render(<CommandPalette />);
    act(() => {
      window.dispatchEvent(new Event('open-command-palette'));
    });
    expect(
      await screen.findByRole('dialog', { name: /command palette/i }),
    ).toBeInTheDocument();
  });

  it('shows the empty placeholder when no static items match the query', async () => {
    render(<CommandPalette />);
    pressCmdK();
    const input = (await screen.findByPlaceholderText(
      /type to search/i,
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'zzzzzz' } });
    // Records section requires API; static lists won't match, so the empty
    // state appears once debounce passes (>= 2 chars triggers, no results).
    expect(
      await screen.findByText(/no matches for|type to search/i),
    ).toBeInTheDocument();
  });
});
