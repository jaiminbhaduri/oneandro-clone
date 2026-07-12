import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { KycService } from './kyc.service';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { KycDocumentEntity } from './entities/kyc-document.entity';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequestUser } from '@oneandro/common';

// Static decorator-time backstop (Nest can't inject ConfigService here);
// the authoritative, configurable limit is enforced in KycService.
const MULTER_HARD_CAP_BYTES = 15 * 1024 * 1024;

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('leads/:leadId/kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: KycDocumentEntity })
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MULTER_HARD_CAP_BYTES } }),
  )
  async upload(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @Body() dto: UploadKycDocumentDto,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: RequestUser,
  ): Promise<KycDocumentEntity> {
    const document = await this.kycService.upload(leadId, dto.documentType, file, user);
    return new KycDocumentEntity(document);
  }

  @Get()
  @ApiOkResponse({ type: [KycDocumentEntity] })
  async list(
    @Param('leadId', ParseUUIDPipe) leadId: string,
    @CurrentUser() user: RequestUser,
  ): Promise<KycDocumentEntity[]> {
    const documents = await this.kycService.listForLead(leadId, user);
    return documents.map((d) => new KycDocumentEntity(d));
  }
}
