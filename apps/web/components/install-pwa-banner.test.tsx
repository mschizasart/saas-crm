import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InstallPwaBanner } from './install-pwa-banner';

const DISMISS_KEY = 'pwa-install-dismissed-at';
const SHOW_DELAY_MS = 60 * 1000;

function fireBeforeInstallPrompt(deferred: { prompt: ReturnType<typeof vi.fn>; userChoice: Promise<unknown> }) {
  const ev = new Event('beforeinstallprompt') as Event & {
    prompt: typeof deferred.prompt;
    userChoice: typeof deferred.userChoice;
  };
  ev.prompt = deferred.prompt;
  ev.userChoice = deferred.userChoice;
  window.dispatchEvent(ev);
}

describe('InstallPwaBanner component', () => {
  beforeEach(() => {
    localStorage.removeItem(DISMISS_KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render anything before the prompt event fires', () => {
    const { container } = render(<InstallPwaBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('shows the banner after a captured prompt + 60s delay', () => {
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({}),
    });
    expect(screen.queryByRole('region', { name: /install appoinlycrm/i })).not.toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByRole('region', { name: /install appoinlycrm/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument();
  });

  it('persists a dismiss timestamp into localStorage when "Not now" is clicked', async () => {
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({}),
    });
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    vi.useRealTimers();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /not now/i }));
    expect(localStorage.getItem(DISMISS_KEY)).toBeTruthy();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('hides itself when the X button is clicked', async () => {
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({}),
    });
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    vi.useRealTimers();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /dismiss install banner/i }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('stays hidden if the user dismissed within the last 30 days', () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({}),
    });
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS * 2);
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('reappears after 30 days have elapsed since the last dismissal', () => {
    const thirtyOneDaysMs = 31 * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(Date.now() - thirtyOneDaysMs));
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: vi.fn(() => Promise.resolve()),
      userChoice: Promise.resolve({}),
    });
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByRole('region', { name: /install appoinlycrm/i })).toBeInTheDocument();
  });

  it('calls deferredPrompt.prompt() when "Install" is clicked', async () => {
    const promptFn = vi.fn(() => Promise.resolve());
    vi.useFakeTimers();
    render(<InstallPwaBanner />);
    fireBeforeInstallPrompt({
      prompt: promptFn,
      userChoice: Promise.resolve({ outcome: 'accepted', platform: '' }),
    });
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    vi.useRealTimers();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^install$/i }));
    expect(promptFn).toHaveBeenCalled();
  });
});
