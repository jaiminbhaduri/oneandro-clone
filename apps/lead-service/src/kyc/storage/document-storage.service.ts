import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { AppConfig } from '../../config/configuration';

export interface StoredFile {
  storagePath: string;
  sizeBytes: number;
}

/**
 * Local-disk storage behind a narrow interface so a real object-store
 * (S3/GCS) implementation can be dropped in later without touching
 * KycService. Storage is a Docker named volume in docker-compose (see
 * `lead_kyc_storage`) — fine for a single-node dev/portfolio deployment,
 * not what you'd run in production with multiple hosts.
 */
@Injectable()
export class DocumentStorageService {
  private readonly logger = new Logger(DocumentStorageService.name);
  private readonly baseDir: string;

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.baseDir = this.configService.get('kyc.storageDir', { infer: true });
  }

  async save(leadId: string, originalFilename: string, buffer: Buffer): Promise<StoredFile> {
    const safeExt = this.extractSafeExtension(originalFilename);
    const relativePath = join(leadId, `${randomUUID()}${safeExt}`);
    const absolutePath = join(this.baseDir, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer, { mode: 0o600 });

    this.logger.log(`stored KYC document for lead ${leadId} (${buffer.length} bytes)`);

    return { storagePath: relativePath, sizeBytes: buffer.length };
  }

  /** Never trust the client-supplied filename directly in a path — only the extension, and only if it looks sane. */
  private extractSafeExtension(originalFilename: string): string {
    const match = /\.[a-zA-Z0-9]{1,10}$/.exec(originalFilename);
    return match ? match[0].toLowerCase() : '';
  }
}
