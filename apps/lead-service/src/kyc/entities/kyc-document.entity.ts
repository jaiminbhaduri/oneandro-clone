import { ApiProperty } from '@nestjs/swagger';
import { Exclude, Expose } from 'class-transformer';
import { DocumentType, KycDocument as PrismaKycDocument } from '@prisma/client';

export class KycDocumentEntity {
  @ApiProperty() @Expose() id!: string;
  @ApiProperty() @Expose() leadId!: string;
  @ApiProperty({ enum: DocumentType }) @Expose() documentType!: DocumentType;
  @ApiProperty() @Expose() originalFilename!: string;
  @ApiProperty() @Expose() mimeType!: string;
  @ApiProperty() @Expose() sizeBytes!: number;
  @ApiProperty() @Expose() uploadedByUserId!: string;
  @ApiProperty() @Expose() createdAt!: Date;

  // Never expose the on-disk path to clients — it's an internal storage detail.
  @Exclude()
  storagePath!: string;

  constructor(partial: PrismaKycDocument) {
    Object.assign(this, partial);
  }
}
