import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { useEffect } from 'react';
import { vi, beforeEach, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import { NavigationGuardProvider, useNavigationGuard } from '../navigation-guard';
import { PageContent, PageHeader, type CreateAction, type ParentCrumb } from '../page-header';
import { expectCreateButton, headerActions, headerParents, headerTitle } from './frame-assertions';

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('@/i18n/routing', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
  useRouter: () => ({ push: nav.push, replace: vi.fn() }),
  usePathname: () => '/agents/new',
}));

beforeEach(() => {
  nav.push.mockClear();
});

type Props = Parameters<typeof PageHeader>[0];

function wrap(props: Props, extra: React.ReactNode = null) {
  return render(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <NavigationGuardProvider>
        {extra}
        <PageContent>
          <PageHeader {...props} />
          <p>Contenu de la page</p>
        </PageContent>
      </NavigationGuardProvider>
    </NextIntlClientProvider>,
  );
}

const PARENTS: ParentCrumb[] = [
  { label: 'Agents IA', href: '/' },
  { label: 'Boutique Paris', href: '/?entity=1' },
];

function header(): HTMLElement {
  return document.querySelector('[data-page-header]') as HTMLElement;
}

function actionZone(): HTMLElement {
  return document.querySelector('[data-page-action]') as HTMLElement;
}

test('sans parents : aucune ligne des parents', () => {
  wrap({ title: 'Agents IA' });
  expect(screen.queryByRole('navigation', { name: "Fil d'Ariane" })).not.toBeInTheDocument();
});

test('parents vides : aucune ligne des parents', () => {
  wrap({ title: 'Agents IA', parents: [] });
  expect(screen.queryByRole('navigation', { name: "Fil d'Ariane" })).not.toBeInTheDocument();
});

test('deux parents : deux liens séparés par « › », aucun aria-current, ni le titre', () => {
  wrap({ parents: PARENTS, title: 'Support technique' });
  const parents = screen.getByRole('navigation', { name: "Fil d'Ariane" });
  const links = within(parents).getAllByRole('link');
  expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
    ['Agents IA', '/'],
    ['Boutique Paris', '/?entity=1'],
  ]);
  expect(parents).toHaveTextContent('Agents IA›Boutique Paris');
  expect(parents).not.toHaveTextContent('Support technique');
  expect(parents.querySelector('[aria-current]')).toBeNull();
  expect(header().querySelector('[aria-current]')).toBeNull();
});

test('parent à libellé nul : squelette sans lien', () => {
  wrap({ parents: [{ label: 'Agents IA', href: '/' }, { label: null, href: '/agents/b1' }], title: 'Usage et coûts' });
  const parents = screen.getByRole('navigation', { name: "Fil d'Ariane" });
  expect(within(parents).getAllByRole('link').map((a) => a.textContent)).toEqual(['Agents IA']);
  expect(parents.querySelectorAll('[data-skeleton]')).toHaveLength(1);
  expect(parents.querySelector('a[href="/agents/b1"]')).toBeNull();
});

// P5 : les parents passent par la garde de sortie de l'assistant
test('parents : liens gardés, la fenêtre de sortie s’ouvre quand la garde est posée', async () => {
  function Guard() {
    const { setGuard } = useNavigationGuard();
    useEffect(() => setGuard(true), [setGuard]);
    return null;
  }
  wrap({ parents: [{ label: 'Agents IA', href: '/' }], title: 'Créer un agent IA' }, <Guard />);
  await userEvent.click(screen.getByRole('link', { name: 'Agents IA' }));
  expect(await screen.findByRole('dialog', { name: 'Quitter la création ?' })).toBeInTheDocument();
  expect(nav.push).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Quitter sans enregistrer' }));
  await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/'));
});

test('un seul h1, le titre ; description sous le titre ; titleAside hors du h1', () => {
  wrap({ title: 'Support technique', titleAside: <span>Online</span>, description: 'Français, anglais' });
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  expect(headings[0]).toHaveTextContent(/^Support technique$/);
  expect(header()).toHaveTextContent('Online');
  expect(header()).toHaveTextContent('Français, anglais');
});

