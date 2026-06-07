import { HistoryController } from './history.controller';

// 403/권한 케이스는 E2E(Phase 7)에서 검증

const mockService = {
  getHistory: jest.fn(),
  getVersionSnapshot: jest.fn(),
  getSnapshotAtTimestamp: jest.fn(),
  compareVersions: jest.fn(),
  getStatusHistory: jest.fn(),
};

describe('HistoryController', () => {
  let controller: HistoryController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new HistoryController(mockService as any);
  });

  describe('getHistory', () => {
    it('historyService.getHistory를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const expected = [
        { id: 1, version: 1 },
        { id: 2, version: 2 },
      ];
      mockService.getHistory.mockResolvedValue(expected);

      const result = await controller.getHistory(10);

      expect(mockService.getHistory).toHaveBeenCalledTimes(1);
      expect(mockService.getHistory).toHaveBeenCalledWith(10);
      expect(result).toEqual(expected);
    });
  });

  describe('getVersion', () => {
    it('historyService.getVersionSnapshot를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const expected = { id: 1, version: 2, productName: '제품A' };
      mockService.getVersionSnapshot.mockResolvedValue(expected);

      const result = await controller.getVersion(10, 2);

      expect(mockService.getVersionSnapshot).toHaveBeenCalledTimes(1);
      expect(mockService.getVersionSnapshot).toHaveBeenCalledWith(10, 2);
      expect(result).toEqual(expected);
    });
  });

  describe('getAt', () => {
    it('historyService.getSnapshotAtTimestamp를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const timestamp = '2025-06-01T00:00:00.000Z';
      const expected = { id: 1, version: 1, createdAt: new Date(timestamp) };
      mockService.getSnapshotAtTimestamp.mockResolvedValue(expected);

      const result = await controller.getAt(10, timestamp);

      expect(mockService.getSnapshotAtTimestamp).toHaveBeenCalledTimes(1);
      expect(mockService.getSnapshotAtTimestamp).toHaveBeenCalledWith(
        10,
        timestamp,
      );
      expect(result).toEqual(expected);
    });

    it('timestamp가 undefined일 때 서비스에 undefined 그대로 전달한다', async () => {
      mockService.getSnapshotAtTimestamp.mockResolvedValue(null);

      await controller.getAt(10, undefined as any);

      expect(mockService.getSnapshotAtTimestamp).toHaveBeenCalledWith(
        10,
        undefined,
      );
    });
  });

  describe('compare', () => {
    it('historyService.compareVersions를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const expected = { diff: [{ field: 'quantity', before: 10, after: 20 }] };
      mockService.compareVersions.mockResolvedValue(expected);

      const result = await controller.compare(10, 1, 3);

      expect(mockService.compareVersions).toHaveBeenCalledTimes(1);
      expect(mockService.compareVersions).toHaveBeenCalledWith(10, 1, 3);
      expect(result).toEqual(expected);
    });

    it('from/to가 숫자 타입으로 서비스에 전달된다', async () => {
      mockService.compareVersions.mockResolvedValue({ diff: [] });

      await controller.compare(5, 2, 4);

      const [id, from, to] = mockService.compareVersions.mock.calls[0];
      expect(typeof id).toBe('number');
      expect(typeof from).toBe('number');
      expect(typeof to).toBe('number');
      expect(id).toBe(5);
      expect(from).toBe(2);
      expect(to).toBe(4);
    });
  });

  describe('getStatusHistory', () => {
    it('historyService.getStatusHistory를 1회 호출하고 반환값을 그대로 전달한다', async () => {
      const expected = [
        { id: 1, status: 'DRAFT' },
        { id: 2, status: 'SUBMITTED' },
      ];
      mockService.getStatusHistory.mockResolvedValue(expected);

      const result = await controller.getStatusHistory(10);

      expect(mockService.getStatusHistory).toHaveBeenCalledTimes(1);
      expect(mockService.getStatusHistory).toHaveBeenCalledWith(10);
      expect(result).toEqual(expected);
    });
  });
});
