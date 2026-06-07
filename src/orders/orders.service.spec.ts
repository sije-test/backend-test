import { HttpException } from '@nestjs/common';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { OrdersService } from './orders.service';
import { SpecsDto } from '../common/dto/specs.dto';
import { CreateOrderDto } from './dto/create-order.dto';

const makeSizesDto = (size: string, qty: number) => ({ size, quantity: qty });
const makeSpecs = (color: string, sizes: { size: string; quantity: number }[]): SpecsDto =>
  ({ color, sizes } as SpecsDto);

describe('OrdersService', () => {
  let mockOrdersRepository: jest.Mocked<any>;
  let service: OrdersService;

  beforeEach(() => {
    mockOrdersRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      confirmWithSnapshot: jest.fn(),
    } as unknown as any;
    service = new OrdersService(mockOrdersRepository);
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
      mockOrdersRepository.create.mockResolvedValue(expected);

      const result = await service.createOrder(dto);

      expect(mockOrdersRepository.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('status를 생략하면 repo.create에 status: DRAFT로 전달한다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 10)]),
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
      };
      mockOrdersRepository.create.mockResolvedValue({ id: 1 });

      await service.createOrder(dto);

      expect(mockOrdersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: PurchaseOrderStatus.DRAFT }),
      );
    });

    it('status: PENDING을 명시하면 repo.create에 status: PENDING으로 전달한다', async () => {
      const dto: CreateOrderDto = {
        productName: '테스트 상품',
        quantity: 10,
        unitPrice: 5000,
        specs: makeSpecs('red', [makeSizesDto('M', 10)]),
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
        status: PurchaseOrderStatus.PENDING,
      };
      mockOrdersRepository.create.mockResolvedValue({ id: 1 });

      await service.createOrder(dto);

      expect(mockOrdersRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: PurchaseOrderStatus.PENDING }),
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
      mockOrdersRepository.findById.mockResolvedValue(null);

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
    it('PENDING 상태 발주서를 정상 확정한다', async () => {
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

      mockOrdersRepository.findById.mockResolvedValue(order);
      mockOrdersRepository.confirmWithSnapshot.mockResolvedValue(updatedOrder);

      const result = await service.confirmOrder(1, 'sourcing-user');

      expect(mockOrdersRepository.confirmWithSnapshot).toHaveBeenCalledWith(order, 'sourcing-user');
      expect(result).toEqual(updatedOrder);
    });

    it('PENDING이 아닌 상태에서 확정 시 400 INVALID_STATUS_TRANSITION을 던진다', async () => {
      mockOrdersRepository.findById.mockResolvedValue({ id: 1, status: PurchaseOrderStatus.DRAFT });

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
      mockOrdersRepository.findById.mockResolvedValue(null);

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
      mockOrdersRepository.findById.mockResolvedValue(order);
      const dbError = new Error('DB 연결 오류');
      mockOrdersRepository.confirmWithSnapshot.mockRejectedValue(dbError);

      const loggerErrorSpy = jest.spyOn(service['logger'], 'error');

      try {
        await service.confirmOrder(1, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBe(dbError);
        expect(loggerErrorSpy).toHaveBeenCalled();
      }
    });

    it('repository가 변환한 HttpException(INVALID_STATUS_TRANSITION)을 그대로 re-throw한다', async () => {
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
      mockOrdersRepository.findById.mockResolvedValue(order);
      const invalidStatusError = new HttpException(
        { code: 'INVALID_STATUS_TRANSITION', message: '잘못된 상태 전이입니다.' },
        400,
      );
      mockOrdersRepository.confirmWithSnapshot.mockRejectedValue(invalidStatusError);

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
      mockOrdersRepository.findById.mockResolvedValue(order);
      const httpError = new HttpException({ code: 'SOME_CODE', message: 'test' }, 400);
      mockOrdersRepository.confirmWithSnapshot.mockRejectedValue(httpError);

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
