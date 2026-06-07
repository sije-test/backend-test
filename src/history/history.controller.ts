import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { HistoryService } from './history.service';

@ApiTags('history')
@ApiHeader({ name: 'X-User-Role', required: true })
@ApiHeader({ name: 'X-User-Id', required: true })
@Controller('orders')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get(':id/history')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '발주서 전체 버전 이력 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '발주서 없음' })
  getHistory(@Param('id', ParseIntPipe) id: number) {
    return this.historyService.getHistory(id);
  }

  @Get(':id/versions/:version')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '특정 버전 스냅샷 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '버전 없음' })
  getVersion(
    @Param('id', ParseIntPipe) id: number,
    @Param('version', ParseIntPipe) version: number,
  ) {
    return this.historyService.getVersionSnapshot(id, version);
  }

  @Get(':id/at')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '특정 시점의 스냅샷 조회' })
  @ApiQuery({
    name: 'timestamp',
    required: true,
    description: '조회 기준 시점 (ISO 8601)',
  })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 400, description: '잘못된 timestamp 형식' })
  @ApiResponse({ status: 404, description: '해당 시점 이전 버전 없음' })
  getAt(
    @Param('id', ParseIntPipe) id: number,
    @Query('timestamp') timestamp: string,
  ) {
    return this.historyService.getSnapshotAtTimestamp(id, timestamp);
  }

  @Get(':id/compare')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '두 버전 간 변경사항 비교' })
  @ApiQuery({ name: 'from', required: true, description: '비교 시작 버전' })
  @ApiQuery({ name: 'to', required: true, description: '비교 종료 버전' })
  @ApiResponse({ status: 200, description: '비교 성공' })
  @ApiResponse({ status: 400, description: '잘못된 버전 번호' })
  @ApiResponse({ status: 404, description: '버전 없음' })
  compare(
    @Param('id', ParseIntPipe) id: number,
    @Query('from', ParseIntPipe) from: number,
    @Query('to', ParseIntPipe) to: number,
  ) {
    return this.historyService.compareVersions(id, from, to);
  }

  @Get(':id/status-history')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '발주서 상태 전이 이력 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '발주서 없음' })
  getStatusHistory(@Param('id', ParseIntPipe) id: number) {
    return this.historyService.getStatusHistory(id);
  }
}
