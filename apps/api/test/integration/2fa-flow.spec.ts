/**
 * Integration: full 2FA enrolment + login flow.
 *
 * 1. login with password → access token
 * 2. POST /auth/2fa/setup → secret returned
 * 3. POST /auth/2fa/verify-setup with TOTP code → enabled, recovery codes
 * 4. login again → returns { requires2fa, twoFactorToken } instead of access
 * 5. POST /auth/2fa/login with valid TOTP → access token
 * 6. POST /auth/2fa/login with already-consumed recovery code → 401
 */
import * as supertest from 'supertest';
import { authenticator } from 'otplib';
import { tryBootApp, shutdownApp } from './_helpers';
import { seedOrg, teardownOrg } from './setup';

describe('2FA enrolment + login (integration)', () => {
  let ctx: Awaited<ReturnType<typeof tryBootApp>>;
  let token: string;
  let userEmail: string;
  let orgId: string;
  let api: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await tryBootApp();
    if (!ctx.available || !ctx.app) return;
    api = supertest(ctx.app.getHttpServer());
    const seeded = await seedOrg(ctx.app);
    token = seeded.token;
    userEmail = seeded.user.email;
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

  itDb('full happy-path enrolment + login', async () => {
    // Step 1: setup 2FA
    const setupRes = await api
      .post('/api/v1/auth/2fa/setup')
      .set('Authorization', `Bearer ${token}`);
    expect([200, 201]).toContain(setupRes.status);
    expect(setupRes.body.secret).toBeDefined();
    const secret: string = setupRes.body.secret;

    // Step 2: verify-setup with valid TOTP
    const code = authenticator.generate(secret);
    const verifyRes = await api
      .post('/api/v1/auth/2fa/verify-setup')
      .set('Authorization', `Bearer ${token}`)
      .send({ code });
    expect([200, 201]).toContain(verifyRes.status);
    expect(verifyRes.body.recoveryCodes).toHaveLength(10);
    const recoveryCodes: string[] = verifyRes.body.recoveryCodes;

    // Step 3: login with password — should now require 2FA
    const loginRes = await api.post('/api/v1/auth/login').send({
      email: userEmail,
      password: 'test-password',
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.requires2fa).toBe(true);
    expect(loginRes.body.twoFactorToken).toBeDefined();
    const twoFactorToken: string = loginRes.body.twoFactorToken;

    // Step 4: 2fa/login with valid TOTP
    const code2 = authenticator.generate(secret);
    const loginCodeRes = await api.post('/api/v1/auth/2fa/login').send({
      twoFactorToken,
      code: code2,
    });
    expect(loginCodeRes.status).toBe(200);
    expect(loginCodeRes.body.accessToken).toBeDefined();

    // Step 5: get a fresh 2fa token for recovery test
    const login2Res = await api.post('/api/v1/auth/login').send({
      email: userEmail,
      password: 'test-password',
    });
    const tok2: string = login2Res.body.twoFactorToken;
    const recoveryCode = recoveryCodes[0];

    const recoveryUseRes = await api.post('/api/v1/auth/2fa/login').send({
      twoFactorToken: tok2,
      code: recoveryCode,
    });
    expect(recoveryUseRes.status).toBe(200);
    expect(recoveryUseRes.body.accessToken).toBeDefined();

    // Step 6: replay → should fail
    const login3Res = await api.post('/api/v1/auth/login').send({
      email: userEmail,
      password: 'test-password',
    });
    const tok3: string = login3Res.body.twoFactorToken;
    const replayRes = await api.post('/api/v1/auth/2fa/login').send({
      twoFactorToken: tok3,
      code: recoveryCode,
    });
    expect(replayRes.status).toBe(401);
  });
});
