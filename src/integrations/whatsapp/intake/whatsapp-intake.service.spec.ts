import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { DataSource, Repository } from 'typeorm';

import { getTestConfig } from '../../../../test/helpers/test-database.helper';
import { WhatsappInboundEvent } from '../entities/whatsapp-inbound-event.entity';
import { WhatsAppIntakeService } from './whatsapp-intake.service';

jest.setTimeout(120_000);

/**
 * T1 intake: every inbound `wamid` is persisted exactly once *before* the
 * webhook answers 200. A retry with an already-seen `wamid` is a noop, and a
 * crash after persist leaves the row behind for recovery.
 */
describe('WhatsAppIntakeService', () => {
  let module: TestingModule;
  let service: WhatsAppIntakeService;
  let events: Repository<WhatsappInboundEvent>;
  let dataSource: DataSource;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(getTestConfig([WhatsappInboundEvent])),
        TypeOrmModule.forFeature([WhatsappInboundEvent]),
      ],
      providers: [
        WhatsAppIntakeService,
        { provide: PinoLogger, useValue: { debug: jest.fn() } },
      ],
    }).compile();

    service = module.get(WhatsAppIntakeService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    events = dataSource.getRepository(WhatsappInboundEvent);
  }, 60_000);

  beforeEach(async () => {
    await events.clear();
  });

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
    if (module) await module.close();
  });

  const inbound = (wamid: string) => ({
    wamid,
    phoneNumberId: 'phone-1',
    messageType: 'text',
    payload: { id: wamid, type: 'text', from: '15551234567' },
  });

  it('stores a new wamid as a pending durable event', async () => {
    const outcome = await service.persistIfNew(inbound('wamid-new-1'));

    expect(outcome).toBe('stored');
    const rows = await events.find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      wamid: 'wamid-new-1',
      phoneNumberId: 'phone-1',
      status: 'pending',
    });
    expect(rows[0].payload).toMatchObject({ id: 'wamid-new-1' });
  });

  it('answers duplicate for an already-seen wamid without a second row', async () => {
    expect(await service.persistIfNew(inbound('wamid-retry-1'))).toBe(
      'stored',
    );
    expect(await service.persistIfNew(inbound('wamid-retry-1'))).toBe(
      'duplicate',
    );

    expect(await events.count()).toBe(1);
  });

  it('keeps exactly one row under concurrent duplicate posts', async () => {
    const outcomes = await Promise.all([
      service.persistIfNew(inbound('wamid-race-1')),
      service.persistIfNew(inbound('wamid-race-1')),
    ]);

    expect(outcomes.sort()).toEqual(['duplicate', 'stored']);
    expect(await events.count()).toBe(1);
  });

  it('leaves the event behind when processing never runs (crash-safety)', async () => {
    await service.persistIfNew(inbound('wamid-crash-1'));

    // No processing ran at all; the row must still be recoverable.
    const pending = await service.listPending(10);

    expect(pending.map((row) => row.wamid)).toEqual(['wamid-crash-1']);
  });

  it('refuses to persist an empty wamid', async () => {
    await expect(
      service.persistIfNew({ ...inbound('wamid-x'), wamid: '' }),
    ).rejects.toThrow();

    expect(await events.count()).toBe(0);
  });
});
