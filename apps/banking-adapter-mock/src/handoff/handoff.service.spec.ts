import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HandoffService } from './handoff.service';
import { LeadServiceClient } from '../clients/lead-service.client';
import { LeadStatusEvent } from '@oneandro/common';

const event: LeadStatusEvent = {
  leadId: 'lead-1',
  userId: 'user-1',
  status: 'BANK_HANDOFF',
  previousStatus: 'APPROVED',
  occurredAt: new Date().toISOString(),
};

describe('HandoffService', () => {
  let service: HandoffService;
  let leadServiceClient: { getLead: jest.Mock; resolveHandoff: jest.Mock };
  let randomSpy: jest.SpyInstance;

  beforeEach(async () => {
    leadServiceClient = { getLead: jest.fn(), resolveHandoff: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        HandoffService,
        { provide: LeadServiceClient, useValue: leadServiceClient },
        {
          provide: ConfigService,
          // Zero delay keeps the test fast — the delay itself is exercised
          // implicitly (processHandoff still awaits sleep()), just not for
          // multiple real seconds.
          useValue: { get: (key: string) => ({ 'handoff.minDelayMs': 0, 'handoff.maxDelayMs': 0 })[key] },
        },
      ],
    }).compile();

    service = moduleRef.get(HandoffService);
  });

  afterEach(() => {
    randomSpy?.mockRestore();
  });

  it('fetches the lead, then resolves the handoff to FUNDED for a strong credit score', async () => {
    leadServiceClient.getLead.mockResolvedValue({ id: 'lead-1', creditScoreSnapshot: 720 });
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.1); // well under the 0.95 approval probability

    await service.processHandoff(event);

    expect(leadServiceClient.getLead).toHaveBeenCalledWith('lead-1');
    expect(leadServiceClient.resolveHandoff).toHaveBeenCalledWith('lead-1', 'FUNDED');
  });

  it('resolves the handoff to FUNDING_REJECTED with a reason for a weak credit score', async () => {
    leadServiceClient.getLead.mockResolvedValue({ id: 'lead-1', creditScoreSnapshot: 550 });
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0.99); // above the 0.1 approval probability

    await service.processHandoff(event);

    expect(leadServiceClient.resolveHandoff).toHaveBeenCalledWith(
      'lead-1',
      'FUNDING_REJECTED',
      expect.stringContaining('550'),
    );
  });

  it('rejects with a specific reason when the lead has no credit score at all', async () => {
    leadServiceClient.getLead.mockResolvedValue({ id: 'lead-1', creditScoreSnapshot: null });
    randomSpy = jest.spyOn(Math, 'random').mockReturnValue(0);

    await service.processHandoff(event);

    expect(leadServiceClient.resolveHandoff).toHaveBeenCalledWith(
      'lead-1',
      'FUNDING_REJECTED',
      'No credit score on file for this lead.',
    );
  });

  it('propagates an error if lead-service is unreachable, without calling resolveHandoff', async () => {
    leadServiceClient.getLead.mockRejectedValue(new Error('lead-service GET /leads/lead-1 returned 503'));

    await expect(service.processHandoff(event)).rejects.toThrow('503');
    expect(leadServiceClient.resolveHandoff).not.toHaveBeenCalled();
  });
});