// revue finale B, I-1 : la ligne des parents et la description sont en --muted (lisible en clair sur --bg), jamais en
// --muted-2 (2,71:1 en clair) ; la paire --muted sur --bg est au test de contraste (theme-tokens.test.ts)
test('ligne des parents et description en text-muted, jamais text-muted-2', () => {
  wrap({ title: 'Support technique', parents: PARENTS, description: 'Français, anglais' });
  const trail = screen.getByRole('navigation', { name: "Fil d'Ariane" }).querySelector('ol') as HTMLElement;
  const description = screen.getByText('Français, anglais');
  for (const element of [trail, description]) {
    expect(element.className.split(/\s+/)).toContain('text-muted');
    expect(element.className).not.toMatch(/\btext-muted-2\b/);
  }
});

// point d'attention 1 : nom de 80 caractères, tronqué sur une ligne, nom entier en title
test('titre de 80 caractères : tronqué, texte entier en title', () => {
  const long = 'A'.repeat(40) + ' ' + 'B'.repeat(39);
  wrap({ title: long, create: { label: 'Créer un agent IA', icon: 'agent', href: '/agents/new' } });
  const h1 = screen.getByRole('heading', { level: 1 });
  expect(h1).toHaveAttribute('title', long);
  expect(h1.className).toContain('truncate');
  // le titre ne passe jamais sous la zone des actions : la zone ne rétrécit pas, le bloc du titre peut
  expect(actionZone().className).toContain('shrink-0');
  expect(h1.closest('[data-page-title-block]')?.className).toContain('min-w-0');
});

test('titre qui n’est pas une chaîne : pas de title', () => {
  wrap({ title: <span>Nom</span> });
  expect(screen.getByRole('heading', { level: 1 })).not.toHaveAttribute('title');
});

test('nom de parent de 80 caractères : tronqué, texte entier en title', () => {
  const long = 'C'.repeat(40) + ' ' + 'D'.repeat(39);
  wrap({ parents: [{ label: long, href: '/?entity=1' }], title: 'Support technique' });
  const link = screen.getByRole('link', { name: long });
  expect(link).toHaveAttribute('title', long);
  expect(link.className).toContain('truncate');
});

function expectRoundButton(control: HTMLElement, label: string, iconName: string) {
  expect(control).toHaveAccessibleName(label);
  expect(control.querySelector(`svg[data-create-icon="${iconName}"]`)).not.toBeNull();
  expect(control).toHaveTextContent('+');
  expect(actionZone()).toContainElement(control);
}

test('create avec href : lien rond vers href, bulle au survol et au focus avec le même texte', async () => {
  wrap({ title: 'Agents IA', create: { label: 'Créer un agent IA', icon: 'agent', href: '/agents/new?entity=1' } });
  const link = screen.getByRole('link', { name: 'Créer un agent IA' });
  expect(link).toHaveAttribute('href', '/agents/new?entity=1');
  expectRoundButton(link, 'Créer un agent IA', 'agent');

  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  await userEvent.hover(link);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Créer un agent IA$/);
  await userEvent.unhover(link);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.focus(link);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Créer un agent IA$/);
  fireEvent.blur(link);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('create avec onClick : bouton rond qui l’appelle', async () => {
  const onClick = vi.fn();
  wrap({ title: 'Entités', create: { label: 'Nouvelle entité', icon: 'entity', onClick } });
  const button = screen.getByRole('button', { name: 'Nouvelle entité' });
  expectRoundButton(button, 'Nouvelle entité', 'entity');
  await userEvent.click(button);
  expect(onClick).toHaveBeenCalledTimes(1);
  await userEvent.hover(button);
  expect(screen.getByRole('tooltip')).toHaveTextContent(/^Nouvelle entité$/);
});

test.each<[CreateAction['icon'], string]>([
  ['agent', 'Créer un agent IA'],
  ['entity', 'Nouvelle entité'],
  ['user', 'Inviter un utilisateur'],
  ['whatsapp', 'Raccorder un compte WhatsApp'],
])('icône de l’objet créé : %s', (icon, label) => {
  wrap({ title: 'Page', create: { label, icon, onClick: vi.fn() } });
  expectRoundButton(screen.getByRole('button', { name: label }), label, icon);
});

