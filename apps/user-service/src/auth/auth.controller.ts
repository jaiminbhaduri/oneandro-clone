import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserEntity } from '../users/entities/user.entity';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '@oneandro/common';
import { TokenPair, TokenMeta } from './token.service';
import { ACCESS_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE_PATH } from './auth.constants';
import { AppConfig } from '../config/configuration';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  private requestMeta(req: Request): TokenMeta {
    return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
  }

  private setAuthCookies(res: Response, tokens: TokenPair): void {
    const isProd = this.configService.get('env', { infer: true }) === 'production';
    const domain = this.configService.get('cookieDomain', { infer: true });

    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      domain,
      path: '/',
      maxAge: tokens.accessTokenExpiresInMs,
    });

    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'strict',
      domain,
      path: REFRESH_TOKEN_COOKIE_PATH,
      maxAge: tokens.refreshTokenExpiresInMs,
    });
  }

  private clearAuthCookies(res: Response): void {
    const domain = this.configService.get('cookieDomain', { infer: true });
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/', domain });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: REFRESH_TOKEN_COOKIE_PATH, domain });
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ type: UserEntity })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.authService.register(dto, this.requestMeta(req));
    this.setAuthCookies(res, tokens);
    return new UserEntity(user);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: UserEntity })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateCredentials(dto.email, dto.password);
    const tokens = await this.authService.login(user, this.requestMeta(req));
    this.setAuthCookies(res, tokens);
    return new UserEntity(user);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!rawRefreshToken) {
      throw new UnauthorizedException('No refresh token presented');
    }

    const tokens = await this.authService.refresh(rawRefreshToken, this.requestMeta(req));
    this.setAuthCookies(res, tokens);
    return { status: 'ok' };
  }

  // Public: logout only needs the refresh cookie (revocation-by-hash), and
  // must still work even if the access token has already expired.
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawRefreshToken = req.cookies?.[REFRESH_TOKEN_COOKIE];
    if (rawRefreshToken) {
      await this.authService.logout(rawRefreshToken);
    }
    this.clearAuthCookies(res);
    return { status: 'ok' };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  async logoutAll(@CurrentUser() currentUser: RequestUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.logoutAll(currentUser.userId);
    this.clearAuthCookies(res);
    return { status: 'ok' };
  }
}
