import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { vi, test, expect } from 'vitest';
import messages from '../../../../messages/fr.json';
import enMessages from '../../../../messages/en.json';
import type { Session } from '@/components/providers/session-provider';
import type { OrgNotice } from '@/lib/org-notice';
import { OrgNoticeBanner } from '../org-notice-banner';

let mockSession: Pick<Session, 'notice' | 'dismissNotice'>;
vi.mock('@/components/providers/session-provider', () => ({
  useSession: () => mockSession,
}));

function show(notice: OrgNotice | null, locale: 'fr' | 'en' = 'fr') {
  mockSession = { notice, dismissNotice: vi.fn() };
  render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? messages : enMessages}>
      <OrgNoticeBanner />
    </NextIntlClientProvider>,
  );
}

test('aucun message : rien', () => {
  show(null);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

// audit R-29
test('accès changé : nomme l\'organisation et le nouveau rôle', () => {
  show({ kind: 'access', org: 'Maison Lumière', role: 'manager', readOnly: false });
  expect(screen.getByRole('status')).toHaveTextContent('Votre accès à Maison Lumière a changé : vous êtes maintenant Manager.');
});

// audit R-29
test('accès changé : un super manager en lecture seule le dit', () => {
  show({ kind: 'access', org: 'Maison Lumière', role: 'super_manager', readOnly: true });
  expect(screen.getByRole('status')).toHaveTextContent('vous êtes maintenant Super manager · lecture seule.');
});

// audit R-29
test('accès perdu : nomme l\'organisation quittée', () => {
  show({ kind: 'access', org: 'Maison Lumière' });
  expect(screen.getByRole('status')).toHaveTextContent('Vous n\'avez plus accès à Maison Lumière.');
});

// audit R-29
test('organisation suspendue : la nomme et dit qui contacter', () => {
  show({ kind: 'suspended', org: 'Studio Ocre' });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Studio Ocre est suspendue. Contactez l\'administrateur de votre organisation ou le support.',
  );
});

// recette 3.13 : l'administrateur de l'organisation suspendue ne peut contacter que le support
test('organisation suspendue, administrateur de celle-ci : « Contactez le support. »', () => {
  show({ kind: 'suspended', org: 'Studio Ocre', role: 'admin' });
  expect(screen.getByRole('status')).toHaveTextContent(/^Studio Ocre est suspendue\. Contactez le support\.×$/);
});

test('organisation suspendue, autre rôle : administrateur ou support', () => {
  show({ kind: 'suspended', org: 'Studio Ocre', role: 'super_manager' });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Studio Ocre est suspendue. Contactez l\'administrateur de votre organisation ou le support.',
  );
});

test('organisation suspendue, administrateur, en anglais', () => {
  show({ kind: 'suspended', org: 'Studio Ocre', role: 'admin' }, 'en');
  expect(screen.getByRole('status')).toHaveTextContent(/^Studio Ocre is suspended\. Contact support\.×$/);
});

// audit R-11
test('organisation changée dans un autre onglet : dit ce qui s\'est passé et ce que l\'onglet affiche', () => {
  show({ kind: 'changed', org: 'Atelier Nord' });
  expect(screen.getByRole('status')).toHaveTextContent(
    'Vous avez changé d\'organisation dans un autre onglet : cet onglet affiche maintenant Atelier Nord.',
  );
});

test('en anglais', () => {
  show({ kind: 'changed', org: 'Atelier Nord' }, 'en');
  expect(screen.getByRole('status')).toHaveTextContent('You switched organization in another tab: this tab now shows Atelier Nord.');
});

test('Fermer le message appelle dismissNotice', async () => {
  show({ kind: 'changed', org: 'Atelier Nord' });
  await userEvent.click(screen.getByRole('button', { name: 'Fermer le message' }));
  expect(mockSession.dismissNotice).toHaveBeenCalledTimes(1);
});
