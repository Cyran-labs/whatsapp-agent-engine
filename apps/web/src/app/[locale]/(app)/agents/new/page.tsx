import { TopBar } from '@/components/shell/top-bar';
import { Wizard } from '@/components/wizard/wizard';

export default function NewAgentPage() {
  return (
    <>
      <TopBar active="agents" />
      <main><Wizard /></main>
    </>
  );
}
