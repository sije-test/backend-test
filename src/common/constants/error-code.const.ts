import { HttpStatus } from '@nestjs/common';

export const ErrorCode = {
  ORDER_NOT_FOUND:                { status: HttpStatus.NOT_FOUND, message: '발주서를 찾을 수 없습니다.' },
  VERSION_NOT_FOUND:              { status: HttpStatus.NOT_FOUND, message: '해당 버전을 찾을 수 없습니다.' },
  CHANGE_REQUEST_NOT_FOUND:       { status: HttpStatus.NOT_FOUND, message: '변경요청을 찾을 수 없습니다.' },
  FORBIDDEN_ROLE:                 { status: HttpStatus.FORBIDDEN, message: '해당 작업에 대한 권한이 없습니다.' },
  NOT_ORDER_OWNER:                { status: HttpStatus.FORBIDDEN, message: '본인이 생성한 발주서에만 변경요청을 생성할 수 있습니다.' },
  INVALID_STATUS_TRANSITION:      { status: HttpStatus.BAD_REQUEST, message: '현재 상태에서 허용되지 않는 상태 전이입니다.' },
  ORDER_NOT_CONFIRMED:            { status: HttpStatus.BAD_REQUEST, message: '확정된 발주서에만 변경요청을 생성할 수 있습니다.' },
  CHANGE_REQUEST_ALREADY_PENDING: { status: HttpStatus.CONFLICT, message: '이미 처리 중인 변경요청이 있습니다.' },
  CHANGE_REQUEST_NOT_PENDING:     { status: HttpStatus.BAD_REQUEST, message: 'PENDING 상태의 변경요청만 승인/반려할 수 있습니다.' },
  CHANGES_REQUIRED:               { status: HttpStatus.BAD_REQUEST, message: '변경 항목이 1개 이상 필요합니다.' },
  INVALID_TIMESTAMP:              { status: HttpStatus.BAD_REQUEST, message: '유효하지 않은 timestamp 형식입니다.' },
  MISSING_ROLE_HEADER:            { status: HttpStatus.BAD_REQUEST, message: 'X-User-Role 헤더가 필요합니다.' },
  INVALID_ROLE:                   { status: HttpStatus.BAD_REQUEST, message: '유효하지 않은 역할 값입니다.' },
  INVALID_SPECS_QUANTITY:         { status: HttpStatus.BAD_REQUEST, message: 'specs.sizes 수량 합계가 총 수량과 일치하지 않습니다.' },
} as const;

export type ErrorCodeKey = keyof typeof ErrorCode;
