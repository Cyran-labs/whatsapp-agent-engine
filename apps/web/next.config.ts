import type { NextConfig } from 'next';

// NOTE(Task 2): Le plugin next-intl (createNextIntlPlugin) est intentionnellement
// absent ici. Il sera rebranché en Task 4 avec le fichier src/i18n/request.ts.
// Sans ce fichier, le build échouerait à cette étape.
const nextConfig: NextConfig = {
  transpilePackages: ['@wabagent/contracts'],
};

export default nextConfig;
