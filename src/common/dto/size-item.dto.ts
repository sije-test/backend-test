import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

export class SizeItemDto {
  @IsString()
  @IsNotEmpty()
  size: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
