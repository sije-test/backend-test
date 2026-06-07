import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ChangeRequestsController } from './change-requests.controller';
import { ChangeRequestsService } from './change-requests.service';

@Module({
  imports: [OrdersModule],
  controllers: [ChangeRequestsController],
  providers: [ChangeRequestsService],
  exports: [ChangeRequestsService],
})
export class ChangeRequestsModule {}
