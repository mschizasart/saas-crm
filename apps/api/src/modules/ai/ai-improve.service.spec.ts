import {
  BadRequestException,
  ServiceUnavailableException,
  TooManyRequestsException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createMock, DeepMocked } from '@golevelup/ts-jest';
import { AiImproveService } from './ai-improve.service';
import { __resetAiRateLimitForTests, AI_RATE_LIMIT } from './rate-limit.util';

describe('AiImproveService', () => {
  let service: AiImproveService;
  let config: DeepMocked<ConfigService>;
  let originalFetch: any;

  beforeEach(() => {
    config = createMock<ConfigService>();
    (config.get as jest.Mock).mockImplementation((k: string) => {
      if (k === 'ANTHROPIC_API_KEY') return 'test-anthropic-key';
      return undefined;
    });
    __resetAiRateLimitForTests();
    service = new AiImproveService(config);
    originalFetch = (global as any).fetch;
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function mockFetchOk(content: string) {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'text', text: content }],
      }),
      text: async () => '',
    });
  }

  it('rejects an unknown tone with BadRequest', async () => {
    await expect(
      service.improve({ userId: 'u', text: 'hello', tone: 'meh' as any }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects empty text with BadRequest', async () => {
    await expect(
      service.improve({ userId: 'u', text: '   ', tone: 'friendly' }),
    ).rejects.toThrow(/Text is empty/);
  });

  it('rejects oversized text with BadRequest', async () => {
    await expect(
      service.improve({
        userId: 'u',
        text: 'a'.repeat(20_000),
        tone: 'friendly',
      }),
    ).rejects.toThrow(/Text is too long/);
  });

  it('throws ServiceUnavailable when ANTHROPIC_API_KEY is missing', async () => {
    (config.get as jest.Mock).mockReturnValue(undefined);
    await expect(
      service.improve({ userId: 'u', text: 'hi', tone: 'friendly' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('sends correct request body shape to Anthropic', async () => {
    mockFetchOk('Improved text');
    const out = await service.improve({
      userId: 'u',
      text: 'hello world',
      tone: 'professional',
    });

    expect(out).toEqual({ improved: 'Improved text' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('test-anthropic-key');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body as string);
    expect(body.model).toMatch(/^claude-/);
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.system).toMatch(/professional tone/);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello world' }]);
  });

  it('appends a length hint to the system prompt when maxLength provided', async () => {
    mockFetchOk('shorter');
    await service.improve({
      userId: 'u',
      text: 'something',
      tone: 'shorten',
      maxLength: 200,
    });
    const body = JSON.parse(
      (global.fetch as jest.Mock).mock.calls[0][1].body,
    );
    expect(body.system).toMatch(/under approximately 200 characters/);
  });

  it('throws ServiceUnavailable when Anthropic returns non-2xx', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'overloaded',
    });
    await expect(
      service.improve({ userId: 'u', text: 'hi', tone: 'friendly' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailable when Anthropic returns empty content', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ content: [] }),
      text: async () => '',
    });
    await expect(
      service.improve({ userId: 'u', text: 'hi', tone: 'friendly' }),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('triggers TooManyRequests after AI_RATE_LIMIT calls in one window', async () => {
    mockFetchOk('ok');
    const userId = 'rate-test-user';
    for (let i = 0; i < AI_RATE_LIMIT; i++) {
      await service.improve({ userId, text: 'hi', tone: 'friendly' });
    }
    await expect(
      service.improve({ userId, text: 'hi', tone: 'friendly' }),
    ).rejects.toThrow(TooManyRequestsException);
  });

  it('rate limit is per-user (different user not affected)', async () => {
    mockFetchOk('ok');
    for (let i = 0; i < AI_RATE_LIMIT; i++) {
      await service.improve({
        userId: 'userA',
        text: 'hi',
        tone: 'friendly',
      });
    }
    // userB is fresh; should succeed
    await expect(
      service.improve({ userId: 'userB', text: 'hi', tone: 'friendly' }),
    ).resolves.toEqual({ improved: 'ok' });
  });
});
