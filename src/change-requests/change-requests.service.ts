import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ChangeRequestStatus } from '../common/enums/change-request-status.enum';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { businessError } from '../common/exceptions/business.exception';
import { validateSpecsQuantity } from '../common/helpers/validate-specs-quantity.helper';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ReviewChangeRequestDto } from './dto/review-change-request.dto';

const STATUS_RANK: Record<PurchaseOrderStatus, number> = {
  [PurchaseOrderStatus.DRAFT]: 0,
  [PurchaseOrderStatus.PENDING]: 1,
  [PurchaseOrderStatus.CONFIRMED]: 2,
  [PurchaseOrderStatus.IN_PRODUCTION]: 3,
  [PurchaseOrderStatus.COMPLETED]: 4,
};

@Injectable()
export class ChangeRequestsService {
  private readonly logger = new Logger(ChangeRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  /** 변경요청을 생성한다. 발주서 생성자(buyerId)만 가능하며, 발주서가 CONFIRMED 이상일 때만 허용된다. PENDING 체크와 create를 Serializable 트랜잭션으로 묶어 동시 중복 요청을 방지한다. */
  async createChangeRequest(
    orderId: number,
    dto: CreateChangeRequestDto,
    userId: string,
  ) {
    const order = await this.ordersService.findOrderById(orderId);

    if (order.buyerId !== userId) {
      this.logger.warn(
        `변경요청 생성 불가 — 생성자 아님 orderId=${orderId} buyerId=${order.buyerId} userId=${userId}`,
      );
      businessError('NOT_ORDER_OWNER');
    }

    if (
      STATUS_RANK[order.status] < STATUS_RANK[PurchaseOrderStatus.CONFIRMED]
    ) {
      this.logger.warn(
        `변경요청 생성 불가 — 확정 전 상태 orderId=${orderId} status=${order.status}`,
      );
      businessError('ORDER_NOT_CONFIRMED');
    }

    if (Object.keys(dto.changes).length === 0) {
      businessError('CHANGES_REQUIRED');
    }

    if (dto.changes.specs) {
      validateSpecsQuantity(
        dto.changes.specs,
        dto.changes.quantity ?? order.quantity,
      );
    }

    // PENDING 체크와 create를 Serializable 트랜잭션으로 묶어 동시 중복 요청 방지
    try {
      const changeRequest = await this.prisma.$transaction(
        async (tx) => {
          const existing = await tx.changeRequest.findFirst({
            where: { orderId, status: ChangeRequestStatus.PENDING },
          });
          if (existing) {
            this.logger.warn(
              `변경요청 중복 orderId=${orderId} existingId=${existing.id}`,
            );
            businessError('CHANGE_REQUEST_ALREADY_PENDING');
          }

          return tx.changeRequest.create({
            data: {
              orderId,
              requestedBy: userId,
              reason: dto.reason,
              changes: dto.changes as unknown as Prisma.InputJsonValue,
              status: ChangeRequestStatus.PENDING,
            },
          });
        },
        { isolationLevel: 'Serializable' },
      );

      this.logger.log(
        `변경요청 생성 완료 orderId=${orderId} changeRequestId=${changeRequest.id} userId=${userId}`,
      );
      return changeRequest;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `변경요청 생성 트랜잭션 실패 orderId=${orderId} userId=${userId}`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  /** 발주서에 속한 변경요청 목록을 생성일 오름차순으로 반환한다. 없는 발주서면 404를 위임한다. */
  async findChangeRequestsByOrderId(orderId: number) {
    await this.ordersService.findOrderById(orderId);
    return this.prisma.changeRequest.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * 변경요청을 승인한다. PENDING 변경요청만 처리 가능하며, 단일 트랜잭션으로 세 단계를 원자적으로 실행한다:
   * 변경요청 상태 APPROVED → 발주서 내용 반영 + currentVersion +1 → 버전 스냅샷 생성.
   * 승인 시 발주서 status는 변경되지 않으므로 OrderStatusLog는 생성하지 않는다.
   */
  async approveChangeRequest(
    orderId: number,
    requestId: number,
    dto: ReviewChangeRequestDto,
    userId: string,
  ) {
    const changeRequest = await this.prisma.changeRequest.findFirst({
      where: { id: requestId, orderId },
    });
    if (!changeRequest) {
      this.logger.warn(
        `변경요청 없음 requestId=${requestId} orderId=${orderId}`,
      );
      businessError('CHANGE_REQUEST_NOT_FOUND');
    }

    if (changeRequest.status !== ChangeRequestStatus.PENDING) {
      this.logger.warn(
        `승인 불가 — PENDING 아님 requestId=${requestId} status=${changeRequest.status}`,
      );
      businessError('CHANGE_REQUEST_NOT_PENDING');
    }

    const order = await this.ordersService.findOrderById(orderId);

    if (
      STATUS_RANK[order.status] < STATUS_RANK[PurchaseOrderStatus.CONFIRMED]
    ) {
      this.logger.warn(
        `승인 불가 — 확정 전 상태 orderId=${orderId} status=${order.status}`,
      );
      businessError('ORDER_NOT_CONFIRMED');
    }

    const changes = changeRequest.changes as Record<string, unknown>;

    const mergedProductName =
      (changes.productName as string) ?? order.productName;
    const mergedQuantity = (changes.quantity as number) ?? order.quantity;
    const mergedUnitPrice = Number(changes.unitPrice ?? order.unitPrice);
    const mergedDeliveryDate = changes.deliveryDate
      ? new Date(changes.deliveryDate as string)
      : order.deliveryDate;
    const mergedSpecs = changes.specs ?? order.specs;

    if (changes.specs) {
      validateSpecsQuantity(
        mergedSpecs as Parameters<typeof validateSpecsQuantity>[0],
        mergedQuantity,
      );
    }

    try {
      const [updatedChangeRequest] = await this.prisma.$transaction(
        async (tx) => {
          const updated = await tx.changeRequest.update({
            where: { id: requestId, status: ChangeRequestStatus.PENDING },
            data: {
              status: ChangeRequestStatus.APPROVED,
              reviewedBy: userId,
              reviewComment: dto.reviewComment ?? null,
              reviewedAt: new Date(),
            },
          });

          const updatedOrder = await tx.purchaseOrder.update({
            where: { id: orderId },
            data: {
              productName: mergedProductName,
              quantity: mergedQuantity,
              unitPrice: mergedUnitPrice,
              specs: mergedSpecs as Prisma.InputJsonValue,
              deliveryDate: mergedDeliveryDate,
              currentVersion: { increment: 1 },
            },
          });

          await tx.purchaseOrderVersion.create({
            data: {
              orderId,
              version: updatedOrder.currentVersion,
              productName: mergedProductName,
              quantity: mergedQuantity,
              unitPrice: mergedUnitPrice,
              specs: mergedSpecs as Prisma.InputJsonValue,
              deliveryDate: mergedDeliveryDate,
              changedBy: userId,
              reason: changeRequest.reason,
              changeRequestId: requestId,
            },
          });

          return [updated];
        },
      );

      this.logger.log(
        `변경요청 승인 완료 requestId=${requestId} orderId=${orderId} userId=${userId}`,
      );
      return updatedChangeRequest;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        businessError('CHANGE_REQUEST_NOT_PENDING');
      }
      this.logger.error(
        `변경요청 승인 트랜잭션 실패 requestId=${requestId} orderId=${orderId} userId=${userId}`,
        err instanceof Error ? err.stack : err,
      );
      throw err;
    }
  }

  /** 변경요청을 반려한다. PENDING 변경요청만 처리 가능하며, 발주서 내용은 변경하지 않는다. */
  async rejectChangeRequest(
    orderId: number,
    requestId: number,
    dto: ReviewChangeRequestDto,
    userId: string,
  ) {
    const changeRequest = await this.prisma.changeRequest.findFirst({
      where: { id: requestId, orderId },
    });
    if (!changeRequest) {
      this.logger.warn(
        `변경요청 없음 requestId=${requestId} orderId=${orderId}`,
      );
      businessError('CHANGE_REQUEST_NOT_FOUND');
    }

    if (changeRequest.status !== ChangeRequestStatus.PENDING) {
      this.logger.warn(
        `반려 불가 — PENDING 아님 requestId=${requestId} status=${changeRequest.status}`,
      );
      businessError('CHANGE_REQUEST_NOT_PENDING');
    }

    const updated = await this.prisma.changeRequest.update({
      where: { id: requestId },
      data: {
        status: ChangeRequestStatus.REJECTED,
        reviewedBy: userId,
        reviewComment: dto.reviewComment ?? null,
        reviewedAt: new Date(),
      },
    });

    this.logger.log(
      `변경요청 반려 완료 requestId=${requestId} orderId=${orderId} userId=${userId}`,
    );
    return updated;
  }
}
