import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { SizeItemDto } from './size-item.dto';

export class SpecsDto {
  @IsString({ message: 'color는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'color는 비어 있을 수 없습니다.' })
  color: string;

  @IsArray({ message: 'sizes는 배열이어야 합니다.' })
  @ArrayMinSize(1, { message: 'sizes에 최소 1개 이상의 항목이 필요합니다.' })
  @ValidateNested({ each: true })
  @Type(() => SizeItemDto)
  sizes: SizeItemDto[];
}
