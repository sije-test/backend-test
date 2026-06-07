import { Injectable } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeRequestStatus } from '../common/enums/change-request-status.enum';
import { businessError } from '../common/exceptions/business.exception';
import { buildVersionData } from '../common/constants/order-fields.const';

@Injectable()
export class ChangeRequestsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 특정 발주서에 속한 변경요청을 id로 조회한다. 없으면 null. */
  findByIdAndOrder(requestId: number, orderId: number) {
    return this.prisma.changeRequest.findFirst({
      where: { id: requestId, orderId },
    });
  }

  /** 발주서의 변경요청 목록을 생성일 오름차순으로 반환한다. */
  findManyByOrder(orderId: number) {
    return this.prisma.changeRequest.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * PENDING 중복 체크와 변경요청 생성을 Serializable 트랜잭션으로 묶는다.
   * 이미 PENDING인 변경요청이 있으면 CHANGE_REQUEST_ALREADY_PENDING을 던진다.
   */
  async createPendingWithDuplicateGuard(input: {
    orderId: number;
    requestedBy: string;
    reason: string;
    changes: unknown;
  }) {
    return this.prisma.$transaction(
      async (tx) => {
        const existing = await tx.changeRequest.findFirst({
          where: {
            orderId: input.orderId,
            status: ChangeRequestStatus.PENDING,
          },
        });
        if (existing) {
          businessError('CHANGE_REQUEST_ALREADY_PENDING');
        }
        return tx.changeRequest.create({
          data: {
            orderId: input.orderId,
            requestedBy: input.requestedBy,
            reason: input.reason,
            changes: input.changes as Prisma.InputJsonValue,
            status: ChangeRequestStatus.PENDING,
          },
        });
      },
      { isolationLevel: 'Serializable' },
    );
  }

  /**
   * 변경요청을 APPROVED로 전환하고, 발주서 내용 반영 + 버전 스냅샷 생성을 원자적으로 실행한다.
   * 낙관적 동시성 가드(where: status=PENDING)를 사용하며, 실패 시 P2025→CHANGE_REQUEST_NOT_PENDING 변환.
   */
  async approveWithVersion(params: {
    requestId: number;
    orderId: number;
    merged: Record<string, unknown>;
    userId: string;
    reason: string;
    reviewComment: string | null;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const updated = await tx.changeRequest.update({
          where: { id: params.requestId, status: ChangeRequestStatus.PENDING },
          data: {
            status: ChangeRequestStatus.APPROVED,
            reviewedBy: params.userId,
            reviewComment: params.reviewComment,
            reviewedAt: new Date(),
          },
        });

        const updatedOrder = await tx.purchaseOrder.update({
          where: { id: params.orderId },
          data: {
            productName: params.merged.productName as string,
            quantity: params.merged.quantity as number,
            unitPrice: params.merged.unitPrice as number,
            specs: params.merged.specs as Prisma.InputJsonValue,
            deliveryDate: params.merged.deliveryDate as Date,
            currentVersion: { increment: 1 },
          },
        });

        await tx.purchaseOrderVersion.create({
          data: buildVersionData(params.merged, {
            orderId: params.orderId,
            version: updatedOrder.currentVersion,
            changedBy: params.userId,
            reason: params.reason,
            changeRequestId: params.requestId,
          }) as Prisma.PurchaseOrderVersionUncheckedCreateInput,
        });

        return updated;
      });
    } catch (err) {
      if ((err as Prisma.PrismaClientKnownRequestError)?.code === 'P2025') {
        businessError('CHANGE_REQUEST_NOT_PENDING');
      }
      throw err;
    }
  }

  /** 변경요청을 REJECTED로 전환한다. 발주서 내용은 변경하지 않는다. */
  reject(
    requestId: number,
    reviewData: { reviewedBy: string; reviewComment: string | null },
  ) {
    return this.prisma.changeRequest.update({
      where: { id: requestId },
      data: {
        status: ChangeRequestStatus.REJECTED,
        reviewedBy: reviewData.reviewedBy,
        reviewComment: reviewData.reviewComment,
        reviewedAt: new Date(),
      },
    });
  }
}
