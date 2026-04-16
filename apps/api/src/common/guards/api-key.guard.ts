import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ApiKeysService } from '../../modules/api-keys/api-keys.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key) return false;

    const result = await this.apiKeys.validate(key);
    if (!result) return false;

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
