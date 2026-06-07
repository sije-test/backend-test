import { HttpException } from '@nestjs/common';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { OrdersService } from './orders.service';
import { SpecsDto } from '../common/dto/specs.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { Prisma } from '../generated/prisma/client';

jest.mock('../prisma/prisma.service');

const makeSizesDto = (size: string, qty: number) => ({ size, quantity: qty });
const makeSpecs = (color: string, sizes: { size: string; quantity: number }[]): SpecsDto =>
  ({ color, sizes } as SpecsDto);

describe('OrdersService', () => {
  let mockPrisma: jest.Mocked<any>;
  let service: OrdersService;

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
    } as unknown as any;
    service = new OrdersService(mockPrisma);
  });

  describe('createOrder', () => {
    it('정상적으로 발주서를 생성하고 반환한다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 10)]),
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
        status: PurchaseOrderStatus.PENDING,
      };
      const expected = { id: 1, ...dto };
      mockPrisma.purchaseOrder.create.mockResolvedValue(expected);

      const result = await service.createOrder(dto);

      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('status를 생략하면 prisma.create에 status: DRAFT로 전달한다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 10)]),
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
      };
      mockPrisma.purchaseOrder.create.mockResolvedValue({ id: 1 });

      await service.createOrder(dto);

      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PurchaseOrderStatus.DRAFT }),
        }),
      );
    });

    it('status: PENDING을 명시하면 prisma.create에 status: PENDING으로 전달한다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 10)]),
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
        status: PurchaseOrderStatus.PENDING,
      };
      mockPrisma.purchaseOrder.create.mockResolvedValue({ id: 1 });

      await service.createOrder(dto);

      expect(mockPrisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: PurchaseOrderStatus.PENDING }),
        }),
      );
    });

    it('specs sizes 합계가 quantity와 다르면 400 INVALID_SPECS_QUANTITY를 던진다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 5)]), // 합계 5 != 10
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
      };

      try {
        await service.createOrder(dto);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
      }
    });
  });

  describe('findOrderById', () => {
    it('존재하지 않는 id 조회 시 404 ORDER_NOT_FOUND를 던진다', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      try {
        await service.findOrderById(999);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('ORDER_NOT_FOUND');
      }
    });
  });

  describe('confirmOrder', () => {
    it('PENDING 상태 발주서를 정상 확정하고 버전1 스냅샷과 상태 로그를 생성한다', async () => {
      const order = {
        id: 1,
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
        deliveryDate: new Date('2025-12-01'),
        status: PurchaseOrderStatus.PENDING,
        currentVersion: 0,
        buyerId: 'buyer-1',
      };
      const updatedOrder = { ...order, status: PurchaseOrderStatus.CONFIRMED, currentVersion: 1 };

      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      mockPrisma.purchaseOrder.update.mockResolvedValue(updatedOrder);
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});
      mockPrisma.orderStatusLog.create.mockResolvedValue({});

      const result = await service.confirmOrder(1, 'sourcing-user');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 1, status: PurchaseOrderStatus.PENDING },
        data: { status: PurchaseOrderStatus.CONFIRMED, currentVersion: 1 },
      });
      expect(mockPrisma.purchaseOrderVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 1,
          version: 1,
          reason: '초기 확정',
          changedBy: 'sourcing-user',
          changeRequestId: null,
        }),
      });
      expect(mockPrisma.orderStatusLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 1,
          fromStatus: PurchaseOrderStatus.PENDING,
          toStatus: PurchaseOrderStatus.CONFIRMED,
          changedBy: 'sourcing-user',
        }),
      });
      expect(result).toEqual(updatedOrder);
    });

    it('PENDING이 아닌 상태에서 확정 시 400 INVALID_STATUS_TRANSITION을 던진다', async () => {
      const order = {
        id: 1,
        status: PurchaseOrderStatus.DRAFT,
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);

      try {
        await service.confirmOrder(1, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });

    it('발주서가 없을 때 404 ORDER_NOT_FOUND를 던진다', async () => {
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(null);

      try {
        await service.confirmOrder(999, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('ORDER_NOT_FOUND');
      }
    });

    it('트랜잭션 내부 DB 오류 시 ERROR 로깅 후 re-throw한다', async () => {
      const order = {
        id: 1,
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
        deliveryDate: new Date('2025-12-01'),
        status: PurchaseOrderStatus.PENDING,
        currentVersion: 0,
        buyerId: 'buyer-1',
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      const dbError = new Error('DB 연결 오류');
      mockPrisma.$transaction.mockRejectedValue(dbError);

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      try {
        await service.confirmOrder(1, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBe(dbError);
        expect(loggerErrorSpy).toHaveBeenCalled();
      }
    });

    it('트랜잭션에서 P2025 에러 발생 시 400 INVALID_STATUS_TRANSITION으로 변환한다', async () => {
      const order = {
        id: 1,
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
        deliveryDate: new Date('2025-12-01'),
        status: PurchaseOrderStatus.PENDING,
        currentVersion: 0,
        buyerId: 'buyer-1',
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      const p2025Error = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      }) as Prisma.PrismaClientKnownRequestError;
      mockPrisma.$transaction.mockRejectedValue(p2025Error);

      try {
        await service.confirmOrder(1, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect((ex as HttpException).getStatus()).toBe(400);
        expect(((ex as HttpException).getResponse() as any).code).toBe('INVALID_STATUS_TRANSITION');
      }
    });

    it('트랜잭션 내부에서 HttpException 발생 시 logger.error 없이 그대로 re-throw한다', async () => {
      const order = {
        id: 1,
        productName: '상품A',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] },
        deliveryDate: new Date('2025-12-01'),
        status: PurchaseOrderStatus.PENDING,
        currentVersion: 0,
        buyerId: 'buyer-1',
      };
      mockPrisma.purchaseOrder.findUnique.mockResolvedValue(order);
      const httpError = new HttpException({ code: 'SOME_CODE', message: 'test' }, 400);
      mockPrisma.$transaction.mockRejectedValue(httpError);

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      try {
        await service.confirmOrder(1, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect((ex as HttpException).getStatus()).toBe(400);
        expect(loggerErrorSpy).not.toHaveBeenCalled();
      }
    });
  });
});
