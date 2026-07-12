import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, Max, Min } from 'class-validator';

export enum LoanPurpose {
  DEBT_CONSOLIDATION = 'DEBT_CONSOLIDATION',
  HOME_IMPROVEMENT = 'HOME_IMPROVEMENT',
  AUTO = 'AUTO',
  MEDICAL = 'MEDICAL',
  EDUCATION = 'EDUCATION',
  OTHER = 'OTHER',
}

export class CreateLeadDto {
  @ApiProperty({ example: 15000, minimum: 500, maximum: 100000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(500)
  @Max(100000)
  loanAmountRequested!: number;

  @ApiProperty({ enum: LoanPurpose, example: LoanPurpose.DEBT_CONSOLIDATION })
  @IsEnum(LoanPurpose)
  loanPurpose!: LoanPurpose;
}
