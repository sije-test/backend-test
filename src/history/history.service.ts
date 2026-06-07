import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ErrorCode } from '../common/constants/error-code.const';

// 변경 가능한 비즈니스 데이터 필드만 비교. changedBy/reason/createdAt 같은 감사 필드는 제외.
const COMPARE_FIELDS = ['productName', 'quantity', 'unitPrice', 'specs', 'deliveryDate'] as const;

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
    const snapshot = await this.prisma.purchaseOrderVersion.findUnique({
      where: { orderId_version: { orderId, version } },
    });
    if (!snapshot) {
      this.logger.warn(`버전 스냅샷 없음 orderId=${orderId} version=${version}`);
      throw new HttpException(
        { code: 'VERSION_NOT_FOUND', message: ErrorCode.VERSION_NOT_FOUND.message },
        ErrorCode.VERSION_NOT_FOUND.status,
      );
    }
    return snapshot;
  }

  /** 주어진 시점 이전의 가장 최신 스냅샷을 반환한다. timestamp 파싱 실패 시 400, 해당 시점 이전 버전이 없으면 404를 던진다. */
  async getSnapshotAtTimestamp(orderId: number, timestamp: string) {
    const parsed = new Date(timestamp);
    if (isNaN(parsed.getTime())) {
      throw new HttpException(
        { code: 'INVALID_TIMESTAMP', message: ErrorCode.INVALID_TIMESTAMP.message },
        ErrorCode.INVALID_TIMESTAMP.status,
      );
    }

    // lte + DESC + findFirst: 해당 시점 이전 스냅샷 중 가장 최신 버전을 1건 반환하는 point-in-time 쿼리
    const snapshot = await this.prisma.purchaseOrderVersion.findFirst({
      where: { orderId, createdAt: { lte: parsed } },
      orderBy: { createdAt: 'desc' },
    });
    if (!snapshot) {
      this.logger.warn(`타임스탬프 이전 버전 없음 orderId=${orderId} timestamp=${timestamp}`);
      throw new HttpException(
        { code: 'VERSION_NOT_FOUND', message: ErrorCode.VERSION_NOT_FOUND.message },
        ErrorCode.VERSION_NOT_FOUND.status,
      );
    }
    return snapshot;
  }

  /** 두 버전을 비교해 값이 다른 필드만 { field, before, after }[] 형태로 반환한다. 동일하면 diff: []. */
  async compareVersions(
    orderId: number,
    from: number,
    to: number,
  ): Promise<{ diff: { field: string; before: unknown; after: unknown }[] }> {
    const [fromSnapshot, toSnapshot] = await Promise.all([
      this.getVersionSnapshot(orderId, from),
      this.getVersionSnapshot(orderId, to),
    ]);

    const diff: { field: string; before: unknown; after: unknown }[] = [];
    for (const field of COMPARE_FIELDS) {
      // Decimal/Date/Json 타입이 섞여 있어 원시값 직접 비교 불가 — 타입별 정규화 후 문자열 비교
      const before = this.serializeField(field, fromSnapshot[field]);
      const after = this.serializeField(field, toSnapshot[field]);
      if (before !== after) {
        diff.push({ field, before, after });
      }
    }

    return { diff };
  }

  private serializeField(field: string, value: unknown): unknown {
    if (field === 'unitPrice') {
      // Prisma.Decimal 인스턴스: toString()으로 trailing zero를 일관 정규화
      return String(value);
    }
    if (field === 'deliveryDate') {
      // Date 인스턴스를 ISO 문자열로 명시적 정규화
      return value instanceof Date ? value.toISOString() : String(value);
    }
    // productName(string), quantity(number), specs(Json)
    return JSON.stringify(value);
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
