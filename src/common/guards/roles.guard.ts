import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ErrorCode } from '../constants/error-code.const';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const roleHeader = request.headers['x-user-role'];

    if (!roleHeader) {
      throw new HttpException(
        {
          code: 'MISSING_ROLE_HEADER',
          message: ErrorCode.MISSING_ROLE_HEADER.message,
        },
        ErrorCode.MISSING_ROLE_HEADER.status,
      );
    }

    const rawRole = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;

    if (!Object.values(Role).includes(rawRole as Role)) {
      throw new HttpException(
        {
          code: 'INVALID_ROLE',
          message: ErrorCode.INVALID_ROLE.message,
        },
        ErrorCode.INVALID_ROLE.status,
      );
    }

    const role = rawRole as Role;

    if (!requiredRoles.includes(role)) {
      throw new HttpException(
        {
          code: 'FORBIDDEN_ROLE',
          message: ErrorCode.FORBIDDEN_ROLE.message,
        },
        ErrorCode.FORBIDDEN_ROLE.status,
      );
    }

    const userIdHeader = request.headers['x-user-id'];
    request.userId = Array.isArray(userIdHeader)
      ? userIdHeader[0]
      : (userIdHeader ?? null);

    return true;
  }
}
