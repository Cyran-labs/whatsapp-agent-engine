import { InvitationFlow } from '@/components/auth/invitation-flow';

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <InvitationFlow token={token ?? ''} />;
}
