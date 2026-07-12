import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { UserEntity } from './entities/user.entity';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '@oneandro/common';
import { RequestUser } from '@oneandro/common';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOkResponse({ type: UserEntity })
  async getMe(@CurrentUser() currentUser: RequestUser): Promise<UserEntity> {
    const user = await this.usersService.findByIdOrThrow(currentUser.userId);
    return new UserEntity(user);
  }

  @Patch('me')
  @ApiOkResponse({ type: UserEntity })
  async updateMe(@CurrentUser() currentUser: RequestUser, @Body() dto: UpdateProfileDto): Promise<UserEntity> {
    const user = await this.usersService.updateProfile(currentUser.userId, dto);
    return new UserEntity(user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.LOAN_OFFICER, Role.UNDERWRITER)
  @ApiOkResponse({ description: 'Paginated user list' })
  async list(@Query() query: ListUsersQueryDto) {
    const result = await this.usersService.list(query);
    return { ...result, data: result.data.map((u) => new UserEntity(u)) };
  }

  // SYSTEM: banking-adapter-mock looks up an applicant's email here to
  // send lead-status notifications — a single lookup-by-id, deliberately
  // not extended to the list endpoint above.
  @Get(':id')
  @Roles(Role.ADMIN, Role.LOAN_OFFICER, Role.UNDERWRITER, Role.SYSTEM)
  @ApiOkResponse({ type: UserEntity })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<UserEntity> {
    const user = await this.usersService.findByIdOrThrow(id);
    return new UserEntity(user);
  }

  @Patch(':id/role')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: UserEntity })
  async assignRole(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRoleDto): Promise<UserEntity> {
    const user = await this.usersService.setRole(id, dto.role);
    return new UserEntity(user);
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ type: UserEntity })
  async deactivate(@Param('id', ParseUUIDPipe) id: string): Promise<UserEntity> {
    const user = await this.usersService.deactivate(id);
    return new UserEntity(user);
  }
}
