import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { ChangeRequestsService } from './change-requests.service';
import { CreateChangeRequestDto } from './dto/create-change-request.dto';
import { ReviewChangeRequestDto } from './dto/review-change-request.dto';

@ApiTags('change-requests')
@ApiHeader({ name: 'X-User-Role', required: true })
@ApiHeader({ name: 'X-User-Id', required: true })
@Controller('orders')
export class ChangeRequestsController {
  constructor(private readonly changeRequestsService: ChangeRequestsService) {}

  @Post(':id/change-requests')
  @HttpCode(201)
  @Roles(Role.BUYER)
  @ApiOperation({ summary: '변경요청 생성' })
  @ApiResponse({ status: 201, description: '생성 성공' })
  @ApiResponse({ status: 400, description: '입력값 오류' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '발주서 없음' })
  create(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateChangeRequestDto,
    @Req() req: Request,
  ) {
    return this.changeRequestsService.createChangeRequest(
      id,
      dto,
      req.userId ?? '',
    );
  }

  @Get(':id/change-requests')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '변경요청 목록 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '발주서 없음' })
  findAll(@Param('id', ParseIntPipe) id: number) {
    return this.changeRequestsService.findChangeRequestsByOrderId(id);
  }

  @Patch(':id/change-requests/:requestId/approve')
  @Roles(Role.SOURCING)
  @ApiOperation({ summary: '변경요청 승인' })
  @ApiResponse({ status: 200, description: '승인 성공' })
  @ApiResponse({ status: 400, description: '상태 전이 불가' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '변경요청 없음' })
  approve(
    @Param('id', ParseIntPipe) id: number,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() dto: ReviewChangeRequestDto,
    @Req() req: Request,
  ) {
    return this.changeRequestsService.approveChangeRequest(
      id,
      requestId,
      dto,
      req.userId ?? '',
    );
  }

  @Patch(':id/change-requests/:requestId/reject')
  @Roles(Role.SOURCING)
  @ApiOperation({ summary: '변경요청 반려' })
  @ApiResponse({ status: 200, description: '반려 성공' })
  @ApiResponse({ status: 400, description: '상태 전이 불가' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  @ApiResponse({ status: 404, description: '변경요청 없음' })
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Param('requestId', ParseIntPipe) requestId: number,
    @Body() dto: ReviewChangeRequestDto,
    @Req() req: Request,
  ) {
    return this.changeRequestsService.rejectChangeRequest(
      id,
      requestId,
      dto,
      req.userId ?? '',
    );
  }
}
