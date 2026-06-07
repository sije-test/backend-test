import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { businessError } from '../common/exceptions/business.exception';
import { buildVersionData } from '../common/constants/order-fields.const';

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 발주서를 생성한다. specs는 Prisma Json 컬럼으로 캐스팅해서 저장한다. */
  create(data: {
    productName: string;
    quantity: number;
    unitPrice: number;
    specs: unknown;
    deliveryDate: Date;
    buyerId: string;
    status: PurchaseOrderStatus;
  }) {
    return this.prisma.purchaseOrder.create({
      data: { ...data, specs: data.specs as Prisma.InputJsonValue },
    });
  }

  /** 발주서를 id로 단건 조회한다. 없으면 null을 반환한다. 404 처리는 서비스 책임. */
  findById(id: number) {
    return this.prisma.purchaseOrder.findUnique({ where: { id } });
  }

  /**
   * 발주서를 CONFIRMED로 확정하고 버전1 스냅샷·상태 로그를 원자적으로 생성한다.
   * 낙관적 동시성 가드(where: status=PENDING)를 사용하며, 실패 시 P2025→INVALID_STATUS_TRANSITION 변환.
   */
  async confirmWithSnapshot(order: { id: number }, userId: string) {
    const orderData = order as Record<string, unknown>;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const result = await tx.purchaseOrder.update({
          where: { id: order.id, status: PurchaseOrderStatus.PENDING },
          data: { status: PurchaseOrderStatus.CONFIRMED, currentVersion: 1 },
        });

        // 최초 확정 버전은 항상 1, changeRequestId는 변경요청 없는 초기 확정이므로 null
        await tx.purchaseOrderVersion.create({
          data: buildVersionData(orderData, {
            orderId: order.id,
            version: 1,
            changedBy: userId,
            reason: '초기 확정',
            changeRequestId: null,
          }) as Prisma.PurchaseOrderVersionUncheckedCreateInput,
        });

        await tx.orderStatusLog.create({
          data: {
            orderId: order.id,
            fromStatus: PurchaseOrderStatus.PENDING,
            toStatus: PurchaseOrderStatus.CONFIRMED,
            changedBy: userId,
          },
        });

        return result;
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        businessError('INVALID_STATUS_TRANSITION');
      }
      throw err;
    }
  }
}
