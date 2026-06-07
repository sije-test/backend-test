import { ChangeRequestsController } from './change-requests.controller';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ReviewChangeRequestDto } from './dto/review-change-request.dto';

// 403/권한 케이스는 E2E(Phase 7)에서 검증

const mockService = {
  createChangeRequest: jest.fn(),
  findChangeRequestsByOrderId: jest.fn(),
  approveChangeRequest: jest.fn(),
  rejectChangeRequest: jest.fn(),
};

describe('ChangeRequestsController', () => {
  let controller: ChangeRequestsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ChangeRequestsController(mockService as any);
  });

  describe('create', () => {
    it('changeRequestsService.createChangeRequest를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const dto: CreateChangeRequestDto = {
        reason: '납기일 변경',
        changes: {},
      };
      const expected = { id: 1, orderId: 10 };
      mockService.createChangeRequest.mockResolvedValue(expected);
      const req = { userId: 'user-abc' } as any;

      const result = await controller.create(10, dto, req);

      expect(mockService.createChangeRequest).toHaveBeenCalledTimes(1);
      expect(mockService.createChangeRequest).toHaveBeenCalledWith(
        10,
        dto,
        'user-abc',
      );
      expect(result).toEqual(expected);
    });

    it('req.userId가 null이면 빈 문자열로 전달된다', async () => {
      const dto: CreateChangeRequestDto = {
        reason: '사유',
        changes: {},
      };
      mockService.createChangeRequest.mockResolvedValue({});
      const req = { userId: null } as any;

      await controller.create(10, dto, req);

      expect(mockService.createChangeRequest).toHaveBeenCalledWith(10, dto, '');
    });
  });

  describe('findAll', () => {
    it('changeRequestsService.findChangeRequestsByOrderId를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const expected = [{ id: 1 }, { id: 2 }];
      mockService.findChangeRequestsByOrderId.mockResolvedValue(expected);

      const result = await controller.findAll(10);

      expect(mockService.findChangeRequestsByOrderId).toHaveBeenCalledTimes(1);
      expect(mockService.findChangeRequestsByOrderId).toHaveBeenCalledWith(10);
      expect(result).toEqual(expected);
    });
  });

  describe('approve', () => {
    it('changeRequestsService.approveChangeRequest를 1회 호출하고 반환값을 전달한다', async () => {
      const dto: ReviewChangeRequestDto = { reviewComment: '승인합니다.' };
      const expected = { id: 5, status: 'APPROVED' };
      mockService.approveChangeRequest.mockResolvedValue(expected);
      const req = { userId: 'user-abc' } as any;

      const result = await controller.approve(10, 5, dto, req);

      expect(mockService.approveChangeRequest).toHaveBeenCalledTimes(1);
      expect(mockService.approveChangeRequest).toHaveBeenCalledWith(
        10,
        5,
        dto,
        'user-abc',
      );
      expect(result).toEqual(expected);
    });

    it('req.userId가 null이면 빈 문자열로 전달된다', async () => {
      const dto: ReviewChangeRequestDto = {};
      mockService.approveChangeRequest.mockResolvedValue({});
      const req = { userId: null } as any;

      await controller.approve(10, 5, dto, req);

      expect(mockService.approveChangeRequest).toHaveBeenCalledWith(
        10,
        5,
        dto,
        '',
      );
    });
  });

  describe('reject', () => {
    it('changeRequestsService.rejectChangeRequest를 1회 호출하고 반환값을 전달한다', async () => {
      const dto: ReviewChangeRequestDto = { reviewComment: '반려합니다.' };
      const expected = { id: 5, status: 'REJECTED' };
      mockService.rejectChangeRequest.mockResolvedValue(expected);
      const req = { userId: 'user-abc' } as any;

      const result = await controller.reject(10, 5, dto, req);

      expect(mockService.rejectChangeRequest).toHaveBeenCalledTimes(1);
      expect(mockService.rejectChangeRequest).toHaveBeenCalledWith(
        10,
        5,
        dto,
        'user-abc',
      );
      expect(result).toEqual(expected);
    });
  });
});
