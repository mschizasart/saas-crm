import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { PushService } from './push.service';
import { PrismaService } from '../../database/prisma.service';

// We mock `web-push` so the service can be exercised without real VAPID keys
// and without hitting the network.
jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const webPush = require('web-push') as {
  setVapidDetails: jest.Mock;
  sendNotification: jest.Mock;
};

describe('PushService', () => {
  let service: PushService;
  let prisma: DeepMocked<PrismaService>;
  let config: DeepMocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMock<PrismaService>();
    config = createMock<ConfigService>();
    service = new PushService(prisma, config);
  });

  function configureVapid() {
    config.get.mockImplementation((key: string) => {
      if (key === 'VAPID_PUBLIC_KEY') return 'pub_key';
      if (key === 'VAPID_PRIVATE_KEY') return 'priv_key';
      if (key === 'VAPID_SUBJECT') return 'mailto:admin@x.com';
      return undefined;
    });
    service.onModuleInit();
  }

  describe('onModuleInit', () => {
    it('stays unconfigured (no-op) when VAPID keys are missing', () => {
      config.get.mockReturnValue(undefined);
      service.onModuleInit();
      expect(service.isConfigured()).toBe(false);
      expect(webPush.setVapidDetails).not.toHaveBeenCalled();
    });

    it('configures web-push when both keys are provided', () => {
      configureVapid();
      expect(service.isConfigured()).toBe(true);
      expect(service.getPublicKey()).toBe('pub_key');
      expect(webPush.setVapidDetails).toHaveBeenCalledWith(
        'mailto:admin@x.com',
        'pub_key',
        'priv_key',
      );
    });
  });

  describe('saveSubscription', () => {
    it('upserts on endpoint (idempotent re-subscribe from same browser)', async () => {
      (prisma.pushSubscription.upsert as jest.Mock).mockResolvedValue({
        id: 'sub_1',
      });
      await service.saveSubscription({
        organizationId: 'org',
        userId: 'user',
        endpoint: 'https://push/x',
        p256dh: 'p',
        auth: 'a',
      });
      expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { endpoint: 'https://push/x' },
          create: expect.objectContaining({ userId: 'user' }),
          update: expect.objectContaining({ lastUsedAt: expect.any(Date) }),
        }),
      );
    });
  });

  describe('deleteSubscription', () => {
    it('only deletes a subscription owned by the requesting userId', async () => {
      await service.deleteSubscription('user_1', 'https://push/x');
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user_1', endpoint: 'https://push/x' },
      });
    });
  });

  describe('sendToUser', () => {
    it('returns zero counters and does NOT touch web-push when VAPID is not configured', async () => {
      const r = await service.sendToUser('user_1', { title: 'Hi' });
      expect(r).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(webPush.sendNotification).not.toHaveBeenCalled();
    });

    it('sends to every subscription belonging to the user', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'a', p256dh: 'p', auth: 'a' },
        { endpoint: 'b', p256dh: 'p', auth: 'a' },
      ]);
      webPush.sendNotification.mockResolvedValue({});

      const r = await service.sendToUser('user_1', { title: 'Hello' });
      expect(r.sent).toBe(2);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(2);
    });

    it('prunes subscriptions returning 410 (Gone) and counts them as removed', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'expired', p256dh: 'p', auth: 'a' },
        { endpoint: 'alive', p256dh: 'p', auth: 'a' },
      ]);
      webPush.sendNotification
        .mockRejectedValueOnce({ statusCode: 410, body: 'gone' })
        .mockResolvedValueOnce({});
      (prisma.pushSubscription.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const r = await service.sendToUser('user_1', { title: 'Hi' });
      expect(r.sent).toBe(1);
      expect(r.removed).toBe(1);
      expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
        where: { endpoint: { in: ['expired'] } },
      });
    });

    it('also prunes 404 (NotFound) responses', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'gone', p256dh: 'p', auth: 'a' },
      ]);
      webPush.sendNotification.mockRejectedValueOnce({ statusCode: 404 });
      (prisma.pushSubscription.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      const r = await service.sendToUser('user_1', { title: 'Hi' });
      expect(r.removed).toBe(1);
    });

    it('counts non-410/404 errors as `failed` (kept for retry, not pruned)', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'a', p256dh: 'p', auth: 'a' },
      ]);
      webPush.sendNotification.mockRejectedValueOnce({
        statusCode: 500,
        body: 'temp fail',
      });

      const r = await service.sendToUser('user_1', { title: 'Hi' });
      expect(r.sent).toBe(0);
      expect(r.failed).toBe(1);
      expect(r.removed).toBe(0);
    });

    it('returns zeros when the user has no subscriptions', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([]);

      const r = await service.sendToUser('user_lonely', { title: 'Hi' });
      expect(r).toEqual({ sent: 0, failed: 0, removed: 0 });
      expect(webPush.sendNotification).not.toHaveBeenCalled();
    });

    it('truncates long title/body payloads before sending', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'a', p256dh: 'p', auth: 'a' },
      ]);
      webPush.sendNotification.mockResolvedValue({});

      const longTitle = 'x'.repeat(500);
      const longBody = 'y'.repeat(2000);
      await service.sendToUser('user_1', { title: longTitle, body: longBody });

      const sentBody = JSON.parse(webPush.sendNotification.mock.calls[0][1]);
      expect(sentBody.title.length).toBe(200);
      expect(sentBody.body.length).toBe(1000);
    });
  });

  describe('sendToOrg', () => {
    it('honours the optional filter function', async () => {
      configureVapid();
      (prisma.pushSubscription.findMany as jest.Mock).mockResolvedValue([
        { endpoint: 'a', p256dh: 'p', auth: 'a', userId: 'u_actor' },
        { endpoint: 'b', p256dh: 'p', auth: 'a', userId: 'u_other' },
      ]);
      webPush.sendNotification.mockResolvedValue({});

      const r = await service.sendToOrg(
        'org',
        { title: 'Hi' },
        (s) => s.userId !== 'u_actor', // skip actor
      );
      expect(r.sent).toBe(1);
      expect(webPush.sendNotification).toHaveBeenCalledTimes(1);
    });
  });
});
