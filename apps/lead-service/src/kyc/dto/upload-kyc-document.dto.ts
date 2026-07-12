import { ApiProperty } from '@nestjs/swagger';
import { DocumentType } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UploadKycDocumentDto {
  @ApiProperty({ enum: DocumentType, example: DocumentType.GOVERNMENT_ID })
  @IsEnum(DocumentType)
  documentType!: DocumentType;
}
