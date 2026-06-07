import { HttpException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ChangeRequestStatus } from '../common/enums/change-request-status.enum';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { ChangeRequestsRepository } from './change-requests.repository';

describe('ChangeRequestsRepository', () => {
  let mockPrisma: jest.Mocked<any>;
  let repo: ChangeRequestsRepository;

  const makeChangeRequest = (overrides: Record<string, any> = {}) => ({
    id: 10,
    orderId: 1,
    requestedBy: 'buyer-1',
    reason: '납기일 변경',
    changes: { deliveryDate: '2026-01-01' },
    status: ChangeRequestStatus.PENDING,
    reviewedBy: null,
    reviewComment: null,
    createdAt: new Date(),
    reviewedAt: null,
    ...overrides,
  });

  const makeOrder = (overrides: Record<string, any> = {}) => ({
    id: 1,
    productName: '상품A',
    quantity: 10,
    unitPrice: 5000,
    specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
    deliveryDate: new Date('2025-12-01'),
    status: PurchaseOrderStatus.CONFIRMED,
    currentVersion: 1,
    buyerId: 'buyer-1',
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma = {
      changeRequest: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      purchaseOrder: { update: jest.fn() },
      purchaseOrderVersion: { create: jest.fn() },
      $transaction: jest.fn((cb: any, opts?: any) => cb(mockPrisma)),
    };
    repo = new ChangeRequestsRepository(mockPrisma);
  });

  describe('findByIdAndOrder', () => {
    it('changeRequest.findFirst를 올바른 where 조건으로 호출한다', async () => {
      mockPrisma.changeRequest.findFirst.mockResolvedValue(makeChangeRequest());
      const result = await repo.findByIdAndOrder(10, 1);
      expect(mockPrisma.changeRequest.findFirst).toHaveBeenCalledWith({
        where: { id: 10, orderId: 1 },
      });
      expect(result).toMatchObject({ id: 10, orderId: 1 });
    });

    it('없으면 null을 반환한다', async () => {
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      const result = await repo.findByIdAndOrder(999, 1);
      expect(result).toBeNull();
    });
  });

  describe('findManyByOrder', () => {
    it('changeRequest.findMany를 createdAt asc로 호출하고 목록을 반환한다', async () => {
      const list = [
        makeChangeRequest({ id: 10 }),
        makeChangeRequest({ id: 11 }),
      ];
      mockPrisma.changeRequest.findMany.mockResolvedValue(list);
      const result = await repo.findManyByOrder(1);
      expect(mockPrisma.changeRequest.findMany).toHaveBeenCalledWith({
        where: { orderId: 1 },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('createPendingWithDuplicateGuard', () => {
    const input = {
      orderId: 1,
      requestedBy: 'buyer-1',
      reason: '납기일 변경',
      changes: { deliveryDate: '2026-01-01' },
    };

    it('Serializable 트랜잭션으로 변경요청을 생성한다', async () => {
      const created = makeChangeRequest();
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.changeRequest.create.mockResolvedValue(created);

      const result = await repo.createPendingWithDuplicateGuard(input);

      expect(mockPrisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        { isolationLevel: 'Serializable' },
      );
      expect(mockPrisma.changeRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 1,
            requestedBy: 'buyer-1',
            status: ChangeRequestStatus.PENDING,
          }),
        }),
      );
      expect(result).toEqual(created);
    });

    it('이미 PENDING인 변경요청이 있으면 409 CHANGE_REQUEST_ALREADY_PENDING을 던진다', async () => {
      mockPrisma.changeRequest.findFirst.mockResolvedValue(makeChangeRequest());

      try {
        await repo.createPendingWithDuplicateGuard(input);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect((ex as HttpException).getStatus()).toBe(409);
        expect(((ex as HttpException).getResponse() as any).code).toBe(
          'CHANGE_REQUEST_ALREADY_PENDING',
        );
      }
    });
  });

  describe('approveWithVersion', () => {
    const params = {
      requestId: 10,
      orderId: 1,
      merged: {
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: {},
        deliveryDate: new Date('2026-01-01'),
      },
      userId: 'sourcing-user',
      reason: '납기일 변경',
      reviewComment: '승인합니다.',
    };

    it('changeRequest.update / purchaseOrder.update / purchaseOrderVersion.create를 순서대로 실행한다', async () => {
      const updatedCR = makeChangeRequest({
        status: ChangeRequestStatus.APPROVED,
      });
      const updatedOrder = makeOrder({ currentVersion: 2 });
      mockPrisma.changeRequest.update.mockResolvedValue(updatedCR);
      mockPrisma.purchaseOrder.update.mockResolvedValue(updatedOrder);
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});

      const result = await repo.approveWithVersion(params);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.changeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10, status: ChangeRequestStatus.PENDING },
          data: expect.objectContaining({
            status: ChangeRequestStatus.APPROVED,
            reviewedBy: 'sourcing-user',
          }),
        }),
      );
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: expect.objectContaining({ currentVersion: { increment: 1 } }),
        }),
      );
      expect(mockPrisma.purchaseOrderVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 1,
            version: 2,
            changedBy: 'sourcing-user',
            changeRequestId: 10,
          }),
        }),
      );
      expect(result).toEqual(updatedCR);
    });

    it('P2025 에러 발생 시 400 CHANGE_REQUEST_NOT_PENDING으로 변환한다', async () => {
      const p2025Error = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      }) as Prisma.PrismaClientKnownRequestError;
      mockPrisma.$transaction.mockRejectedValue(p2025Error);

      try {
        await repo.approveWithVersion(params);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect((ex as HttpException).getStatus()).toBe(400);
        expect(((ex as HttpException).getResponse() as any).code).toBe(
          'CHANGE_REQUEST_NOT_PENDING',
        );
      }
    });

    it('P2025 이외의 DB 오류는 그대로 re-throw한다', async () => {
      const dbError = new Error('DB 연결 오류');
      mockPrisma.$transaction.mockRejectedValue(dbError);
      await expect(repo.approveWithVersion(params)).rejects.toThrow(dbError);
    });
  });

  describe('reject', () => {
    it('changeRequest.update를 REJECTED 상태로 올바르게 호출한다', async () => {
      const updated = makeChangeRequest({
        status: ChangeRequestStatus.REJECTED,
        reviewComment: '반려합니다.',
      });
      mockPrisma.changeRequest.update.mockResolvedValue(updated);

      const result = await repo.reject(10, {
        reviewedBy: 'sourcing-user',
        reviewComment: '반려합니다.',
      });

      expect(mockPrisma.changeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10 },
          data: expect.objectContaining({
            status: ChangeRequestStatus.REJECTED,
            reviewedBy: 'sourcing-user',
            reviewComment: '반려합니다.',
          }),
        }),
      );
      expect(result).toEqual(updated);
    });
  });
});
