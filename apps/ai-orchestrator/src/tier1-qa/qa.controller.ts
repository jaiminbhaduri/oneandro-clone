import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { QaService } from './qa.service';
import { IngestionService } from '../rag/ingestion.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { IngestDocumentDto } from './dto/ingest-document.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, RequestUser } from '@oneandro/common';

@ApiTags('tier1-qa')
@ApiBearerAuth()
@Controller('ai/qa')
export class QaController {
  constructor(
    private readonly qaService: QaService,
    private readonly ingestionService: IngestionService,
  ) {}

  @Post('ask')
  @ApiOkResponse({ description: 'Policy Q&A answer, semantic-cache-accelerated' })
  async ask(@Body() dto: AskQuestionDto, @CurrentUser() user: RequestUser) {
    return this.qaService.ask(dto.question, { userId: user.userId });
  }

  @Post('ingest')
  @Roles(Role.ADMIN)
  @ApiOkResponse({ description: 'Chunk, embed, and store a policy document (admin only)' })
  async ingest(@Body() dto: IngestDocumentDto) {
    return this.ingestionService.ingest(dto);
  }
}
