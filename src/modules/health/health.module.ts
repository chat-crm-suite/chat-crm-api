import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import healthConfig from '../../config/health.config';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { HEALTH_PROBES } from './health.probe';
import { BullMqProbe } from './probes/bullmq.probe';
import { CacheProbe } from './probes/cache.probe';
import { DatabaseProbe } from './probes/database.probe';
import { IaProbe } from './probes/ia.probe';

@Module({
  imports: [ConfigModule.forFeature(healthConfig)],
  controllers: [HealthController],
  providers: [
    HealthService,
    DatabaseProbe,
    CacheProbe,
    BullMqProbe,
    IaProbe,
    {
      provide: HEALTH_PROBES,
      useFactory: (
        database: DatabaseProbe,
        cache: CacheProbe,
        bullmq: BullMqProbe,
        ia: IaProbe,
      ) => [database, cache, bullmq, ia],
      inject: [DatabaseProbe, CacheProbe, BullMqProbe, IaProbe],
    },
  ],
})
export class HealthModule {}
