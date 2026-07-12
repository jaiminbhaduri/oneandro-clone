import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp, parseCookies, TestAppContext } from './support/build-test-app';

describe('Auth flows (e2e)', () => {
  let ctx: TestAppContext;
  let app: INestApplication;

  const credentials = { email: 'ada@example.com', password: 'Str0ng!Passw0rd', firstName: 'Ada', lastName: 'Lovelace' };

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers a new user, sets httpOnly cookies, and never returns the password hash', async () => {
    const res = await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);

    expect(res.body.email).toBe(credentials.email);
    expect(res.body.passwordHash).toBeUndefined();

    const cookies = parseCookies(res.headers['set-cookie'] as unknown as string[]);
    expect(cookies.access_token).toBeDefined();
    expect(cookies.refresh_token).toBeDefined();
    expect(res.headers['set-cookie'].toString()).toMatch(/HttpOnly/);
  });

  it('rejects a second registration with the same email', async () => {
    await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(409);
  });

  it('rejects login with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects unauthenticated access to a protected route', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
  });

  it('logs in and can then reach a protected route using the access_token cookie', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const cookies = parseCookies(loginRes.headers['set-cookie'] as unknown as string[]);

    const meRes = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', [`access_token=${cookies.access_token}`])
      .expect(200);

    expect(meRes.body.email).toBe(credentials.email);
  });

  it('rotates the refresh token and detects reuse of the superseded one', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const loginCookies = parseCookies(loginRes.headers['set-cookie'] as unknown as string[]);
    const originalRefreshToken = loginCookies.refresh_token;

    const refreshRes = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${originalRefreshToken}`])
      .expect(200);

    const rotatedCookies = parseCookies(refreshRes.headers['set-cookie'] as unknown as string[]);
    expect(rotatedCookies.refresh_token).toBeDefined();
    expect(rotatedCookies.refresh_token).not.toBe(originalRefreshToken);

    // Replaying the now-superseded token must fail closed, not silently re-issue.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${originalRefreshToken}`])
      .expect(401);

    // Reuse detection revokes the whole family — the freshly-rotated token is dead too.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${rotatedCookies.refresh_token}`])
      .expect(401);
  });

  it('logout clears cookies and revokes the refresh token', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const cookies = parseCookies(loginRes.headers['set-cookie'] as unknown as string[]);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', [`refresh_token=${cookies.refresh_token}`])
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', [`refresh_token=${cookies.refresh_token}`])
      .expect(401);
  });
});
