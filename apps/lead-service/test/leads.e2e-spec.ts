import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildTestApp, TestAppContext } from './support/build-test-app';
import { Role } from '@oneandro/common';

describe('Leads lifecycle (e2e)', () => {
  let ctx: TestAppContext;
  let app: INestApplication;

  beforeAll(async () => {
    ctx = await buildTestApp();
    app = ctx.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).post('/leads').send({}).expect(401);
  });

  it('lets an APPLICANT create a lead and read it back, but not list all leads', async () => {
    const token = ctx.tokenFor('applicant-1', Role.APPLICANT);

    const createRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Cookie', [`access_token=${token}`])
      .send({ loanAmountRequested: 15000, loanPurpose: 'DEBT_CONSOLIDATION' })
      .expect(201);

    expect(createRes.body.status).toBe('CREATED');
    expect(createRes.body.userId).toBe('applicant-1');

    const getRes = await request(app.getHttpServer())
      .get(`/leads/${createRes.body.id}`)
      .set('Cookie', [`access_token=${token}`])
      .expect(200);
    expect(getRes.body.id).toBe(createRes.body.id);

    await request(app.getHttpServer())
      .get('/leads')
      .set('Cookie', [`access_token=${token}`])
      .expect(403);
  });

  it("rejects one applicant reading another applicant's lead", async () => {
    const ownerToken = ctx.tokenFor('applicant-2', Role.APPLICANT);
    const intruderToken = ctx.tokenFor('applicant-3', Role.APPLICANT);

    const createRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Cookie', [`access_token=${ownerToken}`])
      .send({ loanAmountRequested: 5000, loanPurpose: 'AUTO' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/leads/${createRes.body.id}`)
      .set('Cookie', [`access_token=${intruderToken}`])
      .expect(403);
  });

  it('rejects an invalid loan amount (validation pipe)', async () => {
    const token = ctx.tokenFor('applicant-4', Role.APPLICANT);

    await request(app.getHttpServer())
      .post('/leads')
      .set('Cookie', [`access_token=${token}`])
      .send({ loanAmountRequested: 100, loanPurpose: 'AUTO' }) // below the 500 minimum
      .expect(400);
  });

  it('drives a lead through the full lifecycle: KYC upload auto-transitions, then staff decisions', async () => {
    const applicantToken = ctx.tokenFor('applicant-5', Role.APPLICANT);
    const loanOfficerToken = ctx.tokenFor('officer-1', Role.LOAN_OFFICER);
    const underwriterToken = ctx.tokenFor('underwriter-1', Role.UNDERWRITER);

    const createRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Cookie', [`access_token=${applicantToken}`])
      .send({ loanAmountRequested: 20000, loanPurpose: 'HOME_IMPROVEMENT' })
      .expect(201);
    const leadId = createRes.body.id as string;

    // A LOAN_OFFICER cannot jump straight to CREDIT_CHECKED before KYC exists...
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${loanOfficerToken}`])
      .send({ toStatus: 'CREDIT_CHECKED' })
      .expect(400); // still CREATED — invalid transition

    // Uploading a KYC document auto-transitions CREATED -> KYC_UPLOADED.
    await request(app.getHttpServer())
      .post(`/leads/${leadId}/kyc`)
      .set('Cookie', [`access_token=${applicantToken}`])
      .field('documentType', 'GOVERNMENT_ID')
      .attach('file', Buffer.from('%PDF-1.4 fake pdf content'), {
        filename: 'id.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);

    const afterKyc = await request(app.getHttpServer())
      .get(`/leads/${leadId}`)
      .set('Cookie', [`access_token=${applicantToken}`])
      .expect(200);
    expect(afterKyc.body.status).toBe('KYC_UPLOADED');

    const docsRes = await request(app.getHttpServer())
      .get(`/leads/${leadId}/kyc`)
      .set('Cookie', [`access_token=${applicantToken}`])
      .expect(200);
    expect(docsRes.body).toHaveLength(1);
    expect(docsRes.body[0].storagePath).toBeUndefined(); // never leaked to clients

    // A LOAN_OFFICER runs the (mock) credit check.
    const creditCheckedRes = await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${loanOfficerToken}`])
      .send({ toStatus: 'CREDIT_CHECKED' })
      .expect(200);
    expect(creditCheckedRes.body.creditScoreSnapshot).toBeGreaterThanOrEqual(550);

    // A LOAN_OFFICER cannot approve — only UNDERWRITER/ADMIN can.
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${loanOfficerToken}`])
      .send({ toStatus: 'APPROVED' })
      .expect(403);

    await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${underwriterToken}`])
      .send({ toStatus: 'APPROVED' })
      .expect(200);

    const handoffRes = await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${loanOfficerToken}`])
      .send({ toStatus: 'BANK_HANDOFF' })
      .expect(200);
    expect(handoffRes.body.status).toBe('BANK_HANDOFF');

    // A LOAN_OFFICER cannot resolve the bank handoff — that's SYSTEM/ADMIN only.
    await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${loanOfficerToken}`])
      .send({ toStatus: 'FUNDED' })
      .expect(403);

    // banking-adapter-mock calls back in with a SYSTEM token once its
    // simulated bank decision is in.
    const systemToken = ctx.tokenFor('system:banking-adapter-mock', Role.SYSTEM, 'system@oneandro.internal');
    const fundedRes = await request(app.getHttpServer())
      .patch(`/leads/${leadId}/status`)
      .set('Cookie', [`access_token=${systemToken}`])
      .send({ toStatus: 'FUNDED' })
      .expect(200);
    expect(fundedRes.body.status).toBe('FUNDED');
  });

  it('rejects a KYC upload with a disallowed file type', async () => {
    const token = ctx.tokenFor('applicant-6', Role.APPLICANT);
    const createRes = await request(app.getHttpServer())
      .post('/leads')
      .set('Cookie', [`access_token=${token}`])
      .send({ loanAmountRequested: 3000, loanPurpose: 'MEDICAL' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/leads/${createRes.body.id}/kyc`)
      .set('Cookie', [`access_token=${token}`])
      .field('documentType', 'GOVERNMENT_ID')
      .attach('file', Buffer.from('<script>evil</script>'), { filename: 'evil.html', contentType: 'text/html' })
      .expect(400);
  });
});
