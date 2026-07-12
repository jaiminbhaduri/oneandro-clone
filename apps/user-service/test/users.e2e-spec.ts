import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp, mintSystemToken, parseCookies, TestAppContext } from './support/build-test-app';

describe('Users RBAC (e2e)', () => {
  let ctx: TestAppContext;
  let app: INestApplication;

  async function registerAndLogin(email: string) {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'Str0ng!Passw0rd', firstName: 'Test', lastName: 'User' })
      .expect(201);

    return { userId: res.body.id as string, cookies: parseCookies(res.headers['set-cookie'] as unknown as string[]) };
  }

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('denies a plain APPLICANT from listing users', async () => {
    const { cookies } = await registerAndLogin('applicant@example.com');

    await request(app.getHttpServer())
      .get('/users')
      .set('Cookie', [`access_token=${cookies.access_token}`])
      .expect(403);
  });

  it('denies a plain APPLICANT from assigning roles', async () => {
    const applicant = await registerAndLogin('applicant2@example.com');
    const other = await registerAndLogin('someoneelse@example.com');

    await request(app.getHttpServer())
      .patch(`/users/${other.userId}/role`)
      .set('Cookie', [`access_token=${applicant.cookies.access_token}`])
      .send({ role: 'ADMIN' })
      .expect(403);
  });

  it('allows an ADMIN to list users and promote a role', async () => {
    const admin = await registerAndLogin('admin@example.com');
    const target = await registerAndLogin('promote-me@example.com');

    // Simulate an out-of-band promotion (e.g. a seed script) — the API
    // itself has no self-service path to ADMIN, by design.
    await ctx.prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });

    const listRes = await request(app.getHttpServer())
      .get('/users')
      .set('Cookie', [`access_token=${admin.cookies.access_token}`])
      .expect(200);
    expect(listRes.body.total).toBeGreaterThanOrEqual(3);

    const promoteRes = await request(app.getHttpServer())
      .patch(`/users/${target.userId}/role`)
      .set('Cookie', [`access_token=${admin.cookies.access_token}`])
      .send({ role: 'LOAN_OFFICER' })
      .expect(200);

    expect(promoteRes.body.role).toBe('LOAN_OFFICER');
  });

  it('rejects an invalid role value with a 400 (whitelist validation)', async () => {
    const admin = await registerAndLogin('admin2@example.com');
    await ctx.prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });

    await request(app.getHttpServer())
      .patch(`/users/${admin.userId}/role`)
      .set('Cookie', [`access_token=${admin.cookies.access_token}`])
      .send({ role: 'SUPER_ADMIN' })
      .expect(400);
  });

  it('lets a user update their own profile but not their role via the profile endpoint', async () => {
    const { cookies } = await registerAndLogin('self-update@example.com');

    const res = await request(app.getHttpServer())
      .patch('/users/me')
      .set('Cookie', [`access_token=${cookies.access_token}`])
      .send({ firstName: 'Updated', role: 'ADMIN' }) // role is not whitelisted on this DTO
      .expect(400); // forbidNonWhitelisted rejects the unexpected `role` field

    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringContaining('role')]));
  });

  describe('SYSTEM role (service-to-service)', () => {
    it('lets a SYSTEM-signed token look up a user by id — this is banking-adapter-mock fetching an email address', async () => {
      const target = await registerAndLogin('notify-me@example.com');
      const systemToken = mintSystemToken();

      const res = await request(app.getHttpServer())
        .get(`/users/${target.userId}`)
        .set('Cookie', [`access_token=${systemToken}`])
        .expect(200);

      expect(res.body.email).toBe('notify-me@example.com');
    });

    it('does not extend SYSTEM to the list endpoint — narrow, single-lookup access only', async () => {
      const systemToken = mintSystemToken();

      await request(app.getHttpServer())
        .get('/users')
        .set('Cookie', [`access_token=${systemToken}`])
        .expect(403);
    });

    it('rejects assigning SYSTEM as a real user role, even by an ADMIN — it is a JWT claim, never a persisted role', async () => {
      const admin = await registerAndLogin('admin3@example.com');
      await ctx.prisma.user.update({ where: { id: admin.userId }, data: { role: 'ADMIN' } });
      const target = await registerAndLogin('cant-be-system@example.com');

      await request(app.getHttpServer())
        .patch(`/users/${target.userId}/role`)
        .set('Cookie', [`access_token=${admin.cookies.access_token}`])
        .send({ role: 'SYSTEM' })
        .expect(400);
    });
  });
});
