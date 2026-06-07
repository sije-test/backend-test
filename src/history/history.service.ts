import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { businessError } from '../common/exceptions/business.exception';
import { ORDER_FIELDS } from '../common/constants/order-fields.const';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  /** 발주서의 전체 버전 목록을 생성 순서대로 반환한다. */
  async getHistory(orderId: number) {
    await this.ordersService.findOrderById(orderId);
    return this.prisma.purchaseOrderVersion.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 특정 버전의 스냅샷을 반환한다. 버전이 존재하지 않으면 404를 던진다. */
  async getVersionSnapshot(orderId: number, version: number) {
    await this.ordersService.findOrderById(orderId);
    const snapshot = await this.prisma.purchaseOrderVersion.findUnique({
      where: { orderId_version: { orderId, version } },
    });
    if (!snapshot) {
      this.logger.warn(
        `버전 스냅샷 없음 orderId=${orderId} version=${version}`,
      );
      businessError('VERSION_NOT_FOUND');
    }
    return snapshot;
  }

  /** 주어진 시점 이전의 가장 최신 스냅샷을 반환한다. timestamp 파싱 실패 시 400, 해당 시점 이전 버전이 없으면 404를 던진다. */
  async getSnapshotAtTimestamp(orderId: number, timestamp: string) {
    await this.ordersService.findOrderById(orderId);
    const parsed = new Date(timestamp);
    if (isNaN(parsed.getTime())) {
      businessError('INVALID_TIMESTAMP');
    }

    // lte + DESC + findFirst: 해당 시점 이전 스냅샷 중 가장 최신 버전을 1건 반환하는 point-in-time 쿼리
    const snapshot = await this.prisma.purchaseOrderVersion.findFirst({
      where: { orderId, createdAt: { lte: parsed } },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshot) {
      this.logger.warn(
        `타임스탬프 이전 버전 없음 orderId=${orderId} timestamp=${timestamp}`,
      );
      businessError('VERSION_NOT_FOUND');
    }
    return snapshot;
  }

  /** 두 버전을 비교해 값이 다른 필드만 { field, before, after }[] 형태로 반환한다. 동일하면 diff: []. */
  async compareVersions(
    orderId: number,
    from: number,
    to: number,
  ): Promise<{ diff: { field: string; before: unknown; after: unknown }[] }> {
    if (from > to) {
      businessError('INVALID_VERSION_RANGE');
    }

    const [fromSnapshot, toSnapshot] = await Promise.all([
      this.getVersionSnapshot(orderId, from),
      this.getVersionSnapshot(orderId, to),
    ]);

    const diff: { field: string; before: unknown; after: unknown }[] = [];
    for (const f of ORDER_FIELDS) {
      // Decimal/Date/Json 타입이 섞여 있어 원시값 직접 비교 불가 — 타입별 정규화 후 문자열 비교
      const before = f.serialize(fromSnapshot[f.key as keyof typeof fromSnapshot]);
      const after = f.serialize(toSnapshot[f.key as keyof typeof toSnapshot]);
      if (before !== after) {
        // 비교는 직렬화 후 하되, 응답에는 raw 값을 넣어 클라이언트가 올바른 타입으로 받도록 함
        diff.push({
          field: f.key,
          before: fromSnapshot[f.key as keyof typeof fromSnapshot],
          after: toSnapshot[f.key as keyof typeof toSnapshot],
        });
      }
    }

    return { diff };
  }

  /** 발주서의 상태 전이 이력을 생성 순서대로 반환한다. 이력이 없으면 빈 배열을 반환한다. */
  async getStatusHistory(orderId: number) {
    await this.ordersService.findOrderById(orderId);
    return this.prisma.orderStatusLog.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
