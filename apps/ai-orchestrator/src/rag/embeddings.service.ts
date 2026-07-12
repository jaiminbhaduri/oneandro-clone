import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { AppConfig } from '../config/configuration';

/** Thin wrapper so nothing else in the service imports @langchain/openai directly. */
@Injectable()
export class EmbeddingsService {
  private readonly embeddings: OpenAIEmbeddings;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.embeddings = new OpenAIEmbeddings({
      apiKey: configService.get('openai.apiKey', { infer: true }),
      model: configService.get('openai.embeddingModel', { infer: true }),
    });
  }

  embedQuery(text: string): Promise<number[]> {
    return this.embeddings.embedQuery(text);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.embeddings.embedDocuments(texts);
  }
}
