import { Actor } from '@core/interfaces';
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): Actor => {
  return ctx.switchToHttp().getRequest().user as Actor;
});

export const User = CurrentUser;
