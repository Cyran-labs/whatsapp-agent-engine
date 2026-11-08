import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { Rail, type RailGroup } from '../rail';
import { PageShell } from '../page-shell';

const groups: RailGroup[] = [
  {
    items: [
      { key: 'all', label: 'Tous les agents IA', href: '/agents', count: 7 },
      { key: 'soon', label: 'Bientôt', href: null, soon: true },
    ],
  },
  {
    label: 'Statut',
    items: [
      { key: 'active', label: 'Actifs', href: '/agents?status=active', dot: 'success' },
      { key: 'paused', label: 'En pause', href: '/agents?status=paused', dot: 'warning' },
      { key: 'draft', label: 'Brouillons', href: '/agents?status=draft', dot: 'neutral' },
    ],
  },
];

const wrap = (activeKey: string, header?: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Rail kicker="Agents IA" title="Acme" header={header} groups={groups} activeKey={activeKey} />
    </NextIntlClientProvider>,
  );

test('en-tête et groupes rendus avec leurs libellés', () => {
  wrap('all', <span>sous le titre</span>);
  expect(screen.getByText('Agents IA')).toBeInTheDocument();
  expect(screen.getByText('Acme')).toBeInTheDocument();
  expect(screen.getByText('sous le titre')).toBeInTheDocument();
  expect(screen.getByText('Statut')).toBeInTheDocument();
  ['Tous les agents IA', 'Actifs', 'En pause', 'Brouillons'].forEach((l) =>
    expect(screen.getByText(l)).toBeInTheDocument(),
  );
});

test("l'item actif porte aria-current et le repère, pas les autres", () => {
  wrap('active');
  const active = screen.getByText('Actifs').closest('a');
  expect(active).toHaveAttribute('aria-current', 'page');
  expect(active?.className).toContain('bg-accent-soft');
  expect(active?.className).toContain('shadow-[inset_3px_0_0_var(--accent-ink)]');
  const other = screen.getByText('En pause').closest('a');
  expect(other).not.toHaveAttribute('aria-current');
  expect(other?.className).not.toContain('--accent-ink');
});

test('un compteur et une pastille de couleur sont affichés', () => {
  wrap('all');
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('Actifs').closest('a')?.querySelector('.bg-success')).not.toBeNull();
  expect(screen.getByText('En pause').closest('a')?.querySelector('.bg-warning')).not.toBeNull();
  expect(screen.getByText('Brouillons').closest('a')?.querySelector('.bg-muted-2')).not.toBeNull();
});

test('un item soon n est pas un lien et affiche la pastille à venir', () => {
  wrap('all');
  expect(screen.getByText('Bientôt').closest('a')).toBeNull();
  expect(screen.getByText('à venir')).toBeInTheDocument();
});

test('PageShell place le rail puis le contenu', () => {
  render(
    <PageShell rail={<nav>rail</nav>}>
      <p>contenu</p>
    </PageShell>,
  );
  expect(screen.getByText('rail')).toBeInTheDocument();
  expect(screen.getByText('contenu').parentElement?.className).toContain('px-8');
});

test('la pastille « à venir » reste sur une ligne, le libellé peut se replier à côté', () => {
  wrap('all');
  const pill = screen.getByText('à venir');
  expect(pill.className).toContain('whitespace-nowrap');
  expect(pill.className).toContain('shrink-0');
  const label = screen.getByText('Bientôt');
  expect(label.tagName).toBe('SPAN');
  expect(label.className).toContain('min-w-0');
});

test('compteur en cours de chargement : pastille squelette à la place du nombre', () => {
  render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <Rail title="Acme" groups={[{ items: [{ key: 'all', label: 'Tous', href: '/agents', countLoading: true }] }]} activeKey="all" />
    </NextIntlClientProvider>,
  );
  const link = screen.getByText('Tous').closest('a');
  expect(link?.querySelector('[data-skeleton]')).not.toBeNull();
  expect(link?.textContent).toBe('Tous');
});
