import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { ServiceTokenService } from '../auth/service-token.service';

export interface UserSummary {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

@Injectable()
export class UserServiceClient {
  private readonly baseUrl: string;

  constructor(
    configService: ConfigService<AppConfig, true>,
    private readonly serviceTokenService: ServiceTokenService,
  ) {
    this.baseUrl = configService.get('services.userServiceUrl', { infer: true });
  }

  async getUser(userId: string): Promise<UserSummary> {
    const response = await fetch(`${this.baseUrl}/users/${userId}`, {
      headers: { Authorization: `Bearer ${this.serviceTokenService.mint()}` },
    });

    if (!response.ok) {
      throw new Error(`user-service GET /users/${userId} returned ${response.status}`);
    }

    return (await response.json()) as UserSummary;
  }
}
