import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { UnderwriterGraphService } from './graph/underwriter-graph';
import { PrismaService } from '../prisma/prisma.service';
import { UnderwritingRequestDto } from './dto/underwriting-request.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, RequestUser } from '@oneandro/common';

function extractBearerToken(req: Request): string {
  const cookieToken = req.cookies?.['access_token'];
  if (cookieToken) return cookieToken;

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length);

  // JwtAuthGuard already required a valid token to reach this handler, so
  // this branch means the token came in via some extractor this function
  // doesn't know about — fail loudly rather than forward `undefined`.
  throw new UnauthorizedException('Could not extract access token to forward to lead-service');
}

@ApiTags('tier2-underwriting')
@ApiBearerAuth()
@Controller('ai/underwriting')
export class UnderwritingController {
  constructor(
    private readonly graphService: UnderwriterGraphService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('run')
  @Roles(Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN)
  @ApiOkResponse({ description: 'Runs the LangGraph multi-agent underwriting pipeline for a lead' })
  async run(@Body() dto: UnderwritingRequestDto, @CurrentUser() user: RequestUser, @Req() req: Request) {
    const bearerToken = extractBearerToken(req);
    return this.graphService.run(dto.leadId, dto.question, { userId: user.userId }, bearerToken);
  }

  @Get('runs/:leadId')
  @Roles(Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN)
  @ApiOkResponse({ description: 'Audit trail of prior underwriting runs for a lead' })
  async listRuns(@Param('leadId', ParseUUIDPipe) leadId: string) {
    return this.prisma.underwritingRun.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } });
  }
}
