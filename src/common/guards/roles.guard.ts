import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { businessError } from '../exceptions/business.exception';
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
      businessError('MISSING_ROLE_HEADER');
    }

    const rawRole = Array.isArray(roleHeader) ? roleHeader[0] : roleHeader;

    if (!Object.values(Role).includes(rawRole as Role)) {
      businessError('INVALID_ROLE');
    }

    const role = rawRole as Role;

    if (!requiredRoles.includes(role)) {
      businessError('FORBIDDEN_ROLE');
    }

    const userIdHeader = request.headers['x-user-id'];
    request.userId = Array.isArray(userIdHeader)
      ? userIdHeader[0]
      : (userIdHeader ?? null);

    return true;
  }
}
