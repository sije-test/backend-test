import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { HistoryRepository } from './history.repository';

@Module({
  imports: [OrdersModule],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryRepository],
})
export class HistoryModule {}
