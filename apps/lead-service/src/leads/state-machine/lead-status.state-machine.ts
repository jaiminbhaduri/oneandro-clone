import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { Role } from '@oneandro/common';

/**
 * KYC_UPLOADED is reached automatically (KycService flips it on first
 * successful document upload) — it never goes through
 * assertManualTransitionAllowed, only assertValidTransition.
 */
const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  CREATED: [LeadStatus.KYC_UPLOADED],
  KYC_UPLOADED: [LeadStatus.CREDIT_CHECKED],
  CREDIT_CHECKED: [LeadStatus.APPROVED, LeadStatus.DECLINED],
  APPROVED: [LeadStatus.BANK_HANDOFF],
  DECLINED: [],
  BANK_HANDOFF: [LeadStatus.FUNDED, LeadStatus.FUNDING_REJECTED],
  FUNDED: [],
  FUNDING_REJECTED: [],
};

/** Roles permitted to *manually* drive a given transition via PATCH /leads/:id/status. */
const MANUAL_TRANSITION_ROLES: Partial<Record<string, Role[]>> = {
  [`${LeadStatus.KYC_UPLOADED}->${LeadStatus.CREDIT_CHECKED}`]: [Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN],
  [`${LeadStatus.CREDIT_CHECKED}->${LeadStatus.APPROVED}`]: [Role.UNDERWRITER, Role.ADMIN],
  [`${LeadStatus.CREDIT_CHECKED}->${LeadStatus.DECLINED}`]: [Role.UNDERWRITER, Role.ADMIN],
  [`${LeadStatus.APPROVED}->${LeadStatus.BANK_HANDOFF}`]: [Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN],
  // Driven by banking-adapter-mock's simulated decision, not a human —
  // ADMIN is also allowed so the pipeline can be exercised/overridden
  // manually (support escalation, or testing) without needing a minted
  // service token every time.
  [`${LeadStatus.BANK_HANDOFF}->${LeadStatus.FUNDED}`]: [Role.SYSTEM, Role.ADMIN],
  [`${LeadStatus.BANK_HANDOFF}->${LeadStatus.FUNDING_REJECTED}`]: [Role.SYSTEM, Role.ADMIN],
};

export class LeadStatusStateMachine {
  static isTerminal(status: LeadStatus): boolean {
    return ALLOWED_TRANSITIONS[status].length === 0;
  }

  static assertValidTransition(from: LeadStatus, to: LeadStatus): void {
    if (!ALLOWED_TRANSITIONS[from].includes(to)) {
      throw new BadRequestException(`Cannot transition lead from ${from} to ${to}`);
    }
  }

  static assertManualTransitionAllowed(from: LeadStatus, to: LeadStatus, role: Role): void {
    this.assertValidTransition(from, to);

    const allowedRoles = MANUAL_TRANSITION_ROLES[`${from}->${to}`];
    if (!allowedRoles || !allowedRoles.includes(role)) {
      throw new ForbiddenException(`Role ${role} may not transition a lead from ${from} to ${to}`);
    }
  }
}
