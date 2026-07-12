import { decideFundingOutcome } from './funding-decision';

describe('decideFundingOutcome', () => {
  it('rejects with a specific reason when there is no credit score on file', () => {
    const result = decideFundingOutcome(null);
    expect(result).toEqual({ toStatus: 'FUNDING_REJECTED', reason: 'No credit score on file for this lead.' });
  });

  it('funds when the random roll is below the approval probability for a strong score', () => {
    // score >= 680 -> approvalProbability 0.95; roll 0.5 is well under it.
    const result = decideFundingOutcome(720, () => 0.5);
    expect(result).toEqual({ toStatus: 'FUNDED' });
  });

  it('rejects when the random roll lands above the approval probability for a strong score', () => {
    const result = decideFundingOutcome(720, () => 0.99);
    expect(result.toStatus).toBe('FUNDING_REJECTED');
  });

  it('funds a mid-tier score (620-679) when the roll is within its 0.8 probability', () => {
    const result = decideFundingOutcome(650, () => 0.79);
    expect(result).toEqual({ toStatus: 'FUNDED' });
  });

  it('rejects a mid-tier score when the roll exceeds its 0.8 probability', () => {
    const result = decideFundingOutcome(650, () => 0.81);
    expect(result.toStatus).toBe('FUNDING_REJECTED');
  });

  it('mostly rejects a weak score (<620) — only a 0.1 approval probability', () => {
    const rejected = decideFundingOutcome(560, () => 0.5);
    expect(rejected.toStatus).toBe('FUNDING_REJECTED');

    const approved = decideFundingOutcome(560, () => 0.05);
    expect(approved.toStatus).toBe('FUNDED');
  });

  it('includes the credit score in the rejection reason for traceability', () => {
    const result = decideFundingOutcome(560, () => 0.99);
    expect(result.toStatus).toBe('FUNDING_REJECTED');
    expect((result as { reason: string }).reason).toContain('560');
  });

  it('is a pure function — same inputs always produce the same output', () => {
    const a = decideFundingOutcome(700, () => 0.3);
    const b = decideFundingOutcome(700, () => 0.3);
    expect(a).toEqual(b);
  });
});
