import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@wabagent/contracts'],
  // Filet de sécurité : les réponses du BFF portent des données d'utilisateur, jamais mises en cache (les routes posent
  // déjà l'en-tête par `lib/api-json`).
  async headers() {
    return [{ source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] }];
  },
  webpack(config) {
    // Allow webpack to resolve .js imports as .ts when transpiling ESM packages
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
