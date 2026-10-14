import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ColdChainEvent } from './entities/cold-chain-event.entity';
import { ColdChainEventsController } from './cold-chain-events.controller';
import { ColdChainEventsService } from './cold-chain-events.service';
import { ColdChainOutbox } from './entities/cold-chain-outbox.entity';
import { ColdChainEventBus } from './cold-chain-event-bus';
import { User } from '../users/entities/user.entity';
import { StorageUnit } from '../storage_units/entities/storage-unit.entity';
import { ColdChainStreamController } from './cold-chain-events.controller';
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ColdChainEvent,
      ColdChainOutbox,
      User,
      StorageUnit,
    ]),
  ],
  controllers: [ColdChainEventsController, ColdChainStreamController],
  providers: [ColdChainEventsService, ColdChainEventBus],
  exports: [ColdChainEventBus, ColdChainEventsService, TypeOrmModule],
})
export class ColdChainEventsModule {}
