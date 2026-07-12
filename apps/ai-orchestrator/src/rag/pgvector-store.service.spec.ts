import { PgVectorStoreService } from './pgvector-store.service';
import { PrismaService } from '../prisma/prisma.service';

describe('PgVectorStoreService', () => {
  it('rejects an empty embedding before it ever reaches SQL', async () => {
    const queryRaw = jest.fn();
    const service = new PgVectorStoreService({ $queryRaw: queryRaw } as unknown as PrismaService);

    await expect(service.insertChunk({ documentId: 'd1', source: 's', content: 'c', embedding: [] })).rejects.toThrow(
      'embedding must be a non-empty array of finite numbers',
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a non-finite embedding value (NaN/Infinity) before it ever reaches SQL', async () => {
    const queryRaw = jest.fn();
    const service = new PgVectorStoreService({ $queryRaw: queryRaw } as unknown as PrismaService);

    await expect(
      service.insertChunk({ documentId: 'd1', source: 's', content: 'c', embedding: [1, NaN, 3] }),
    ).rejects.toThrow('embedding must be a non-empty array of finite numbers');
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('inserts a chunk and returns the generated id', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ id: 'chunk-1' }]);
    const service = new PgVectorStoreService({ $queryRaw: queryRaw } as unknown as PrismaService);

    const id = await service.insertChunk({ documentId: 'd1', source: 'policy:x', content: 'text', embedding: [0.1, 0.2] });

    expect(id).toBe('chunk-1');
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('similaritySearch filters by source prefix when provided', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = new PgVectorStoreService({ $queryRaw: queryRaw } as unknown as PrismaService);

    await service.similaritySearch([1, 0], 4, 'policy:');

    const [strings, ...values] = queryRaw.mock.calls[0];
    expect(strings.join('')).toContain('WHERE source LIKE');
    expect(values).toContain('policy:%');
  });

  it('similaritySearch omits the WHERE clause entirely when no prefix is given', async () => {
    const queryRaw = jest.fn().mockResolvedValue([]);
    const service = new PgVectorStoreService({ $queryRaw: queryRaw } as unknown as PrismaService);

    await service.similaritySearch([1, 0], 4);

    const [strings] = queryRaw.mock.calls[0];
    expect(strings.join('')).not.toContain('WHERE');
  });

  it('deleteByDocumentId issues a scoped DELETE via $executeRaw', async () => {
    const executeRaw = jest.fn().mockResolvedValue(3);
    const service = new PgVectorStoreService({ $executeRaw: executeRaw } as unknown as PrismaService);

    const count = await service.deleteByDocumentId('d1');

    expect(count).toBe(3);
    const [strings, ...values] = executeRaw.mock.calls[0];
    expect(strings.join('')).toContain('DELETE FROM document_chunks WHERE document_id =');
    expect(values).toContain('d1');
  });
});
