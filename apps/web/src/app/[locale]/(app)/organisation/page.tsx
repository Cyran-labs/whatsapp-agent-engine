import { redirect } from '@/i18n/routing';

export default async function OrganisationIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect({ href: '/organisation/entites', locale });
}
