import { HttpException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { ChangeRequestStatus } from '../common/enums/change-request-status.enum';
import { PurchaseOrderStatus } from '../common/enums/purchase-order-status.enum';
import { ChangeRequestsService } from './change-requests.service';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ReviewChangeRequestDto } from './dto/review-change-request.dto';
import { SpecsDto } from '../common/dto/specs.dto';

jest.mock('../prisma/prisma.service');

const makeSpecs = (sizes: { size: string; quantity: number }[]): SpecsDto =>
  ({ color: 'red', sizes } as SpecsDto);

const makeOrder = (overrides: Partial<Record<string, any>> = {}) => ({
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

const makeChangeRequest = (overrides: Partial<Record<string, any>> = {}) => ({
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

describe('ChangeRequestsService', () => {
  let mockPrisma: jest.Mocked<any>;
  let mockOrdersService: jest.Mocked<any>;
  let service: ChangeRequestsService;

  beforeEach(() => {
    mockPrisma = {
      changeRequest: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      purchaseOrder: { update: jest.fn() },
      purchaseOrderVersion: { create: jest.fn() },
      orderStatusLog: { create: jest.fn() },
      $transaction: jest.fn((cb: (tx: any) => Promise<any>) => cb(mockPrisma)),
    } as unknown as any;

    mockOrdersService = {
      findOrderById: jest.fn(),
    };

    service = new ChangeRequestsService(mockPrisma, mockOrdersService);
  });

  describe('createChangeRequest', () => {
    it('정상적으로 변경요청을 생성하고 반환한다', async () => {
      const order = makeOrder();
      const dto: CreateChangeRequestDto = {
        reason: '납기일 변경 요청합니다.',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      const expected = makeChangeRequest();

      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.changeRequest.create.mockResolvedValue(expected);

      const result = await service.createChangeRequest(1, dto, 'buyer-1');

      expect(mockPrisma.changeRequest.create).toHaveBeenCalledTimes(1);
      expect(result).toEqual(expected);
    });

    it('발주서 생성자가 아닌 userId → 403 NOT_ORDER_OWNER', async () => {
      const order = makeOrder({ buyerId: 'buyer-1' });
      const dto: CreateChangeRequestDto = {
        reason: '변경',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);

      try {
        await service.createChangeRequest(1, dto, 'other-buyer');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(403);
        expect((ex.getResponse() as any).code).toBe('NOT_ORDER_OWNER');
      }
    });

    it('PENDING 상태 발주서 → 400 ORDER_NOT_CONFIRMED', async () => {
      const order = makeOrder({ status: PurchaseOrderStatus.PENDING });
      const dto: CreateChangeRequestDto = {
        reason: '변경',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);

      try {
        await service.createChangeRequest(1, dto, 'buyer-1');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('ORDER_NOT_CONFIRMED');
      }
    });

    it('PENDING 변경요청이 이미 존재하면 → 409 CHANGE_REQUEST_ALREADY_PENDING', async () => {
      const order = makeOrder();
      const dto: CreateChangeRequestDto = {
        reason: '변경',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(makeChangeRequest());

      try {
        await service.createChangeRequest(1, dto, 'buyer-1');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(409);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_ALREADY_PENDING');
      }
    });

    it('changes가 빈 객체이면 → 400 CHANGES_REQUIRED', async () => {
      const order = makeOrder();
      const dto: CreateChangeRequestDto = {
        reason: '변경',
        changes: {} as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);

      try {
        await service.createChangeRequest(1, dto, 'buyer-1');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('CHANGES_REQUIRED');
      }
    });

    it('specs 수량 불일치 → 400 INVALID_SPECS_QUANTITY', async () => {
      const order = makeOrder({ quantity: 10 });
      const dto: CreateChangeRequestDto = {
        reason: '사이즈 변경',
        changes: {
          specs: makeSpecs([{ size: 'M', quantity: 5 }]), // 합계 5 != 10
        } as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);

      try {
        await service.createChangeRequest(1, dto, 'buyer-1');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
      }
    });

    it('IN_PRODUCTION 상태 발주서도 변경요청을 정상 생성한다', async () => {
      const order = makeOrder({ status: PurchaseOrderStatus.IN_PRODUCTION });
      const dto: CreateChangeRequestDto = {
        reason: '납기일 변경 요청합니다.',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      const expected = makeChangeRequest();

      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.changeRequest.create.mockResolvedValue(expected);

      const result = await service.createChangeRequest(1, dto, 'buyer-1');

      expect(result).toEqual(expected);
    });

    it('specs와 quantity를 동시에 변경 시 dto의 quantity 기준으로 specs 수량을 검증한다', async () => {
      const order = makeOrder({ quantity: 10 });
      // dto.changes.quantity=20, specs 합계=20 → 일치하므로 정상 생성
      const dto: CreateChangeRequestDto = {
        reason: '수량 및 사이즈 변경',
        changes: {
          quantity: 20,
          specs: makeSpecs([{ size: 'M', quantity: 20 }]),
        } as any,
      };
      const expected = makeChangeRequest({ changes: dto.changes });

      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.changeRequest.create.mockResolvedValue(expected);

      const result = await service.createChangeRequest(1, dto, 'buyer-1');

      expect(result).toEqual(expected);
    });

    it('specs와 quantity 동시 변경 시 dto.quantity와 specs 합계 불일치 → 400 INVALID_SPECS_QUANTITY', async () => {
      const order = makeOrder({ quantity: 10 });
      // dto.changes.quantity=20인데 specs 합계=5 → 불일치
      const dto: CreateChangeRequestDto = {
        reason: '수량 및 사이즈 변경',
        changes: {
          quantity: 20,
          specs: makeSpecs([{ size: 'M', quantity: 5 }]),
        } as any,
      };
      mockOrdersService.findOrderById.mockResolvedValue(order);

      try {
        await service.createChangeRequest(1, dto, 'buyer-1');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
      }
    });

    it('정상 생성 시 changeRequest.create를 올바른 인수로 호출한다', async () => {
      const order = makeOrder();
      const dto: CreateChangeRequestDto = {
        reason: '납기일 변경 요청합니다.',
        changes: { deliveryDate: '2026-01-01' } as any,
      };
      const expected = makeChangeRequest();

      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      mockPrisma.changeRequest.create.mockResolvedValue(expected);

      await service.createChangeRequest(1, dto, 'buyer-1');

      expect(mockPrisma.changeRequest.create).toHaveBeenCalledWith({
        data: {
          orderId: 1,
          requestedBy: 'buyer-1',
          reason: dto.reason,
          changes: dto.changes,
          status: ChangeRequestStatus.PENDING,
        },
      });
    });
  });

  describe('findChangeRequestsByOrderId', () => {
    it('orderId로 변경요청 목록을 createdAt 오름차순으로 반환한다', async () => {
      const expected = [makeChangeRequest({ id: 10 }), makeChangeRequest({ id: 11 })];
      mockOrdersService.findOrderById.mockResolvedValue(makeOrder());
      mockPrisma.changeRequest.findMany.mockResolvedValue(expected);

      const result = await service.findChangeRequestsByOrderId(1);

      expect(mockPrisma.changeRequest.findMany).toHaveBeenCalledWith({
        where: { orderId: 1 },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual(expected);
    });

    it('없는 발주서 orderId → OrdersService가 던지는 404를 그대로 전파한다', async () => {
      const notFoundError = new HttpException({ code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' }, 404);
      mockOrdersService.findOrderById.mockRejectedValue(notFoundError);

      await expect(service.findChangeRequestsByOrderId(999)).rejects.toThrow(notFoundError);
    });
  });

  describe('approveChangeRequest', () => {
    it('정상 승인 → changeRequest.update / purchaseOrder.update / purchaseOrderVersion.create 각 1회, orderStatusLog.create 0회', async () => {
      const changeRequest = makeChangeRequest();
      const order = makeOrder();
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.APPROVED };

      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...makeOrder(), currentVersion: 2 });
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});

      const dto: ReviewChangeRequestDto = { reviewComment: '승인합니다.' };
      const result = await service.approveChangeRequest(1, 10, dto, 'sourcing-user');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.changeRequest.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.purchaseOrderVersion.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.orderStatusLog.create).toHaveBeenCalledTimes(0);
      expect(mockPrisma.purchaseOrderVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2 }) }),
      );
      expect(result).toEqual(updatedChangeRequest);
    });

    it('없는 requestId → 404 CHANGE_REQUEST_NOT_FOUND', async () => {
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      const dto: ReviewChangeRequestDto = {};

      try {
        await service.approveChangeRequest(1, 999, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_NOT_FOUND');
      }
    });

    it('PENDING 아닌 변경요청 → 400 CHANGE_REQUEST_NOT_PENDING', async () => {
      const changeRequest = makeChangeRequest({ status: ChangeRequestStatus.APPROVED });
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      const dto: ReviewChangeRequestDto = {};

      try {
        await service.approveChangeRequest(1, 10, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_NOT_PENDING');
      }
    });

    it('발주서가 CONFIRMED 미만 상태(PENDING) → 400 ORDER_NOT_CONFIRMED', async () => {
      const changeRequest = makeChangeRequest();
      const order = makeOrder({ status: PurchaseOrderStatus.PENDING });
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);
      const dto: ReviewChangeRequestDto = {};

      try {
        await service.approveChangeRequest(1, 10, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('ORDER_NOT_CONFIRMED');
      }
    });

    it('트랜잭션에서 P2025 에러 발생 시 → 400 CHANGE_REQUEST_NOT_PENDING으로 변환', async () => {
      const changeRequest = makeChangeRequest();
      const order = makeOrder();
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);

      const p2025Error = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      }) as Prisma.PrismaClientKnownRequestError;
      mockPrisma.$transaction.mockRejectedValue(p2025Error);

      const dto: ReviewChangeRequestDto = {};

      try {
        await service.approveChangeRequest(1, 10, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_NOT_PENDING');
      }
    });

    it('IN_PRODUCTION 상태 발주서도 변경요청을 정상 승인한다', async () => {
      const changeRequest = makeChangeRequest();
      const order = makeOrder({ status: PurchaseOrderStatus.IN_PRODUCTION });
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.APPROVED };

      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...order, currentVersion: 2 });
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});

      const dto: ReviewChangeRequestDto = { reviewComment: '승인합니다.' };
      const result = await service.approveChangeRequest(1, 10, dto, 'sourcing-user');

      expect(result).toEqual(updatedChangeRequest);
    });

    it('specs 변경 포함 승인 시 quantity 불일치 → 400 INVALID_SPECS_QUANTITY', async () => {
      // changes.specs 합계(5) != order.quantity(10) → 승인 불가
      const changeRequest = makeChangeRequest({
        changes: { specs: makeSpecs([{ size: 'M', quantity: 5 }]) },
      });
      const order = makeOrder({ quantity: 10 });

      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);

      const dto: ReviewChangeRequestDto = {};

      try {
        await service.approveChangeRequest(1, 10, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_SPECS_QUANTITY');
      }
    });

    it('정상 승인 시 changeRequest.update를 올바른 인수로 호출한다', async () => {
      const changeRequest = makeChangeRequest();
      const order = makeOrder();
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.APPROVED };

      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockOrdersService.findOrderById.mockResolvedValue(order);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);
      mockPrisma.purchaseOrder.update.mockResolvedValue({ ...order, currentVersion: 2 });
      mockPrisma.purchaseOrderVersion.create.mockResolvedValue({});

      const dto: ReviewChangeRequestDto = { reviewComment: '승인합니다.' };
      await service.approveChangeRequest(1, 10, dto, 'sourcing-user');

      expect(mockPrisma.changeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 10, status: ChangeRequestStatus.PENDING },
          data: expect.objectContaining({
            status: ChangeRequestStatus.APPROVED,
            reviewedBy: 'sourcing-user',
            reviewComment: '승인합니다.',
          }),
        }),
      );
    });
  });

  describe('rejectChangeRequest', () => {
    it('정상 반려 → changeRequest.update 1회, purchaseOrder.update 0회 (발주서 불변)', async () => {
      const changeRequest = makeChangeRequest();
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.REJECTED };
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);

      const dto: ReviewChangeRequestDto = { reviewComment: '반려합니다.' };
      const result = await service.rejectChangeRequest(1, 10, dto, 'sourcing-user');

      expect(mockPrisma.changeRequest.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.purchaseOrder.update).toHaveBeenCalledTimes(0);
      expect(result).toEqual(updatedChangeRequest);
    });

    it('없는 requestId → 404 CHANGE_REQUEST_NOT_FOUND', async () => {
      mockPrisma.changeRequest.findFirst.mockResolvedValue(null);
      const dto: ReviewChangeRequestDto = {};

      try {
        await service.rejectChangeRequest(1, 999, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_NOT_FOUND');
      }
    });

    it('PENDING 아닌 변경요청 → 400 CHANGE_REQUEST_NOT_PENDING', async () => {
      const changeRequest = makeChangeRequest({ status: ChangeRequestStatus.REJECTED });
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      const dto: ReviewChangeRequestDto = {};

      try {
        await service.rejectChangeRequest(1, 10, dto, 'sourcing-user');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('CHANGE_REQUEST_NOT_PENDING');
      }
    });

    it('정상 반려 시 changeRequest.update를 올바른 인수로 호출한다', async () => {
      const changeRequest = makeChangeRequest();
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.REJECTED };
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);

      const dto: ReviewChangeRequestDto = { reviewComment: '반려합니다.' };
      await service.rejectChangeRequest(1, 10, dto, 'sourcing-user');

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
    });

    it('reviewComment 미전달(undefined) 시 null로 저장된다', async () => {
      const changeRequest = makeChangeRequest();
      const updatedChangeRequest = { ...changeRequest, status: ChangeRequestStatus.REJECTED, reviewComment: null };
      mockPrisma.changeRequest.findFirst.mockResolvedValue(changeRequest);
      mockPrisma.changeRequest.update.mockResolvedValue(updatedChangeRequest);

      const dto: ReviewChangeRequestDto = {};
      const result = await service.rejectChangeRequest(1, 10, dto, 'sourcing-user');

      expect(mockPrisma.changeRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ reviewComment: null }),
        }),
      );
      expect(result.reviewComment).toBeNull();
    });
  });
});
