import { NotificationProvider } from '@/components/feedback/notification-provider';
import { SessionProvider } from '@/components/providers/session-provider';
import { OrgNoticeBanner } from '@/components/shell/org-notice-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {/* Au-dessus des pages : une notification survit à une navigation ; sous la session : elle lit l'organisation affichée. */}
      <NotificationProvider>
        <div className="flex h-screen flex-col bg-bg">
          <OrgNoticeBanner />
          {children}
        </div>
      </NotificationProvider>
    </SessionProvider>
  );
}
