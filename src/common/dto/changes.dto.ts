import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AtLeastOneField } from '../validators/at-least-one-field.validator';
import { SpecsDto } from './specs.dto';

@AtLeastOneField()
export class ChangesDto {
  @IsOptional()
  @IsInt({ message: 'quantity는 정수여야 합니다.' })
  @Min(1, { message: 'quantity는 1 이상이어야 합니다.' })
  quantity?: number;

  @IsOptional()
  @IsString({ message: 'productName은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'productName은 비어 있을 수 없습니다.' })
  productName?: string;

  @IsOptional()
  @IsNumber({}, { message: 'unitPrice는 숫자여야 합니다.' })
  @Min(0, { message: 'unitPrice는 0 이상이어야 합니다.' })
  unitPrice?: number;

  @IsOptional()
  @IsDateString(
    {},
    { message: 'deliveryDate는 ISO 8601 날짜 형식이어야 합니다.' },
  )
  deliveryDate?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SpecsDto)
  specs?: SpecsDto;
}
