import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const sendMail = jest.fn().mockResolvedValue(undefined);
jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: jest.fn(() => ({ sendMail })) },
}));

import { NotificationsService } from './notifications.service';
import { UserServiceClient } from '../clients/user-service.client';
import { LeadServiceClient } from '../clients/lead-service.client';
import { LeadStatusEvent } from '@oneandro/common';

function makeEvent(status: LeadStatusEvent['status']): LeadStatusEvent {
  return { leadId: 'lead-1', userId: 'user-1', status, occurredAt: new Date().toISOString() };
}

describe('NotificationsService.isNotifiable', () => {
  it('flags outcome statuses', () => {
    expect(NotificationsService.isNotifiable('APPROVED')).toBe(true);
    expect(NotificationsService.isNotifiable('DECLINED')).toBe(true);
    expect(NotificationsService.isNotifiable('FUNDED')).toBe(true);
    expect(NotificationsService.isNotifiable('FUNDING_REJECTED')).toBe(true);
  });

  it('does not flag intermediate/process statuses', () => {
    expect(NotificationsService.isNotifiable('CREATED')).toBe(false);
    expect(NotificationsService.isNotifiable('KYC_UPLOADED')).toBe(false);
    expect(NotificationsService.isNotifiable('CREDIT_CHECKED')).toBe(false);
    expect(NotificationsService.isNotifiable('BANK_HANDOFF')).toBe(false);
  });
});

describe('NotificationsService', () => {
  let service: NotificationsService;
  let userServiceClient: { getUser: jest.Mock };
  let leadServiceClient: { getLead: jest.Mock };

  beforeEach(async () => {
    sendMail.mockClear();
    userServiceClient = { getUser: jest.fn().mockResolvedValue({ id: 'user-1', email: 'ada@example.com', firstName: 'Ada', lastName: 'L' }) };
    leadServiceClient = { getLead: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: UserServiceClient, useValue: userServiceClient },
        { provide: LeadServiceClient, useValue: leadServiceClient },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({ 'smtp.host': 'mailhog', 'smtp.port': 1025, 'smtp.fromAddress': 'notifications@oneandro.local' })[key],
          },
        },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  it('does nothing for a non-notifiable status — no email, no upstream calls', async () => {
    await service.notify(makeEvent('CREATED'));

    expect(sendMail).not.toHaveBeenCalled();
    expect(userServiceClient.getUser).not.toHaveBeenCalled();
  });

  it('sends an approval email without needing to look up the lead', async () => {
    await service.notify(makeEvent('APPROVED'));

    expect(leadServiceClient.getLead).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ada@example.com', subject: expect.stringContaining('approved') }),
    );
  });

  it('sends a funded email', async () => {
    await service.notify(makeEvent('FUNDED'));

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ada@example.com', subject: expect.stringContaining('funded') }));
  });

  it('fetches the lead and includes the decline reason in a DECLINED email', async () => {
    leadServiceClient.getLead.mockResolvedValue({ declineReason: 'Debt-to-income ratio too high' });

    await service.notify(makeEvent('DECLINED'));

    expect(leadServiceClient.getLead).toHaveBeenCalledWith('lead-1');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Debt-to-income ratio too high') }),
    );
  });

  it('fetches the lead and includes the reason in a FUNDING_REJECTED email', async () => {
    leadServiceClient.getLead.mockResolvedValue({ declineReason: 'Partner bank declined funding for credit score 560 (simulated decision).' });

    await service.notify(makeEvent('FUNDING_REJECTED'));

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining('score 560') }));
  });

  it('sends from the configured address', async () => {
    await service.notify(makeEvent('APPROVED'));

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'notifications@oneandro.local' }));
  });
});
