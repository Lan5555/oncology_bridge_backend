import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UsersModule } from './users/users.module';
import { RoleModule } from './role/role.module';
import { HospitalModule } from './hospital/hospital.module';
import { InventoryModule } from './inventory/inventory.module';
import { MedicineModule } from './medicine/medicine.module';
import { TransferRequestsModule } from './transfer_requests/transfer_requests.module';
import { NotificationModule } from './notification/notification.module';
import { StockOutAlertsModule } from './stock_out_alerts/stock_out_alerts.module';
import { TemperatureLogModule } from './temperature_log/temperature_log.module';
import { AuditLogModule } from './audit_log/audit_log.module';
import { UserSessionsModule } from './user_sessions/user_sessions.module';
import { CourierModule } from './courier/courier.module';
import { CourierAssignmentModule } from './courier_assignment/courier_assignment.module';
import { InsuranceProviderModule } from './insurance_provider/insurance_provider.module';
import { InsuranceRequestModule } from './insurance_request/insurance_request.module';
import { ScanLogModule } from './scan_log/scan_log.module';
import { WebhookLogModule } from './webhook_log/webhook_log.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GuardsModule } from './guards/guards.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        username: configService.get<string>('DATABASE_USERNAME'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        synchronize: false,
        autoLoadEntities: true,
        database: configService.get<string>('DATABASE_NAME'),
      }),
    }),
    UsersModule,
    RoleModule,
    HospitalModule,
    InventoryModule,
    MedicineModule,
    TransferRequestsModule,
    NotificationModule,
    StockOutAlertsModule,
    TemperatureLogModule,
    AuditLogModule,
    UserSessionsModule,
    CourierModule,
    CourierAssignmentModule,
    InsuranceProviderModule,
    InsuranceRequestModule,
    ScanLogModule,
    WebhookLogModule,
    GuardsModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
