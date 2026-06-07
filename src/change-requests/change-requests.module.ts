import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ChangeRequestsService } from './change-requests.service';

@Module({
  imports: [OrdersModule],
  providers: [ChangeRequestsService],
  exports: [ChangeRequestsService],
})
export class ChangeRequestsModule {}
