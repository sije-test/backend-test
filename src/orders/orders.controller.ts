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
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiHeader({ name: 'X-User-Role', required: true })
@ApiHeader({ name: 'X-User-Id', required: true })
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @HttpCode(201)
  @Roles(Role.BUYER)
  @ApiOperation({ summary: '발주서 생성' })
  @ApiResponse({ status: 201, description: '생성 성공' })
  @ApiResponse({ status: 400, description: '입력값 오류' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  create(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(dto);
  }

  @Get(':id')
  @Roles(Role.BUYER, Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '발주서 단건 조회' })
  @ApiResponse({ status: 200, description: '조회 성공' })
  @ApiResponse({ status: 404, description: '발주서 없음' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.ordersService.findOrderById(id);
  }

  @Patch(':id/confirm')
  @Roles(Role.SOURCING)
  @ApiOperation({ summary: '발주서 확정' })
  @ApiResponse({ status: 200, description: '확정 성공' })
  @ApiResponse({ status: 400, description: '상태 전이 불가' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  confirm(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.ordersService.confirmOrder(id, req.userId ?? '');
  }

  @Patch(':id/start-production')
  @Roles(Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '발주서 생산 시작 (CONFIRMED → IN_PRODUCTION)' })
  @ApiResponse({ status: 200, description: '생산 시작 성공' })
  @ApiResponse({ status: 400, description: '상태 전이 불가' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  startProduction(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.ordersService.startProduction(id, req.userId ?? '');
  }

  @Patch(':id/complete')
  @Roles(Role.SOURCING, Role.MANUFACTURER)
  @ApiOperation({ summary: '발주서 완료 (IN_PRODUCTION → COMPLETED)' })
  @ApiResponse({ status: 200, description: '완료 성공' })
  @ApiResponse({ status: 400, description: '상태 전이 불가' })
  @ApiResponse({ status: 403, description: '권한 없음' })
  complete(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.ordersService.completeOrder(id, req.userId ?? '');
  }
}
