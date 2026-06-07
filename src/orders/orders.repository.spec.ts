import { HttpException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { OrdersRepository } from './orders.repository';

describe('OrdersRepository', () => {
  let mockPrisma: jest.Mocked<any>;
  let repo: OrdersRepository;

  const makeOrder = (overrides: Record<string, any> = {}) => ({
    id: 1,
    productName: '상품A',
    quantity: 10,
    unitPrice: 5000,
    specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
    deliveryDate: new Date('2025-12-01'),
    status: PurchaseOrderStatus.PENDING,
    currentVersion: 0,
    buyerId: 'buyer-1',
    ...overrides,
  });

  beforeEach(() => {
    mockPrisma = {
      purchaseOrder: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      purchaseOrderVersion: { create: jest.fn() },
      orderStatusLog: { create: jest.fn() },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    };
    repo = new OrdersRepository(mockPrisma);
  });

  describe('create', () => {
    it('purchaseOrder.create를 올바른 인수로 호출한다', async () => {
      const data = {
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
        deliveryDate: new Date('2025-12-01'),
        buyerId: 'buyer-1',
        status: PurchaseOrderStatus.PENDING,
      };
      mockPrisma.purchaseOrder.create.mockResolvedValue({ id: 1, ...data });

      const result = await repo.create(data);

      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ productName: '상품A' }),
        }),
      );
      expect(result).toEqual(expect.objectContaining({ id: 1 }));
    });
  });

  describe('findById', () => {
    it('발주서가 존재하면 반환한다', async () => {
      const order = makeOrder();
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);

      const result = await repo.findById(1);

      expect(mockPrisma.purchaseOrder.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      expect(result).toEqual(order);
    });

    it('발주서가 없으면 null을 반환한다', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      const result = await repo.findById(999);

      expect(result).toBeNull();
    });
  });

  describe('confirmWithSnapshot', () => {
    it('$transaction 내에서 update / purchaseOrderVersion.create / orderStatusLog.create를 순서대로 호출한다', async () => {
      const order = makeOrder();
      const updatedOrder = {
        ...order,
        status: PurchaseOrderStatus.CONFIRMED,
        currentVersion: 1,
      };
      mockPrisma.purchaseOrder.update.mockResolvedValue(updatedOrder);
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});
      mockPrisma.orderStatusLog.create.mockResolvedValue({});

      const result = await repo.confirmWithSnapshot(order, 'sourcing-user');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 1, status: PurchaseOrderStatus.PENDING },
        data: { status: PurchaseOrderStatus.CONFIRMED, currentVersion: 1 },
      });
      expect(mockPrisma.purchaseOrderVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 1,
            version: 1,
            reason: '초기 확정',
            changedBy: 'sourcing-user',
            changeRequestId: null,
          }),
        }),
      );
      expect(mockPrisma.orderStatusLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: 1,
            fromStatus: PurchaseOrderStatus.PENDING,
            toStatus: PurchaseOrderStatus.CONFIRMED,
            changedBy: 'sourcing-user',
          }),
        }),
      );
      expect(result).toEqual(updatedOrder);
    });

    it('P2025 에러 발생 시 400 INVALID_STATUS_TRANSITION으로 변환한다', async () => {
      const order = makeOrder();
      const p2025Error = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      }) as Prisma.PrismaClientKnownRequestError;
      mockPrisma.$transaction.mockRejectedValue(p2025Error);

      try {
        await repo.confirmWithSnapshot(order, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect((ex as HttpException).getStatus()).toBe(400);
        expect(((ex as HttpException).getResponse() as any).code).toBe(
          'INVALID_STATUS_TRANSITION',
        );
      }
    });

    it('P2025 이외의 DB 오류는 그대로 re-throw한다', async () => {
      const order = makeOrder();
      const dbError = new Error('DB 연결 오류');
      mockPrisma.$transaction.mockRejectedValue(dbError);

      await expect(
        repo.confirmWithSnapshot(order, 'sourcing-user'),
      ).rejects.toThrow(dbError);
    });
  });
});
