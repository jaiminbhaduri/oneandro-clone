import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, Length } from 'class-validator';

export class IngestDocumentDto {
  @ApiProperty({ example: 'policy:kyc-requirements-v3' })
  @IsString()
  @Length(1, 200)
  source!: string;

  @ApiProperty({ description: 'Raw document text to chunk, embed, and store' })
  @IsString()
  @Length(1, 200_000)
  text!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
