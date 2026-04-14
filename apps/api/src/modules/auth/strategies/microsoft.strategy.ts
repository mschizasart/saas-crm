import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-microsoft';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MicrosoftStrategy extends PassportStrategy(
  Strategy,
  'microsoft',
) {
  constructor(config: ConfigService) {
    super({
      clientID: config.get('MICROSOFT_CLIENT_ID') || 'disabled',
      clientSecret: config.get('MICROSOFT_CLIENT_SECRET') || 'disabled',
      callbackURL: `${config.get('API_URL')}/api/v1/auth/microsoft/callback`,
      tenant: config.get('MICROSOFT_TENANT_ID', 'common'),
      scope: ['user.read'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: Function,
  ) {
    done(null, {
      provider: 'microsoft',
      providerId: profile.id,
      email: profile.emails?.[0]?.value,
      firstName: profile.name?.givenName,
      lastName: profile.name?.familyName,
    });
  }
}
