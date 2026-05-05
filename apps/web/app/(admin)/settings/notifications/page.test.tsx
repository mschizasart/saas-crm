import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMocks = vi.hoisted(() => ({
  getPushStatus: vi.fn(),
  subscribeToPush: vi.fn(),
  unsubscribeFromPush: vi.fn(),
  sendTestPush: vi.fn(),
}));

vi.mock('@/lib/push', () => pushMocks);

import NotificationSettingsPage from './page';

describe('Notification settings page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    pushMocks.getPushStatus.mockReset();
    pushMocks.subscribeToPush.mockReset();
    pushMocks.unsubscribeFromPush.mockReset();
    pushMocks.sendTestPush.mockReset();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Notifications heading', async () => {
    pushMocks.getPushStatus.mockResolvedValue('granted-no-sub');
    render(<NotificationSettingsPage />);
    expect(
      await screen.findByRole('heading', { name: /^notifications$/i }),
    ).toBeInTheDocument();
  });

  it('renders the Enable notifications button when status is granted-no-sub', async () => {
    pushMocks.getPushStatus.mockResolvedValue('granted-no-sub');
    render(<NotificationSettingsPage />);
    expect(
      await screen.findByRole('button', { name: /enable notifications/i }),
    ).toBeInTheDocument();
  });

  it('shows the unsupported message when status is unsupported', async () => {
    pushMocks.getPushStatus.mockResolvedValue('unsupported');
    render(<NotificationSettingsPage />);
    expect(
      await screen.findByText(/this browser does not support push notifications/i),
    ).toBeInTheDocument();
  });

  it('shows the permission-blocked block when status is denied', async () => {
    pushMocks.getPushStatus.mockResolvedValue('denied');
    render(<NotificationSettingsPage />);
    expect(await screen.findByText(/permission blocked/i)).toBeInTheDocument();
  });

  it('renders the Send test + Disable buttons when status is subscribed', async () => {
    pushMocks.getPushStatus.mockResolvedValue('subscribed');
    render(<NotificationSettingsPage />);
    expect(
      await screen.findByRole('button', { name: /send test notification/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /disable/i })).toBeInTheDocument();
  });

  it('calls subscribeToPush when "Enable notifications" is clicked', async () => {
    pushMocks.getPushStatus.mockResolvedValue('granted-no-sub');
    pushMocks.subscribeToPush.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    await user.click(
      await screen.findByRole('button', { name: /enable notifications/i }),
    );
    expect(pushMocks.subscribeToPush).toHaveBeenCalledTimes(1);
  });

  it('calls sendTestPush when "Send test notification" is clicked', async () => {
    pushMocks.getPushStatus.mockResolvedValue('subscribed');
    pushMocks.sendTestPush.mockResolvedValue({ ok: true, sent: 1 });
    const user = userEvent.setup();
    render(<NotificationSettingsPage />);
    await user.click(
      await screen.findByRole('button', { name: /send test notification/i }),
    );
    expect(pushMocks.sendTestPush).toHaveBeenCalledTimes(1);
  });
});
