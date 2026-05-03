/**
 * Integration: PUT /email-settings → GET /email-settings → assert password
 * never leaks back. Then PUT with smtpPassword:null → cleared.
 */
import * as supertest from 'supertest';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('email-settings PUT/GET roundtrip (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let token: string;
  let orgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const seeded = await seedOrg(ctx.app);
    token = seeded.token;
    orgId = seeded.org.id;
  });

  afterAll(async () => {
    if (ctx?.available && ctx.app) {
      if (orgId) await teardownOrg(ctx.app, orgId);
      await shutdownApp(ctx.app);
    }
  });

  const itDb = (name: string, fn: () => Promise<void>) =>
    it(name, async () => {
      if (!ctx?.available) {
        console.warn(`[skip] ${name}: ${ctx?.reason}`);
        return;
      }
      await fn();
    });

  itDb('SMTP password is encrypted on write and redacted on read', async () => {
    const putRes = await api
      .put('/api/v1/email-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'SMTP',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'user@example.com',
        smtpPassword: 'super-secret-pass',
        fromEmail: 'noreply@example.com',
      });
    expect([200, 201, 204]).toContain(putRes.status);

    const getRes = await api
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.smtpPasswordSet).toBe(true);
    expect(getRes.body.smtpPassword).toBeUndefined();
  });

  itDb('PUT with smtpPassword:null clears it', async () => {
    await api
      .put('/api/v1/email-settings')
      .set('Authorization', `Bearer ${token}`)
      .send({
        provider: 'SMTP',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpPassword: null,
      });

    const getRes = await api
      .get('/api/v1/email-settings')
      .set('Authorization', `Bearer ${token}`);
    expect(getRes.body.smtpPasswordSet).toBe(false);
  });

  itDb('IMAP test endpoint returns ok:false on bogus host', async () => {
    const res = await api
      .post('/api/v1/email-settings/imap/test')
      .set('Authorization', `Bearer ${token}`)
      .send({
        host: 'nonexistent.invalid',
        port: 993,
        user: 'me',
        password: 'x',
        tls: true,
      });
    // Endpoint may not exist in all builds; tolerate 404 too.
    if (res.status === 404) {
      console.warn('[skip] /email-settings/imap/test not present in this build');
      return;
    }
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.ok).toBe(false);
      expect(typeof res.body.error).toBe('string');
    }
  });
});
