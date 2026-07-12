import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class AskQuestionDto {
  @ApiProperty({ example: 'What income documents count as proof of income?' })
  @IsString()
  @Length(3, 2000)
  question!: string;
}
