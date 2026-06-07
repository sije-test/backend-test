import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { businessError } from '../common/exceptions/business.exception';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { validateSpecsQuantity } from '../common/helpers/validate-specs-quantity.helper';
import { buildVersionData } from '../common/constants/order-fields.const';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 발주서를 생성한다. specs sizes 합계가 quantity와 다르면 400을 던진다. */
  async createOrder(dto: CreateOrderDto) {
    validateSpecsQuantity(dto.specs, dto.quantity);

    try {
      const order = await this.prisma.purchaseOrder.create({
        data: {
          productName: dto.productName,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          specs: dto.specs as unknown as Prisma.InputJsonValue, // Prisma Json 컬럼 — SpecsDto 구조 그대로 저장
          deliveryDate: new Date(dto.deliveryDate),
          buyerId: dto.buyerId,
          status: dto.status ?? PurchaseOrderStatus.DRAFT,
        },
      });
      this.logger.log(
        `발주서 생성 완료 orderId=${order.id} buyerId=${order.buyerId} status=${order.status}`,
      );
      return order;
    } catch (err) {
      this.logger.error(
        `발주서 생성 실패 buyerId=${dto.buyerId} productName=${dto.productName}`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  /** 발주서를 id로 단건 조회한다. 존재하지 않으면 404를 던진다. */
  async findOrderById(id: number) {
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) {
      this.logger.warn(`발주서 없음 orderId=${id}`);
      businessError('ORDER_NOT_FOUND');
    }
    return order;
  }

  /**
   * 발주서를 확정한다. PENDING 상태인 경우에만 허용된다.
   * 단일 트랜잭션으로 상태를 CONFIRMED로 전이하고, 버전1 스냅샷과 상태 변경 이력을 함께 저장한다.
   */
  async confirmOrder(id: number, userId: string) {
    const order = await this.findOrderById(id);

    if (order.status !== PurchaseOrderStatus.PENDING) {
      this.logger.warn(
        `확정 불가 — 현재 상태 orderId=${id} status=${order.status} userId=${userId}`,
      );
      businessError('INVALID_STATUS_TRANSITION');
    }

    try {
      // 확정 시 단일 트랜잭션: 상태 전이 → 버전1 스냅샷 → 상태 로그
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.purchaseOrder.update({
          where: { id, status: PurchaseOrderStatus.PENDING },
          data: { status: PurchaseOrderStatus.CONFIRMED, currentVersion: 1 },
        });

        // 최초 확정 버전은 항상 1, changeRequestId는 변경요청 없는 초기 확정이므로 null
        await tx.purchaseOrderVersion.create({
          data: buildVersionData(order as Record<string, unknown>, {
            orderId: id,
            version: 1,
            changedBy: userId,
            reason: '초기 확정',
            changeRequestId: null,
          }) as Prisma.PurchaseOrderVersionUncheckedCreateInput,
        });

        await tx.orderStatusLog.create({
          data: {
            orderId: id,
            fromStatus: PurchaseOrderStatus.PENDING,
            toStatus: PurchaseOrderStatus.CONFIRMED,
            changedBy: userId,
          },
        });

        return result;
      });

      this.logger.log(`발주서 확정 완료 orderId=${id} userId=${userId}`);
      return updated;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        businessError('INVALID_STATUS_TRANSITION');
      }
      this.logger.error(
        `발주서 확정 트랜잭션 실패 orderId=${id} userId=${userId}`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }
}
