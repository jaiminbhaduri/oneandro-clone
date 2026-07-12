import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { Lead as PrismaLead, LeadStatus } from '@prisma/client';

export class LeadEntity {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() userId!: string;
  @ApiProperty({ required: false, nullable: true }) @Expose() assignedLoanOfficerId!: string | null;
  @ApiProperty() @Expose() loanAmountRequested!: string;
  @ApiProperty() @Expose() loanPurpose!: string;
  @ApiProperty({ enum: LeadStatus }) @Expose() status!: LeadStatus;
  @ApiProperty({ required: false, nullable: true }) @Expose() creditScoreSnapshot!: number | null;
  @ApiProperty({ required: false, nullable: true }) @Expose() declineReason!: string | null;
  @ApiProperty() @Expose() createdAt!: Date;
  @ApiProperty() @Expose() updatedAt!: Date;

  constructor(partial: PrismaLead) {
    Object.assign(this, { ...partial, loanAmountRequested: partial.loanAmountRequested.toString() });
  }
}
