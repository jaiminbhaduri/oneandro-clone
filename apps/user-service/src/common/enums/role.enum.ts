import { Role } from '@oneandro/common';

export { Role };

/**
 * The subset of Role that can actually be written to `users.role` — i.e.
 * everything except SYSTEM. Prisma's generated Role enum (from
 * schema.prisma) doesn't have a SYSTEM value at all, so passing a bare
 * `Role` into a Prisma `role:` field wouldn't even compile; this is the
 * type role-assignment DTOs and UsersService.setRole()/list() use instead,
 * so "assign SYSTEM to a real user" is a compile error, not a runtime
 * check.
 *
 * This split is specific to user-service being the one service with a
 * persisted `role` column, so it stays local rather than moving to
 * packages/common.
 */
export type AssignableRole = Exclude<Role, Role.SYSTEM>;

/**
 * Runtime companion to AssignableRole — `Exclude<>` only exists at the
 * type level, so class-validator's @IsIn() needs this actual array to
 * reject a SYSTEM value in the request body, not just at compile time.
 */
export const ASSIGNABLE_ROLES: AssignableRole[] = [Role.APPLICANT, Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN];
