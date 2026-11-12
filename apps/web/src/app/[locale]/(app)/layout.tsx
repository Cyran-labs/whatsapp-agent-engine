import { NotificationProvider } from '@/components/feedback/notification-provider';
import { SessionProvider } from '@/components/providers/session-provider';
import { NavigationGuardProvider } from '@/components/shell/navigation-guard';
import { OrgNoticeBanner } from '@/components/shell/org-notice-banner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    // Au-dessus de la session : son rechargement forcé (organisation changée) lève la garde de sortie de l'assistant.
    <NavigationGuardProvider>
      <SessionProvider>
        {/* Au-dessus des pages : une notification survit à une navigation ; sous la session : elle lit l'organisation affichée. */}
        <NotificationProvider>
          <div className="flex h-screen flex-col bg-bg">
            <OrgNoticeBanner />
            {children}
          </div>
        </NotificationProvider>
      </SessionProvider>
    </NavigationGuardProvider>
  );
}
