import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ResolutionWorker } from './resolution.worker';
import { RESOLUTION_QUEUE } from './workers.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: RESOLUTION_QUEUE }),
  ],
  providers: [ResolutionWorker],
})
export class WorkersModule {}
