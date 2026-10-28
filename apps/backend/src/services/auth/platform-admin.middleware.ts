import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';

@Injectable()
export class PlatformAdminMiddleware implements NestMiddleware {
  constructor(private readonly users: UsersService) {}
  async use(req: Request, _res: Response, next: NextFunction) {
    let id: string;
    try {
      id = (
        AuthService.verifyJWT(req.headers.auth || req.cookies?.auth) as {
          id: string;
        }
      )?.id;
    } catch {
      throw new HttpForbiddenException();
    }
    if (!id) throw new HttpForbiddenException();
    const user = await this.users.getUserById(id);
    if (!user?.activated || user.disabledAt) throw new HttpForbiddenException();
    // Always authorize the original authenticated user. Tenant impersonation is ignored here.
    if (!user.isPlatformAdmin) {
      throw new ForbiddenException(
        'Acesso exclusivo do administrador global.'
      );
    }
    delete user.password;
    Object.assign(req, { user });
    next();
  }
}
