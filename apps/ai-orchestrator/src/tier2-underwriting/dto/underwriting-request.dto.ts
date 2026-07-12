import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Length } from 'class-validator';

export class UnderwritingRequestDto {
  @ApiProperty({ example: 'a3f1c2e4-...' })
  @IsUUID()
  leadId!: string;

  @ApiProperty({ example: 'Should we approve this loan given the applicant\'s credit score and history?' })
  @IsString()
  @Length(3, 2000)
  question!: string;
}
