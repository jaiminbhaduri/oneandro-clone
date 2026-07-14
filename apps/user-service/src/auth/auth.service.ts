import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { TokenService, TokenMeta, TokenPair } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  async register(dto: RegisterDto, meta: TokenMeta): Promise<{ user: User; tokens: TokenPair }> {
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });

    const user = await this.usersService.create({
      email: dto.email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    const tokens = await this.tokenService.issueTokenPair(user, meta);

    // Fire-and-forget: the user is already fully created and holds valid
    // tokens by this point, so a slow/unreachable Kafka broker must never
    // block the registration response. kafkajs's own retry/backoff for a
    // stuck producer.send() can run well past any reasonable request
    // timeout (its default maxRetryTime alone is 30s, before accounting
    // for all 8 configured retries) — this bit a real CI run where the
    // broker's group coordinator hadn't fully settled seconds after
    // startup.
    this.kafkaProducer
      .publishUserRegistered({
        userId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        registeredAt: user.createdAt.toISOString(),
      })
      .catch((err: unknown) => {
        this.logger.error(`failed to publish user.registered for ${user.id}: ${err instanceof Error ? err.message : String(err)}`);
      });

    return { user, tokens };
  }

  async validateCredentials(email: string, password: string): Promise<User> {
    const user = await this.usersService.findByEmail(email);

    // Constant-shape failure: don't reveal whether the email exists.
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account is disabled');
    }

    const passwordMatches = await argon2.verify(user.passwordHash, password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return user;
  }

  async login(user: User, meta: TokenMeta): Promise<TokenPair> {
    return this.tokenService.issueTokenPair(user, meta);
  }

  async refresh(rawRefreshToken: string, meta: TokenMeta): Promise<TokenPair> {
    return this.tokenService.rotateRefreshToken(rawRefreshToken, meta);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokenService.revokeToken(rawRefreshToken);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.tokenService.revokeAllForUser(userId);
  }
}
