import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { SizeItemDto } from './size-item.dto';

export class SpecsDto {
  @IsString()
  @IsNotEmpty()
  color: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SizeItemDto)
  sizes: SizeItemDto[];
}
