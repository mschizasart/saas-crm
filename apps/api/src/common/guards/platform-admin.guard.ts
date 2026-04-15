import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const auth = req.headers?.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7);
    try {
      const payload: any = this.jwt.verify(token);
      if (payload.aud !== 'platform' || payload.type !== 'platform_admin') {
        throw new UnauthorizedException('Not a platform admin token');
      }
      req.platformAdmin = payload;
      return true;
    } catch (e) {
      throw new UnauthorizedException('Invalid platform admin token');
    }
  }
}
