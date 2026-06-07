import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ChangeRequestsController } from './change-requests.controller';
import { ChangeRequestsService } from './change-requests.service';
import { ChangeRequestsRepository } from './change-requests.repository';

@Module({
  imports: [OrdersModule],
  controllers: [ChangeRequestsController],
  providers: [ChangeRequestsService, ChangeRequestsRepository],
  exports: [ChangeRequestsService],
})
export class ChangeRequestsModule {}
