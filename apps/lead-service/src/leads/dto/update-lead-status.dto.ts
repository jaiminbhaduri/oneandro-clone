import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeadStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';

export class UpdateLeadStatusDto {
  @ApiProperty({ enum: LeadStatus, example: LeadStatus.CREDIT_CHECKED })
  @IsEnum(LeadStatus)
  toStatus!: LeadStatus;

  @ApiPropertyOptional({ description: 'Required when toStatus is DECLINED or FUNDING_REJECTED' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  declineReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
