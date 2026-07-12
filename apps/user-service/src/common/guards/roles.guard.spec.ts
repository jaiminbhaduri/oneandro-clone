import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '@oneandro/common';

function contextWith(user: { role: Role } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request through when the route has no @Roles() metadata', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextWith({ role: Role.APPLICANT }))).toBe(true);
  });

  it('allows the request when the user has one of the required roles', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN, Role.LOAN_OFFICER]),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(guard.canActivate(contextWith({ role: Role.LOAN_OFFICER }))).toBe(true);
  });

  it('rejects with ForbiddenException when the user lacks the required role', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(contextWith({ role: Role.APPLICANT }))).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user at all', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([Role.ADMIN]) } as unknown as Reflector;
    const guard = new RolesGuard(reflector);

    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
