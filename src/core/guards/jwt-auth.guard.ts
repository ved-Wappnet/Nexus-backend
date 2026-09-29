import { IS_PUBLIC_KEY } from '@core/constants';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      const request = context.switchToHttp().getRequest();
      const authHeader = request?.headers?.['authorization'];
      if (authHeader) {
        try {
          await (super.canActivate(context) as any);
        } catch {
          // Public endpoint: proceed unauthenticated if token is invalid or expired
        }
      }
      return true;
    }
    return (super.canActivate(context) as any);
  }

  override handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return (user || undefined) as TUser;
    }
    return super.handleRequest(err, user, info, context, status);
  }
}
