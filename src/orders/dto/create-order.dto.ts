import { IsString, IsNotEmpty, IsInt, Min, IsNumber, IsDateString, IsOptional, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SpecsDto } from '../../common/dto/specs.dto';
import { PurchaseOrderStatus } from '../../common/enums/purchase-order-status.enum';

export class CreateOrderDto {
  @ApiProperty({ example: '반팔 티셔츠 A형', description: '상품명' })
  @IsString({ message: 'productName은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'productName은 비어 있을 수 없습니다.' })
  productName: string;

  @ApiProperty({ example: 100, description: '총 수량' })
  @IsInt({ message: 'quantity는 정수여야 합니다.' })
  @Min(1, { message: 'quantity는 1 이상이어야 합니다.' })
  quantity: number;

  @ApiProperty({ example: 5000, description: '단가 (원)' })
  @IsNumber({}, { message: 'unitPrice는 숫자여야 합니다.' })
  @Min(0, { message: 'unitPrice는 0 이상이어야 합니다.' })
  unitPrice: number;

  @ApiProperty({ type: () => SpecsDto, description: '색상/사이즈 스펙' })
  @ValidateNested()
  @Type(() => SpecsDto)
  specs: SpecsDto;

  @ApiProperty({ example: '2025-12-01', description: '납기일 (ISO 8601 날짜)' })
  @IsDateString({}, { message: 'deliveryDate는 ISO 8601 날짜 형식이어야 합니다.' })
  deliveryDate: string;

  @ApiProperty({ example: 'buyer-uuid-1234', description: '발주자 사용자 ID' })
  @IsString({ message: 'buyerId는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'buyerId는 비어 있을 수 없습니다.' })
  buyerId: string;

  @ApiPropertyOptional({ enum: PurchaseOrderStatus, default: PurchaseOrderStatus.DRAFT, description: '초기 상태' })
  @IsOptional()
  @IsIn([PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING], { message: `status는 ${PurchaseOrderStatus.DRAFT} 또는 ${PurchaseOrderStatus.PENDING}만 허용됩니다.` })
  status?: PurchaseOrderStatus;
}
