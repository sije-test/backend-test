import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersController } from './orders.controller';

// 403/권한 케이스는 E2E(Phase 7)에서 검증

const mockService = {
  createOrder: jest.fn(),
  findOrderById: jest.fn(),
  confirmOrder: jest.fn(),
};

describe('OrdersController', () => {
  let controller: OrdersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new OrdersController(mockService as any);
  });

  describe('create', () => {
    it('ordersService.createOrder를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const dto: CreateOrderDto = {
        productName: '반팔 티셔츠',
        quantity: 10,
        unitPrice: 5000,
        specs: { color: 'red', sizes: [{ size: 'M', quantity: 10 }] } as any,
        deliveryDate: '2025-12-01',
        buyerId: 'buyer-1',
        status: PurchaseOrderStatus.PENDING,
      };
      const expected = { id: 1, ...dto };
      mockService.createOrder.mockResolvedValue(expected);

      const result = await controller.create(dto);

      expect(mockService.createOrder).toHaveBeenCalledTimes(1);
      expect(mockService.createOrder).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });
  });

  describe('findOne', () => {
    it('ordersService.findOrderById(42) 호출 후 반환값을 그대로 전달한다', async () => {
      const expected = { id: 42, productName: '상품A' };
      mockService.findOrderById.mockResolvedValue(expected);

      const result = await controller.findOne(42);

      expect(mockService.findOrderById).toHaveBeenCalledWith(42);
      expect(result).toEqual(expected);
    });
  });

  describe('confirm', () => {
    it('req.userId가 confirmOrder의 두 번째 인자로 정확히 전달된다', async () => {
      const expected = { id: 1, status: 'CONFIRMED' };
      mockService.confirmOrder.mockResolvedValue(expected);
      const req = { userId: 'user-123' } as any;

      const result = await controller.confirm(1, req);

      expect(mockService.confirmOrder).toHaveBeenCalledWith(1, 'user-123');
      expect(result).toEqual(expected);
    });

    it('req.userId가 null/undefined이면 빈 문자열로 전달된다', async () => {
      mockService.confirmOrder.mockResolvedValue({});
      const req = { userId: null } as any;

      await controller.confirm(1, req);

      expect(mockService.confirmOrder).toHaveBeenCalledWith(1, '');
    });
  });
});
