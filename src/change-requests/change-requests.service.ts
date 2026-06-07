import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ChangeRequestStatus } from '../common/enums/change-request-status.enum';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { businessError } from '../common/exceptions/business.exception';
import { validateSpecsQuantity } from '../common/helpers/validate-specs-quantity.helper';
import { mergeChanges } from '../common/constants/order-fields.const';
import { OrdersService } from '../orders/orders.service';
import { ChangeRequestsRepository } from './change-requests.repository';
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
    private readonly repo: ChangeRequestsRepository,
    private readonly ordersService: OrdersService,
  ) {}

  /** 변경요청을 생성한다. 발주서 생성자(buyerId)만 가능하며, 발주서가 CONFIRMED 이상일 때만 허용된다. PENDING 체크와 create를 Serializable 트랜잭션으로 묶어 동시 중복 요청을 방지한다. */
  async createChangeRequest(
    orderId: number,
    dto: CreateChangeRequestDto,
    userId: string,
  ) {
    const order = await this.ordersService.findOrderById(orderId);

    this.assertOrderOwner(order, userId);
    this.assertOrderConfirmed(order, '변경요청 생성 불가 — 확정 전 상태');
    this.assertChangesPresent(dto.changes as Record<string, unknown>);

    if (dto.changes.specs) {
      validateSpecsQuantity(
        dto.changes.specs,
        dto.changes.quantity ?? order.quantity,
      );
    }

    try {
      const changeRequest = await this.repo.createPendingWithDuplicateGuard({
        orderId,
        requestedBy: userId,
        reason: dto.reason,
        changes: dto.changes,
      });
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
    return this.repo.findManyByOrder(orderId);
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
    const changeRequest = await this.loadPendingChangeRequest(
      requestId,
      orderId,
    );

    const order = await this.ordersService.findOrderById(orderId);

    this.assertOrderConfirmed(order, '승인 불가 — 확정 전 상태');

    const changes = changeRequest.changes as Record<string, unknown>;
    const merged = mergeChanges(order, changes);

    if (changes.specs) {
      validateSpecsQuantity(
        merged.specs as Parameters<typeof validateSpecsQuantity>[0],
        merged.quantity as number,
      );
    }

    try {
      const updatedChangeRequest = await this.repo.approveWithVersion({
        requestId,
        orderId,
        merged,
        userId,
        reason: changeRequest.reason,
        reviewComment: dto.reviewComment ?? null,
      });
      this.logger.log(
        `변경요청 승인 완료 requestId=${requestId} orderId=${orderId} userId=${userId}`,
      );
      return updatedChangeRequest;
    } catch (err) {
      if (err instanceof HttpException) throw err;
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
    await this.loadPendingChangeRequest(requestId, orderId);

    const updated = await this.repo.reject(requestId, {
      reviewedBy: userId,
      reviewComment: dto.reviewComment ?? null,
    });

    this.logger.log(
      `변경요청 반려 완료 requestId=${requestId} orderId=${orderId} userId=${userId}`,
    );
    return updated;
  }

  /** 요청자가 발주서 생성자인지 검증한다. */
  private assertOrderOwner(
    order: { id: number; buyerId: string },
    userId: string,
  ): void {
    if (order.buyerId !== userId) {
      this.logger.warn(
        `변경요청 생성 불가 — 생성자 아님 orderId=${order.id} buyerId=${order.buyerId} userId=${userId}`,
      );
      businessError('NOT_ORDER_OWNER');
    }
  }

  /** 발주서가 CONFIRMED 이상 상태인지 검증한다. context는 warn 로그 접두사로 사용된다. */
  private assertOrderConfirmed(
    order: { id: number; status: string },
    context: string,
  ): void {
    if (
      STATUS_RANK[order.status as PurchaseOrderStatus] <
      STATUS_RANK[PurchaseOrderStatus.CONFIRMED]
    ) {
      this.logger.warn(`${context} orderId=${order.id} status=${order.status}`);
      businessError('ORDER_NOT_CONFIRMED');
    }
  }

  /** 변경요청 DTO에 변경 필드가 하나 이상 있는지 검증한다. */
  private assertChangesPresent(changes: Record<string, unknown>): void {
    if (Object.keys(changes).length === 0) {
      businessError('CHANGES_REQUIRED');
    }
  }

  /** 변경요청을 조회하고 PENDING 상태인지 검증한다. 없거나 PENDING이 아니면 각각 404·400을 던진다. */
  private async loadPendingChangeRequest(requestId: number, orderId: number) {
    const changeRequest = await this.repo.findByIdAndOrder(requestId, orderId);
    if (!changeRequest) {
      this.logger.warn(
        `변경요청 없음 requestId=${requestId} orderId=${orderId}`,
      );
      businessError('CHANGE_REQUEST_NOT_FOUND');
    }
    if (changeRequest.status !== ChangeRequestStatus.PENDING) {
      this.logger.warn(
        `처리 불가 — PENDING 아님 requestId=${requestId} status=${changeRequest.status}`,
      );
      businessError('CHANGE_REQUEST_NOT_PENDING');
    }
    return changeRequest;
  }
}
