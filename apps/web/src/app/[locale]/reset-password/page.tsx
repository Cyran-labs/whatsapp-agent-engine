import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/reset-password-form';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; invite?: string }>;
}) {
  const { token, invite } = await searchParams;
  return (
    <AuthCard>
      <ResetPasswordForm token={token ?? ''} invite={invite} />
    </AuthCard>
  );
}
