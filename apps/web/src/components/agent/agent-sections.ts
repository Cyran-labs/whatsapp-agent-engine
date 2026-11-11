export interface AgentSection {
  key: string;
  i18n: string;
  href: string | null;
  icon: string;
  soon: boolean;
  /** Section réservée à l'admin : absente de la colonne des autres membres (coûts, spec 9.1). */
  adminOnly?: boolean;
}

// href relatif au segment /agents/[botId] ; null => non navigable
export const AGENT_SECTIONS: AgentSection[] = [
  { key: 'overview', i18n: 'overview', href: '', icon: '▤', soon: false },
  { key: 'conversations', i18n: 'conversations', href: null, icon: '💬', soon: true },
  { key: 'personality', i18n: 'personality', href: null, icon: '✦', soon: true },
  { key: 'crm', i18n: 'crm', href: null, icon: '🔗', soon: true },
  { key: 'usage', i18n: 'usage', href: 'usage', icon: '▦', soon: false, adminOnly: true },
  { key: 'settings', i18n: 'settings', href: null, icon: '⚙', soon: true },
];
