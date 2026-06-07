import { HttpException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { HistoryService } from './history.service';

jest.mock('../prisma/prisma.service');

function makeVersion(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    orderId: 1,
    version: 1,
    productName: '티셔츠',
    quantity: 100,
    unitPrice: new Prisma.Decimal('15000.00'),
    specs: { color: '흰색', sizes: [{ size: 'M', quantity: 100 }] },
    deliveryDate: new Date('2025-03-15T00:00:00.000Z'),
    changedBy: 'user-1',
    reason: '초기 확정',
    changeRequestId: null,
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeStatusLog(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    orderId: 1,
    fromStatus: 'PENDING',
    toStatus: 'CONFIRMED',
    changedBy: 'user-1',
    createdAt: new Date('2025-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('HistoryService', () => {
  let service: HistoryService;
  let mockPrisma: any;
  let mockOrdersService: any;

  beforeEach(() => {
    mockPrisma = {
      purchaseOrderVersion: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      orderStatusLog: { findMany: jest.fn() },
    } as unknown as any;
    mockOrdersService = { findOrderById: jest.fn() };
    service = new HistoryService(mockPrisma, mockOrdersService);
  });

  describe('getHistory', () => {
    it('버전 2건을 createdAt ASC 정렬로 반환한다', async () => {
      const v1 = makeVersion({ version: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') });
      const v2 = makeVersion({ version: 2, createdAt: new Date('2025-02-01T00:00:00.000Z') });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findMany.mockResolvedValue([v1, v2]);

      const result = await service.getHistory(1);

      expect(mockPrisma.purchaseOrderVersion.findMany).toHaveBeenCalledWith({
        where: { orderId: 1 },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
      expect(result[0].version).toBe(1);
      expect(result[1].version).toBe(2);
    });

    it('버전 0건 → 빈 배열을 반환한다', async () => {
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findMany.mockResolvedValue([]);

      const result = await service.getHistory(1);

      expect(result).toEqual([]);
    });

    it('없는 발주서 → ORDER_NOT_FOUND 404 전파', async () => {
      const notFoundError = new HttpException({ code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' }, 404);
      mockOrdersService.findOrderById.mockRejectedValue(notFoundError);
      await expect(service.getHistory(999)).rejects.toThrow(notFoundError);
    });
  });

  describe('getVersionSnapshot', () => {
    it('version=2 스냅샷을 반환한다', async () => {
      const v2 = makeVersion({ version: 2 });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findUnique.mockResolvedValue(v2);

      const result = await service.getVersionSnapshot(1, 2);

      expect(mockPrisma.purchaseOrderVersion.findUnique).toHaveBeenCalledWith({
        where: { orderId_version: { orderId: 1, version: 2 } },
      });
      expect(result).toEqual(v2);
    });

    it('없는 버전 → 404 VERSION_NOT_FOUND', async () => {
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findUnique.mockResolvedValue(null);

      try {
        await service.getVersionSnapshot(1, 99);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('VERSION_NOT_FOUND');
      }
    });

    it('없는 발주서 → ORDER_NOT_FOUND 404 전파', async () => {
      const notFoundError = new HttpException({ code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' }, 404);
      mockOrdersService.findOrderById.mockRejectedValue(notFoundError);
      await expect(service.getVersionSnapshot(999, 1)).rejects.toThrow(notFoundError);
    });
  });

  describe('getSnapshotAtTimestamp', () => {
    it('시점 이전 최신 버전을 반환한다', async () => {
      const v1 = makeVersion({ version: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findFirst.mockResolvedValue(v1);

      const result = await service.getSnapshotAtTimestamp(1, '2025-06-01T00:00:00.000Z');

      expect(mockPrisma.purchaseOrderVersion.findFirst).toHaveBeenCalledWith({
        where: { orderId: 1, createdAt: { lte: new Date('2025-06-01T00:00:00.000Z') } },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(v1);
    });

    it('이전 버전 없음(findFirst→null) → 404 VERSION_NOT_FOUND', async () => {
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findFirst.mockResolvedValue(null);

      try {
        await service.getSnapshotAtTimestamp(1, '2020-01-01T00:00:00.000Z');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('VERSION_NOT_FOUND');
      }
    });

    it('없는 발주서 → ORDER_NOT_FOUND 404 전파', async () => {
      const notFoundError = new HttpException({ code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' }, 404);
      mockOrdersService.findOrderById.mockRejectedValue(notFoundError);
      await expect(service.getSnapshotAtTimestamp(999, '2025-06-01T00:00:00.000Z')).rejects.toThrow(notFoundError);
    });

    it('잘못된 timestamp 형식 → 400 INVALID_TIMESTAMP', async () => {
      try {
        await service.getSnapshotAtTimestamp(1, 'invalid-date');
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_TIMESTAMP');
      }
    });
  });

  describe('compareVersions', () => {
    it('v1 vs v3 — productName 다르면 diff에 해당 필드만 포함된다', async () => {
      const v1 = makeVersion({ version: 1, productName: '티셔츠' });
      const v3 = makeVersion({ version: 3, productName: '후드티' });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v3);

      const result = await service.compareVersions(1, 1, 3);

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].field).toBe('productName');
      expect(result.diff[0].before).toBe('티셔츠');
      expect(result.diff[0].after).toBe('후드티');
    });

    it('v1 vs v1 동일 버전 — diff: []이며 findOrderById가 두 번 호출된다 (Promise.all 병렬 처리)', async () => {
      const v1 = makeVersion({ version: 1 });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v1);

      const result = await service.compareVersions(1, 1, 1);

      expect(result.diff).toEqual([]);
      expect(mockOrdersService.findOrderById).toHaveBeenCalledTimes(2);
    });

    it('from > to → 400 INVALID_VERSION_RANGE이며 Prisma 쿼리는 호출되지 않는다', async () => {
      try {
        await service.compareVersions(1, 3, 1);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(400);
        expect((ex.getResponse() as any).code).toBe('INVALID_VERSION_RANGE');
      }
      expect(mockPrisma.purchaseOrderVersion.findUnique).not.toHaveBeenCalled();
    });

    it('없는 버전 포함 → 404 VERSION_NOT_FOUND', async () => {
      mockPrisma.purchaseOrderVersion.findUnique.mockResolvedValue(null);

      try {
        await service.compareVersions(1, 1, 99);
        fail('예외가 발생해야 합니다');
      } catch (ex) {
        expect(ex).toBeInstanceOf(HttpException);
        expect(ex.getStatus()).toBe(404);
        expect((ex.getResponse() as any).code).toBe('VERSION_NOT_FOUND');
      }
    });

    it('quantity 다르면 diff에 포함된다', async () => {
      const v1 = makeVersion({ version: 1, quantity: 100 });
      const v2 = makeVersion({ version: 2, quantity: 200 });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v2);

      const result = await service.compareVersions(1, 1, 2);

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].field).toBe('quantity');
      expect(result.diff[0].before).toBe(100);
      expect(result.diff[0].after).toBe(200);
    });

    it('unitPrice 다르면 diff에 포함된다 (Decimal 인스턴스)', async () => {
      const v1 = makeVersion({ version: 1, unitPrice: new Prisma.Decimal('15000.00') });
      const v2 = makeVersion({ version: 2, unitPrice: new Prisma.Decimal('20000.00') });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v2);

      const result = await service.compareVersions(1, 1, 2);

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].field).toBe('unitPrice');
      expect(result.diff[0].before).toEqual(new Prisma.Decimal('15000.00'));
      expect(result.diff[0].after).toEqual(new Prisma.Decimal('20000.00'));
    });

    it('specs 다르면 diff에 포함된다', async () => {
      const specsA = { color: '흰색', sizes: [{ size: 'M', quantity: 100 }] };
      const specsB = { color: '검정', sizes: [{ size: 'M', quantity: 100 }] };
      const v1 = makeVersion({ version: 1, specs: specsA });
      const v2 = makeVersion({ version: 2, specs: specsB });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v2);

      const result = await service.compareVersions(1, 1, 2);

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].field).toBe('specs');
      expect(result.diff[0].before).toEqual(specsA);
      expect(result.diff[0].after).toEqual(specsB);
    });

    it('COMPARE_FIELDS 5개 모두 다를 때 diff 길이가 5이다', async () => {
      const v1 = makeVersion({
        version: 1,
        productName: '티셔츠',
        quantity: 100,
        unitPrice: new Prisma.Decimal('15000.00'),
        specs: { color: '흰색', sizes: [{ size: 'M', quantity: 100 }] },
        deliveryDate: new Date('2025-03-15T00:00:00.000Z'),
      });
      const v2 = makeVersion({
        version: 2,
        productName: '후드티',
        quantity: 200,
        unitPrice: new Prisma.Decimal('25000.00'),
        specs: { color: '검정', sizes: [{ size: 'L', quantity: 200 }] },
        deliveryDate: new Date('2025-09-30T00:00:00.000Z'),
      });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v2);

      const result = await service.compareVersions(1, 1, 2);

      expect(result.diff).toHaveLength(5);
      const fields = result.diff.map((d) => d.field);
      expect(fields).toEqual(['productName', 'quantity', 'unitPrice', 'specs', 'deliveryDate']);
    });

    it('deliveryDate 다르면 diff에 포함된다 (ISO 문자열 직렬화)', async () => {
      const dateA = new Date('2025-03-15T00:00:00.000Z');
      const dateB = new Date('2025-06-30T00:00:00.000Z');
      const v1 = makeVersion({ version: 1, deliveryDate: dateA });
      const v2 = makeVersion({ version: 2, deliveryDate: dateB });
      mockPrisma.purchaseOrderVersion.findUnique
        .mockResolvedValueOnce(v1)
        .mockResolvedValueOnce(v2);

      const result = await service.compareVersions(1, 1, 2);

      expect(result.diff).toHaveLength(1);
      expect(result.diff[0].field).toBe('deliveryDate');
      expect(result.diff[0].before).toEqual(dateA);
      expect(result.diff[0].after).toEqual(dateB);
    });
  });

  describe('getStatusHistory', () => {
    it('상태 로그를 createdAt ASC 정렬로 반환한다', async () => {
      const log1 = makeStatusLog({ id: 1, createdAt: new Date('2025-01-01T00:00:00.000Z') });
      const log2 = makeStatusLog({ id: 2, fromStatus: 'CONFIRMED', toStatus: 'IN_PRODUCTION', createdAt: new Date('2025-02-01T00:00:00.000Z') });
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.orderStatusLog.findMany.mockResolvedValue([log1, log2]);

      const result = await service.getStatusHistory(1);

      expect(mockPrisma.orderStatusLog.findMany).toHaveBeenCalledWith({
        where: { orderId: 1 },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toHaveLength(2);
    });

    it('상태 로그 0건 → 빈 배열 반환', async () => {
      mockOrdersService.findOrderById.mockResolvedValue({ id: 1 });
      mockPrisma.orderStatusLog.findMany.mockResolvedValue([]);

      const result = await service.getStatusHistory(1);

      expect(result).toEqual([]);
    });

    it('없는 발주서 → ORDER_NOT_FOUND 404 전파', async () => {
      const notFoundError = new HttpException({ code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' }, 404);
      mockOrdersService.findOrderById.mockRejectedValue(notFoundError);

      await expect(service.getStatusHistory(999)).rejects.toThrow(notFoundError);
    });
  });
});
