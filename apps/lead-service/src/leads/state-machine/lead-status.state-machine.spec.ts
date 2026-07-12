import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LeadStatus } from '@prisma/client';
import { LeadStatusStateMachine } from './lead-status.state-machine';
import { Role } from '@oneandro/common';

describe('LeadStatusStateMachine', () => {
  describe('assertValidTransition', () => {
    it.each([
      [LeadStatus.CREATED, LeadStatus.KYC_UPLOADED],
      [LeadStatus.KYC_UPLOADED, LeadStatus.CREDIT_CHECKED],
      [LeadStatus.CREDIT_CHECKED, LeadStatus.APPROVED],
      [LeadStatus.CREDIT_CHECKED, LeadStatus.DECLINED],
      [LeadStatus.APPROVED, LeadStatus.BANK_HANDOFF],
      [LeadStatus.BANK_HANDOFF, LeadStatus.FUNDED],
      [LeadStatus.BANK_HANDOFF, LeadStatus.FUNDING_REJECTED],
    ])('allows %s -> %s', (from, to) => {
      expect(() => LeadStatusStateMachine.assertValidTransition(from, to)).not.toThrow();
    });

    it('rejects skipping a stage', () => {
      expect(() => LeadStatusStateMachine.assertValidTransition(LeadStatus.CREATED, LeadStatus.APPROVED)).toThrow(
        BadRequestException,
      );
    });

    it('rejects moving out of a terminal state', () => {
      expect(() =>
        LeadStatusStateMachine.assertValidTransition(LeadStatus.DECLINED, LeadStatus.KYC_UPLOADED),
      ).toThrow(BadRequestException);
    });

    it('rejects going backwards', () => {
      expect(() =>
        LeadStatusStateMachine.assertValidTransition(LeadStatus.CREDIT_CHECKED, LeadStatus.KYC_UPLOADED),
      ).toThrow(BadRequestException);
    });
  });

  describe('isTerminal', () => {
    it('DECLINED, FUNDED, and FUNDING_REJECTED are terminal', () => {
      expect(LeadStatusStateMachine.isTerminal(LeadStatus.DECLINED)).toBe(true);
      expect(LeadStatusStateMachine.isTerminal(LeadStatus.FUNDED)).toBe(true);
      expect(LeadStatusStateMachine.isTerminal(LeadStatus.FUNDING_REJECTED)).toBe(true);
    });

    it('BANK_HANDOFF is no longer terminal — it can resolve to FUNDED or FUNDING_REJECTED', () => {
      expect(LeadStatusStateMachine.isTerminal(LeadStatus.BANK_HANDOFF)).toBe(false);
    });

    it('CREATED is not terminal', () => {
      expect(LeadStatusStateMachine.isTerminal(LeadStatus.CREATED)).toBe(false);
    });
  });

  describe('assertManualTransitionAllowed', () => {
    it('allows a LOAN_OFFICER to move KYC_UPLOADED -> CREDIT_CHECKED', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.KYC_UPLOADED,
          LeadStatus.CREDIT_CHECKED,
          Role.LOAN_OFFICER,
        ),
      ).not.toThrow();
    });

    it('forbids a LOAN_OFFICER from approving a lead — only underwriters/admins decide', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.CREDIT_CHECKED,
          LeadStatus.APPROVED,
          Role.LOAN_OFFICER,
        ),
      ).toThrow(ForbiddenException);
    });

    it('allows an UNDERWRITER to approve', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.CREDIT_CHECKED,
          LeadStatus.APPROVED,
          Role.UNDERWRITER,
        ),
      ).not.toThrow();
    });

    it('forbids an APPLICANT from performing any manual transition', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.KYC_UPLOADED,
          LeadStatus.CREDIT_CHECKED,
          Role.APPLICANT,
        ),
      ).toThrow(ForbiddenException);
    });

    it('forbids manually forcing CREATED -> KYC_UPLOADED (that transition is system-only, via KYC upload)', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(LeadStatus.CREATED, LeadStatus.KYC_UPLOADED, Role.ADMIN),
      ).toThrow(ForbiddenException);
    });

    it('allows SYSTEM (banking-adapter-mock) to resolve a bank handoff to FUNDED', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(LeadStatus.BANK_HANDOFF, LeadStatus.FUNDED, Role.SYSTEM),
      ).not.toThrow();
    });

    it('allows SYSTEM to resolve a bank handoff to FUNDING_REJECTED', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.BANK_HANDOFF,
          LeadStatus.FUNDING_REJECTED,
          Role.SYSTEM,
        ),
      ).not.toThrow();
    });

    it('also allows ADMIN to resolve a bank handoff manually (override/testing)', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(LeadStatus.BANK_HANDOFF, LeadStatus.FUNDED, Role.ADMIN),
      ).not.toThrow();
    });

    it('forbids a LOAN_OFFICER from resolving a bank handoff — only SYSTEM/ADMIN may', () => {
      expect(() =>
        LeadStatusStateMachine.assertManualTransitionAllowed(
          LeadStatus.BANK_HANDOFF,
          LeadStatus.FUNDED,
          Role.LOAN_OFFICER,
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
