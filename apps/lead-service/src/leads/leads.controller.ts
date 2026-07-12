import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { LeadsService } from './leads.service';
import { CreateLeadDto } from './dto/create-lead.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { ListLeadsQueryDto } from './dto/list-leads-query.dto';
import { LeadEntity } from './entities/lead.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role, RequestUser } from '@oneandro/common';

@ApiTags('leads')
@ApiBearerAuth()
@Controller('leads')
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Post()
  @ApiCreatedResponse({ type: LeadEntity })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateLeadDto): Promise<LeadEntity> {
    const lead = await this.leadsService.create(user.userId, dto);
    return new LeadEntity(lead);
  }

  @Get('mine')
  @ApiOkResponse({ description: "Paginated list of the caller's own leads" })
  async listMine(@CurrentUser() user: RequestUser, @Query() query: ListLeadsQueryDto) {
    const result = await this.leadsService.listForUser(user.userId, query);
    return { ...result, data: result.data.map((l) => new LeadEntity(l)) };
  }

  @Get()
  @Roles(Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN)
  @ApiOkResponse({ description: 'Paginated list of all leads (staff only)' })
  async list(@Query() query: ListLeadsQueryDto) {
    const result = await this.leadsService.list(query);
    return { ...result, data: result.data.map((l) => new LeadEntity(l)) };
  }

  @Get(':id')
  @ApiOkResponse({ type: LeadEntity })
  async getById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser): Promise<LeadEntity> {
    const lead = await this.leadsService.findAccessibleOrThrow(id, user);
    return new LeadEntity(lead);
  }

  // SYSTEM: banking-adapter-mock drives BANK_HANDOFF -> FUNDED|FUNDING_REJECTED
  // here — the state machine's own role map is what actually restricts
  // SYSTEM to just those two transitions; this coarse gate only keeps
  // fully-unrelated roles (APPLICANT) out before the handler even runs.
  @Patch(':id/status')
  @Roles(Role.LOAN_OFFICER, Role.UNDERWRITER, Role.ADMIN, Role.SYSTEM)
  @ApiOkResponse({ type: LeadEntity })
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLeadStatusDto,
    @CurrentUser() user: RequestUser,
  ): Promise<LeadEntity> {
    const lead = await this.leadsService.updateStatus(id, dto, user);
    return new LeadEntity(lead);
  }
}
