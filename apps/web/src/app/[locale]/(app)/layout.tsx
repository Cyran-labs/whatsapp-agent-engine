import { SessionProvider } from '@/components/providers/session-provider';
import { OrgNoticeBanner } from '@/components/shell/org-notice-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex h-screen flex-col bg-bg">
        <OrgNoticeBanner />
        {children}
      </div>
    </SessionProvider>
  );
}
