import { Module } from '@nestjs/common';
import { InsuranceProviderService } from './insurance_provider.service';
import { InsuranceProviderController } from './insurance_provider.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsuranceProvider } from './entities/insurance_provider.entity';

@Module({
  imports: [TypeOrmModule.forFeature([InsuranceProvider])],
  controllers: [InsuranceProviderController],
  providers: [InsuranceProviderService],
})
export class InsuranceProviderModule {}
