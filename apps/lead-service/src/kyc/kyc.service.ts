import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycDocument } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LeadsService } from '../leads/leads.service';
import { DocumentStorageService } from './storage/document-storage.service';
import { AppConfig } from '../config/configuration';
import { RequestUser } from '@oneandro/common';
import { DocumentType } from '@prisma/client';

const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class KycService {
  private readonly maxFileSizeBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly leadsService: LeadsService,
    private readonly storage: DocumentStorageService,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.maxFileSizeBytes = configService.get('kyc.maxFileSizeBytes', { infer: true });
  }

  private assertValidFile(file: UploadedFileLike): void {
    if (!file || file.size === 0) {
      throw new BadRequestException('No file uploaded');
    }
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
      );
    }
    if (file.size > this.maxFileSizeBytes) {
      throw new BadRequestException(`File exceeds maximum size of ${this.maxFileSizeBytes} bytes`);
    }
  }

  async upload(
    leadId: string,
    documentType: DocumentType,
    file: UploadedFileLike,
    requester: RequestUser,
  ): Promise<KycDocument> {
    // Ownership/staff check reuses the exact same rule as reading a lead.
    await this.leadsService.findAccessibleOrThrow(leadId, requester);
    this.assertValidFile(file);

    const { storagePath, sizeBytes } = await this.storage.save(leadId, file.originalname, file.buffer);

    const document = await this.prisma.kycDocument.create({
      data: {
        leadId,
        documentType,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes,
        storagePath,
        uploadedByUserId: requester.userId,
      },
    });

    await this.leadsService.markKycUploaded(leadId, requester.userId);

    return document;
  }

  async listForLead(leadId: string, requester: RequestUser): Promise<KycDocument[]> {
    await this.leadsService.findAccessibleOrThrow(leadId, requester);
    return this.prisma.kycDocument.findMany({ where: { leadId }, orderBy: { createdAt: 'desc' } });
  }
}
