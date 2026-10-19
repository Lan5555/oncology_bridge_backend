import { Global, Module } from '@nestjs/common';
import { OperationalReadsService } from './operational-reads.service';
import { AdminMarketplaceReadController } from './operational-reads.controller';

@Global()
@Module({
  controllers: [AdminMarketplaceReadController],
  providers: [OperationalReadsService],
  exports: [OperationalReadsService],
})
export class OperationalReadsModule {}
