import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { ChangesDto } from '../../common/dto/changes.dto';

export class CreateChangeRequestDto {
  @ApiProperty({ example: '납기일 변경 요청합니다.', description: '변경 요청 사유' })
  @IsString({ message: 'reason은 문자열이어야 합니다.' })
  @IsNotEmpty({ message: 'reason은 비어 있을 수 없습니다.' })
  reason: string;

  @ApiProperty({ type: () => ChangesDto, description: '변경 내용' })
  @ValidateNested()
  @Type(() => ChangesDto)
  changes: ChangesDto;
}
