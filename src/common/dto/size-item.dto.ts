import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class SizeItemDto {
  @IsString({ message: 'size는 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'size는 비어 있을 수 없습니다.' })
  size: string;

  @IsInt({ message: 'quantity는 정수여야 합니다.' })
  @Min(1, { message: 'quantity는 1 이상이어야 합니다.' })
  quantity: number;
}
