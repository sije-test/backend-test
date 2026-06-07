import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 발주서의 전체 버전 목록을 생성일 오름차순으로 반환한다. */
  findVersionsByOrder(orderId: number) {
    return this.prisma.purchaseOrderVersion.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** 특정 버전 스냅샷을 반환한다. 없으면 null. */
  findVersion(orderId: number, version: number) {
    return this.prisma.purchaseOrderVersion.findUnique({
      where: { orderId_version: { orderId, version } },
    });
  }

  /** 주어진 시점 이전의 가장 최신 스냅샷을 반환한다. 없으면 null. */
  findLatestVersionBefore(orderId: number, date: Date) {
    return this.prisma.purchaseOrderVersion.findFirst({
      where: { orderId, createdAt: { lte: date } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 발주서의 상태 전이 이력을 생성일 오름차순으로 반환한다. */
  findStatusLogsByOrder(orderId: number) {
    return this.prisma.orderStatusLog.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
