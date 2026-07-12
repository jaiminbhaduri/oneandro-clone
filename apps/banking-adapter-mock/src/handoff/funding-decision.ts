export type FundingDecision = { toStatus: 'FUNDED' } | { toStatus: 'FUNDING_REJECTED'; reason: string };

/**
 * The "partner bank's" decision — entirely simulated, but not a coin
 * flip: higher credit scores are more likely to fund, same shape as a
 * real risk-based approval curve, so downstream demo data (dashboards,
 * the AI underwriting graph's prior-runs lookup) has something plausible
 * to work with. `random` is injectable so tests can pin outcomes without
 * mocking Math.random globally.
 */
export function decideFundingOutcome(creditScore: number | null, random: () => number = Math.random): FundingDecision {
  if (creditScore === null) {
    return { toStatus: 'FUNDING_REJECTED', reason: 'No credit score on file for this lead.' };
  }

  const approvalProbability = creditScore >= 680 ? 0.95 : creditScore >= 620 ? 0.8 : 0.1;

  if (random() < approvalProbability) {
    return { toStatus: 'FUNDED' };
  }

  return {
    toStatus: 'FUNDING_REJECTED',
    reason: `Partner bank declined funding for credit score ${creditScore} (simulated decision).`,
  };
}
