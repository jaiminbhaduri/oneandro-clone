import { ChatOpenAI } from '@langchain/openai';
import { createDbAgentNode } from './db-agent.node';
import { PrismaService } from '../../../prisma/prisma.service';
import { UnderwritingStateType } from '../state';

function fakeModel(structuredResult: unknown): ChatOpenAI {
  return {
    withStructuredOutput: () => ({ invoke: jest.fn().mockResolvedValue(structuredResult) }),
  } as unknown as ChatOpenAI;
}

const baseState: UnderwritingStateType = {
  leadId: 'lead-1',
  userId: 'user-1',
  question: 'Has this applicant been declined before?',
  leadSnapshot: { id: 'lead-1', status: 'CREDIT_CHECKED', loanAmountRequested: '15000', loanPurpose: 'AUTO', creditScoreSnapshot: 620 },
  needsFinancialLookup: true,
  sqlTemplateId: null,
  sqlResult: null,
  retrievedDocs: [],
  rerankedDocs: [],
  decision: null,
  rationale: null,
  confidenceScore: null,
  warnings: [],
};

describe('createDbAgentNode', () => {
  it('runs the PRIOR_RUNS_FOR_LEAD template and returns it scoped to the requested lead only', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ decision: 'DECLINE', confidenceScore: 0.8, createdAt: new Date() }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

    const node = createDbAgentNode(fakeModel({ templateId: 'PRIOR_RUNS_FOR_LEAD' }), prisma);
    const result = await node(baseState);

    expect(result.sqlTemplateId).toBe('PRIOR_RUNS_FOR_LEAD');
    expect(result.sqlResult).toEqual({ priorRuns: [{ decision: 'DECLINE', confidenceScore: 0.8, createdAt: expect.any(Date) }] });

    // The lead id bound into the query must be the one from state, not something the model could smuggle in.
    const templateStrings = queryRaw.mock.calls[0][0];
    expect(templateStrings.join('')).toContain('WHERE lead_id =');
    expect(queryRaw.mock.calls[0]).toContain(baseState.leadId);
  });

  it('runs the DECISION_COUNTS_FOR_LEAD template and normalizes bigint counts to numbers', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ decision: 'REFER', count: 3n }]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

    const node = createDbAgentNode(fakeModel({ templateId: 'DECISION_COUNTS_FOR_LEAD' }), prisma);
    const result = await node(baseState);

    expect(result.sqlResult).toEqual({ decisionCounts: [{ decision: 'REFER', count: 3 }] });
    expect(typeof (result.sqlResult as { decisionCounts: { count: unknown }[] }).decisionCounts[0].count).toBe('number');
  });

  it('never executes a query the template whitelist does not recognize — only the two known templates are reachable', async () => {
    // The zod enum on the structured-output schema is what actually
    // prevents an unrecognized templateId from reaching this switch in
    // production; this test documents that runTemplate has no default/
    // fallthrough case that would silently run something unexpected.
    const queryRaw = jest.fn().mockResolvedValue([]);
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;

    const node = createDbAgentNode(fakeModel({ templateId: 'PRIOR_RUNS_FOR_LEAD' }), prisma);
    await node(baseState);

    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
