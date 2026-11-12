import type { ParentCrumb } from '@/components/shell/page-header';
import type { AgentInfo } from './agent-context';

/**
 * Ligne des parents d'une page d'un agent IA (spec en-tête 2.2, 7.4 ; C-5, C-6) : « Agents IA » (lien vers la liste),
 * puis l'entité de l'agent IA (lien vers la liste filtrée sur elle), puis `extra` (le nom de l'agent IA, pour une page
 * sous la sienne). Agent IA ou entités en lecture : squelette à la place de l'entité. Agent IA sans entité, entités
 * illisibles, ou entité absente des entités lues : « Agents IA » seul, jamais un nom qui ne vient pas de l'organisation
 * ouverte. `agentsLabel` : le libellé traduit de « Agents IA ».
 */
export function agentParents(info: AgentInfo | null, agentsLabel: string, extra?: ParentCrumb): ParentCrumb[] {
  const agents: ParentCrumb = { label: agentsLabel, href: '/' };
  const entity: ParentCrumb[] =
    info === null || (info.entity_id !== null && info.entities === 'loading')
      ? [{ label: null, href: '/' }]
      : info.entity_id !== null && info.entities === 'ready' && info.entity_name !== null
        ? [{ label: info.entity_name, href: `/?entity=${info.entity_id}` }]
        : [];
  return [agents, ...entity, ...(extra ? [extra] : [])];
}
