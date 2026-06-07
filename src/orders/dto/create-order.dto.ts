import { IsString, IsNotEmpty, IsInt, Min, IsNumber, IsDateString, IsOptional, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { SpecsDto } from '../../common/dto/specs.dto';
import { PurchaseOrderStatus } from '../../common/enums/purchase-order-status.enum';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0)
  unitPrice: number;

  @ValidateNested()
  @Type(() => SpecsDto)
  specs: SpecsDto;

  @IsDateString()
  deliveryDate: string;

  @IsString()
  @IsNotEmpty()
  buyerId: string;

  // 생성 시점에는 DRAFT(임시저장) 또는 PENDING(소싱팀 검토 요청)만 허용
  @IsOptional()
  @IsIn([PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.PENDING])
  status?: PurchaseOrderStatus;
}
