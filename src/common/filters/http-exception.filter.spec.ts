import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function makeHost(
  jsonFn: jest.Mock,
  method = 'GET',
  url = '/test',
): ArgumentsHost {
  const response = {
    status: jest.fn().mockReturnThis(),
    json: jsonFn,
  };
  const request = { method, url };

  return {
    switchToHttp: jest.fn().mockReturnValue({
      getResponse: jest.fn().mockReturnValue(response),
      getRequest: jest.fn().mockReturnValue(request),
    }),
  } as unknown as ArgumentsHost;
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let jsonMock: jest.Mock;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    jsonMock = jest.fn();
  });

  it('ErrorCode 패턴 HttpException은 { success: false, error: { code, message } }로 응답한다', () => {
    const exception = new (require('@nestjs/common').HttpException)(
      { code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' },
      HttpStatus.NOT_FOUND,
    );
    const host = makeHost(jsonMock);

    filter.catch(exception, host);

    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: { code: 'ORDER_NOT_FOUND', message: '발주서를 찾을 수 없습니다.' },
    });
  });

  it('NestJS 내장 NotFoundException은 code가 NOT_FOUND로 응답한다', () => {
    const exception = new NotFoundException('해당 리소스를 찾을 수 없습니다.');
    const host = makeHost(jsonMock);

    filter.catch(exception, host);

    const call = jsonMock.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error.code).toBe('NOT_FOUND');
    expect(typeof call.error.message).toBe('string');
    expect(call.error.message.length).toBeGreaterThan(0);
  });

  it('ValidationPipe BadRequestException의 message 배열은 join되어 응답한다', () => {
    const exception = new BadRequestException({
      message: [
        'quantity must be an integer',
        'productName should not be empty',
      ],
      error: 'Bad Request',
      statusCode: 400,
    });
    const host = makeHost(jsonMock);

    filter.catch(exception, host);

    const call = jsonMock.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error.message).toBe(
      'quantity must be an integer, productName should not be empty',
    );
  });

  it('비-HTTP 예외(TypeError)는 500 INTERNAL_SERVER_ERROR 고정 메시지로 응답한다', () => {
    const exception = new TypeError('something went wrong');
    const host = makeHost(jsonMock);

    filter.catch(exception, host);

    expect(jsonMock).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: '서버 내부 오류가 발생했습니다.',
      },
    });
  });

  it('일반 Error 객체도 500으로 처리된다', () => {
    const exception = new Error('unexpected');
    const host = makeHost(jsonMock);

    filter.catch(exception, host);

    const call = jsonMock.mock.calls[0][0];
    expect(call.success).toBe(false);
    expect(call.error.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
