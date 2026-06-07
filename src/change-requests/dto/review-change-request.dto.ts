import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ReviewChangeRequestDto {
  @ApiPropertyOptional({ example: '납기일 변경 승인합니다.', description: '검토 의견' })
  @IsOptional()
  @IsString({ message: 'reviewComment는 문자열이어야 합니다.' })
  reviewComment?: string;
}
