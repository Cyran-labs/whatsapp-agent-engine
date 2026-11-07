import { SessionProvider } from '@/components/providers/session-provider';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex h-screen flex-col bg-bg">{children}</div>
    </SessionProvider>
  );
}
