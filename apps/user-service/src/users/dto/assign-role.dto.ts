import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Role } from '@oneandro/common';
import { ASSIGNABLE_ROLES, AssignableRole } from '../../common/enums/role.enum';

export class AssignRoleDto {
  // SYSTEM is intentionally excluded — see AssignableRole. Nobody assigns
  // it through this endpoint; it only ever exists as a JWT claim minted
  // by trusted internal services.
  @ApiProperty({ enum: ASSIGNABLE_ROLES, example: Role.LOAN_OFFICER })
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}
