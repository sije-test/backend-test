import { HttpException } from '@nestjs/common';
import { SpecsDto } from '../dto/specs.dto';
import { ErrorCode } from '../constants/error-code.const';

export function validateSpecsQuantity(specs: SpecsDto, quantity: number): void {
  const total = specs.sizes.reduce((sum, item) => sum + item.quantity, 0);
  if (total !== quantity) {
    throw new HttpException(
      { code: 'INVALID_SPECS_QUANTITY', message: ErrorCode.INVALID_SPECS_QUANTITY.message },
      ErrorCode.INVALID_SPECS_QUANTITY.status,
    );
  }
}
