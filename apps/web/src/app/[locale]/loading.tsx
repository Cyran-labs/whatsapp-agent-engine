import { PageLoader } from '@/components/ui/page-loader';

/** Transition de route d'une page hors application (connexion, invitation...) : rien à montrer encore. */
export default function Loading() {
  return <PageLoader fullScreen />;
}
