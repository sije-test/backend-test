import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../constants/error-code.const';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

function makeContext(
  requiredRoles: Role[] | undefined,
  headers: Record<string, string | string[]>,
): ExecutionContext {
  const mockReflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;

  const mockRequest = { headers } as any;

  const ctx = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: jest.fn().mockReturnValue(mockRequest),
    }),
  } as unknown as ExecutionContext;

  return { ctx, reflector: mockReflector, request: mockRequest } as any;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: jest.Mocked<Reflector>;

  function buildGuardAndContext(
    requiredRoles: Role[] | undefined,
    headers: Record<string, string | string[]>,
  ) {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as jest.Mocked<Reflector>;

    guard = new RolesGuard(reflector);

    const mockRequest: Record<string, any> = { headers };

    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: jest.fn().mockReturnValue({
        getRequest: jest.fn().mockReturnValue(mockRequest),
      }),
    } as unknown as ExecutionContext;

    return { ctx, request: mockRequest };
  }

  it('@Roles() 데코레이터가 없는 핸들러는 true를 반환한다', () => {
    const { ctx } = buildGuardAndContext(undefined, {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('@Roles()가 빈 배열인 핸들러도 true를 반환한다', () => {
    const { ctx } = buildGuardAndContext([], {});
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('X-User-Role 헤더가 없으면 MISSING_ROLE_HEADER 400 예외를 던진다', () => {
    const { ctx } = buildGuardAndContext([Role.BUYER], {});

    expect(() => guard.canActivate(ctx)).toThrow(HttpException);

    try {
      guard.canActivate(ctx);
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((ex.getResponse() as any).code).toBe('MISSING_ROLE_HEADER');
      expect((ex.getResponse() as any).message).toBe(
        ErrorCode.MISSING_ROLE_HEADER.message,
      );
    }
  });

  it('X-User-Role 헤더가 정의되지 않은 역할(ADMIN)이면 INVALID_ROLE 400 예외를 던진다', () => {
    const { ctx } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': 'ADMIN',
    });

    try {
      guard.canActivate(ctx);
      fail('예외가 던져져야 합니다');
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((ex.getResponse() as any).code).toBe('INVALID_ROLE');
      expect((ex.getResponse() as any).message).toBe(
        ErrorCode.INVALID_ROLE.message,
      );
    }
  });

  it('유효한 역할이지만 필요한 역할과 불일치하면 FORBIDDEN_ROLE 403 예외를 던진다', () => {
    const { ctx } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': Role.SOURCING,
    });

    try {
      guard.canActivate(ctx);
      fail('예외가 던져져야 합니다');
    } catch (e) {
      const ex = e as HttpException;
      expect(ex.getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect((ex.getResponse() as any).code).toBe('FORBIDDEN_ROLE');
      expect((ex.getResponse() as any).message).toBe(
        ErrorCode.FORBIDDEN_ROLE.message,
      );
    }
  });

  it('X-User-Role이 BUYER이고 @Roles(BUYER)이면 true를 반환한다', () => {
    const { ctx } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': Role.BUYER,
    });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('X-User-Id 헤더가 있으면 request.userId에 해당 값이 주입된다', () => {
    const { ctx, request } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': Role.BUYER,
      'x-user-id': 'user-123',
    });

    guard.canActivate(ctx);

    expect(request.userId).toBe('user-123');
  });

  it('X-User-Id 헤더가 없으면 request.userId는 null이다', () => {
    const { ctx, request } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': Role.BUYER,
    });

    guard.canActivate(ctx);

    expect(request.userId).toBeNull();
  });

  it('X-User-Id가 배열이면 첫 번째 값이 request.userId에 주입된다', () => {
    const { ctx, request } = buildGuardAndContext([Role.BUYER], {
      'x-user-role': Role.BUYER,
      'x-user-id': ['user-abc', 'user-xyz'],
    });

    guard.canActivate(ctx);

    expect(request.userId).toBe('user-abc');
  });
});
