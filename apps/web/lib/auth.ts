import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import AzureADProvider from 'next-auth/providers/azure-ad';

const API_URL = process.env.API_URL || 'http://localhost:3001';

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const res = await fetch(`${API_URL}/api/v1/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: credentials?.email,
              password: credentials?.password,
            }),
          });

          const data = await res.json();
          if (!res.ok) return null;

          // Handle 2FA — return partial state
          if (data.requires2fa) {
            return { id: 'pending-2fa', tempToken: data.tempToken, requires2fa: true } as any;
          }

          return {
            id: data.user?.id,
            accessToken: data.accessToken,
            refreshToken: data.refreshToken,
          } as any;
        } catch {
          return null;
        }
      },
    }),

    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),

    AzureADProvider({
      clientId: process.env.MICROSOFT_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
      tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    }),
  ],

  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.accessToken = (user as any).accessToken;
        token.refreshToken = (user as any).refreshToken;
        token.requires2fa = (user as any).requires2fa;
        token.tempToken = (user as any).tempToken;
      }

      // OAuth providers: exchange for API JWT
      if (account && (account.provider === 'google' || account.provider === 'azure-ad')) {
        try {
          const provider = account.provider === 'azure-ad' ? 'microsoft' : 'google';
          const res = await fetch(`${API_URL}/api/v1/auth/${provider}/callback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: account.access_token }),
          });
          const data = await res.json();
          if (res.ok) {
            token.accessToken = data.accessToken;
            token.refreshToken = data.refreshToken;
          }
        } catch {
          // OAuth exchange failed
        }
      }

      return token;
    },

    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.refreshToken = token.refreshToken as string;
      session.requires2fa = token.requires2fa as boolean;
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
  },

  session: {
    strategy: 'jwt',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  },

  secret: process.env.NEXTAUTH_SECRET,
};
