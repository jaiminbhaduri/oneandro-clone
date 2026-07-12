import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { User } from '@prisma/client';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: { findByEmail: jest.Mock; create: jest.Mock };
  let tokenService: { issueTokenPair: jest.Mock };
  let kafkaProducer: { publishUserRegistered: jest.Mock };

  const makeUser = (overrides: Partial<User> = {}, rawPassword = 'Str0ng!Passw0rd'): Promise<User> =>
    argon2.hash(rawPassword, { type: argon2.argon2id }).then((passwordHash) => ({
      id: 'user-1',
      email: 'ada@example.com',
      passwordHash,
      firstName: 'Ada',
      lastName: 'Lovelace',
      role: 'APPLICANT',
      isEmailVerified: false,
      isActive: true,
      lastLeadStatus: null,
      lastLeadStatusAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }));

  beforeEach(async () => {
    usersService = { findByEmail: jest.fn(), create: jest.fn() };
    tokenService = { issueTokenPair: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
    kafkaProducer = { publishUserRegistered: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: TokenService, useValue: tokenService },
        { provide: KafkaProducerService, useValue: kafkaProducer },
      ],
    }).compile();

    authService = moduleRef.get(AuthService);
  });

  describe('validateCredentials', () => {
    it('throws Unauthorized (not NotFound) when no account exists — avoids user enumeration', async () => {
      usersService.findByEmail.mockResolvedValue(null);

      await expect(authService.validateCredentials('nobody@example.com', 'whatever')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('throws Unauthorized when the account is disabled', async () => {
      const user = await makeUser({ isActive: false });
      usersService.findByEmail.mockResolvedValue(user);

      await expect(authService.validateCredentials(user.email, 'Str0ng!Passw0rd')).rejects.toThrow(
        'Account is disabled',
      );
    });

    it('throws Unauthorized on a wrong password', async () => {
      const user = await makeUser();
      usersService.findByEmail.mockResolvedValue(user);

      await expect(authService.validateCredentials(user.email, 'wrong-password')).rejects.toThrow(
        'Invalid email or password',
      );
    });

    it('resolves the user on correct credentials', async () => {
      const user = await makeUser();
      usersService.findByEmail.mockResolvedValue(user);

      await expect(authService.validateCredentials(user.email, 'Str0ng!Passw0rd')).resolves.toEqual(user);
    });
  });

  describe('register', () => {
    it('hashes the password (never stores it in plaintext) and publishes a user.registered event', async () => {
      const created = await makeUser();
      usersService.create.mockResolvedValue(created);

      const { user, tokens } = await authService.register(
        { email: created.email, password: 'Str0ng!Passw0rd', firstName: 'Ada', lastName: 'Lovelace' },
        { ipAddress: '127.0.0.1' },
      );

      const createArgs = usersService.create.mock.calls[0][0];
      expect(createArgs.passwordHash).not.toBe('Str0ng!Passw0rd');
      expect(await argon2.verify(createArgs.passwordHash, 'Str0ng!Passw0rd')).toBe(true);

      expect(tokenService.issueTokenPair).toHaveBeenCalledWith(created, { ipAddress: '127.0.0.1' });
      expect(kafkaProducer.publishUserRegistered).toHaveBeenCalledWith(
        expect.objectContaining({ userId: created.id, email: created.email }),
      );
      expect(user).toEqual(created);
      expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r' });
    });
  });
});
