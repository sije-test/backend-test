import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';

@Module({
  imports: [OrdersModule],
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
