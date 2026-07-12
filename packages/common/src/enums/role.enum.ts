/**
 * The full set of identities a JWT issued in this system can claim.
 * user-service is the only issuer for real accounts (APPLICANT,
 * LOAN_OFFICER, UNDERWRITER, ADMIN); SYSTEM is claims-only — asserted in
 * short-lived tokens that internal services (banking-adapter-mock) mint
 * themselves with the shared JWT_ACCESS_SECRET, and never corresponds to
 * a row in `users`.
 *
 * user-service additionally derives `AssignableRole = Exclude<Role,
 * Role.SYSTEM>` locally (see apps/user-service/src/common/enums) — that
 * split is specific to it being the one service with a persisted `role`
 * column, so it stays there rather than here.
 */
export enum Role {
  APPLICANT = 'APPLICANT',
  LOAN_OFFICER = 'LOAN_OFFICER',
  UNDERWRITER = 'UNDERWRITER',
  ADMIN = 'ADMIN',
  SYSTEM = 'SYSTEM',
}