// P6 : repris des boutons actuels (lecture en échec, liste pas encore lue)
test('create désactivé : bouton désactivé qui n’appelle rien, même nom ; lien désactivé : plus de href', async () => {
  const onClick = vi.fn();
  const { unmount } = wrap({ title: 'Entités', create: { label: 'Nouvelle entité', icon: 'entity', onClick, disabled: true } });
  const button = screen.getByRole('button', { name: 'Nouvelle entité' });
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(onClick).not.toHaveBeenCalled();
  unmount();

  wrap({ title: 'Agents IA', create: { label: 'Créer un agent IA', icon: 'agent', href: '/agents/new', disabled: true } });
  expect(screen.queryByRole('link', { name: 'Créer un agent IA' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Créer un agent IA' })).toBeDisabled();
});

test('create nul ou absent : aucun bouton rond', () => {
  const { unmount } = wrap({ title: 'Réglages', create: null });
  expect(actionZone()).toBeNull();
  expect(screen.queryAllByRole('button')).toEqual([]);
  unmount();
  wrap({ title: 'Réglages' });
  expect(actionZone()).toBeNull();
});

// P4 : parents, titre et description, actions, puis bouton rond ; seul le bouton rond est collant
test('actions et bouton rond dans la même zone data-page-action, bouton rond en dernier au clavier', async () => {
  wrap({
    parents: [{ label: 'Agents IA', href: '/' }],
    title: 'Page',
    description: 'Description',
    actions: <button type="button">Simuler</button>,
    create: { label: 'Créer un agent IA', icon: 'agent', href: '/agents/new' },
  });
  const zones = document.querySelectorAll('[data-page-action]');
  expect(zones).toHaveLength(1);
  const zone = zones[0] as HTMLElement;
  const simulate = screen.getByRole('button', { name: 'Simuler' });
  const create = screen.getByRole('link', { name: 'Créer un agent IA' });
  expect(zone).toContainElement(simulate);
  expect(zone).toContainElement(create);
  expect(header()).toContainElement(zone);

  await userEvent.tab();
  expect(screen.getByRole('link', { name: 'Agents IA' })).toHaveFocus();
  await userEvent.tab();
  expect(simulate).toHaveFocus();
  await userEvent.tab();
  expect(create).toHaveFocus();

  // seul le bouton rond est collant
  const sticky = Array.from(header().querySelectorAll<HTMLElement>('*')).filter((el) => el.className.toString().split(' ').includes('sticky'));
  expect(sticky).toHaveLength(1);
  expect(sticky[0]).toContainElement(create);
  expect(sticky[0]).not.toContainElement(simulate);
});

test('actions sans bouton rond : la zone data-page-action porte les actions', () => {
  wrap({ title: 'Usage et coûts', actions: <button type="button">30 j</button> });
  expect(actionZone()).toContainElement(screen.getByRole('button', { name: '30 j' }));
});

test('PageContent : pleine largeur, sans largeur maximale (C-3)', () => {
  wrap({ title: 'Page' });
  const content = header().parentElement as HTMLElement;
  expect(content.className).toContain('px-8');
  expect(content.className).not.toMatch(/max-w-/);
  expect(content).toHaveTextContent('Contenu de la page');
});

// P2 : aides des tests de pages des tâches suivantes
test('aides de constat : parents, titre, actions et bouton rond', () => {
  const { unmount } = wrap({
    parents: PARENTS,
    title: 'Support technique',
    actions: <button type="button">▶ Simuler</button>,
    create: { label: 'Créer un agent IA', icon: 'agent', href: '/agents/new' },
  });
  expect(headerParents()).toEqual(['Agents IA', 'Boutique Paris']);
  expect(headerTitle()).toHaveTextContent('Support technique');
  expect(headerActions()).toEqual(['▶ Simuler', 'Créer un agent IA']);
  expect(expectCreateButton('Créer un agent IA')).toHaveAttribute('href', '/agents/new');
  unmount();

  wrap({ title: 'Réglages' });
  expect(headerParents()).toEqual([]);
  expect(headerActions()).toEqual([]);
  expect(expectCreateButton(null)).toBeNull();
});
