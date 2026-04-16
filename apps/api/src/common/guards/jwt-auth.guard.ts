import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private apiKeys: ApiKeysService,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Try JWT first
    try {
      const jwtResult = await (super.canActivate(context) as Promise<boolean>);
      if (jwtResult) return true;
    } catch {
      // JWT failed — fall through to API key check
    }

    // Try API key
    const req = context.switchToHttp().getRequest();
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      const result = await this.apiKeys.validate(apiKey);
      if (result) {
        req.user = {
          orgId: result.orgId,
          organizationId: result.orgId,
          type: 'api_key',
          isAdmin: true,
          apiKeyId: result.keyId,
        };
        return true;
      }
    }

    throw new UnauthorizedException();
  }

  handleRequest(err: any, user: any) {
    if (err || !user) throw err || new UnauthorizedException();
    return user;
  }
}
