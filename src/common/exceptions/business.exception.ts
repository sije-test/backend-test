import { HttpException } from '@nestjs/common';
import { ErrorCode, ErrorCodeKey } from '../constants/error-code.const';

export function businessError(code: ErrorCodeKey): never {
  throw new HttpException(
    { code, message: ErrorCode[code].message },
    ErrorCode[code].status,
  );
}
