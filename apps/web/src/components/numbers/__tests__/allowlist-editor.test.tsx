import { useState } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '../../../../messages/fr.json';
import userEvent from '@testing-library/user-event';
import { vi, test, expect } from 'vitest';
import { ALLOWLIST_MAX } from '@wabagent/contracts';
import { AllowlistEditor } from '../allowlist-editor';
import { describedBy, isReadableMuted, renderIntl } from '@/components/connections/__tests__/helpers';

type Props = React.ComponentProps<typeof AllowlistEditor>;

function props(over: Partial<Props> = {}): Props {
  return { entries: [], errors: {}, onChange: vi.fn(), ...over };
}

/** Le parent tient la liste, comme l'assistant et la page de l'agent IA. */
function Controlled({ initial = [], errors = {}, onChange, onDraftChange }: { initial?: string[]; errors?: Record<number, string>; onChange?: (e: string[]) => void; onDraftChange?: (d: string) => void }) {
  const [entries, setEntries] = useState<string[]>(initial);
  return (
    <AllowlistEditor
      entries={entries}
      errors={errors}
      onChange={(next) => { setEntries(next); onChange?.(next); }}
      onDraftChange={onDraftChange}
    />
  );
}

const numbers = (count: number): string[] => Array.from({ length: count }, (_, i) => `+3361000${String(i).padStart(4, '0')}`);

test('liste vide : le dit, et le bouton Ajouter est désactivé avec sa raison', () => {
  renderIntl(<AllowlistEditor {...props()} />);
  expect(screen.getByText('Aucun numéro pour l\'instant.')).toBeInTheDocument();
  const add = screen.getByRole('button', { name: 'Ajouter' });
  expect(add).toBeDisabled();
  expect(add).toHaveAttribute('aria-describedby', screen.getByText('Saisissez un numéro pour l\'ajouter.').id);
});

test('ajout : le numéro saisi rejoint la liste, le champ se vide (bouton ou Entrée)', async () => {
  const onChange = vi.fn();
  renderIntl(<Controlled onChange={onChange} />);
  const input = screen.getByLabelText('Numéro à autoriser');
  await userEvent.type(input, ' +33612345678 ');
  await userEvent.click(screen.getByRole('button', { name: 'Ajouter' }));
  expect(onChange).toHaveBeenLastCalledWith(['+33612345678']);
  expect(input).toHaveValue('');
  await userEvent.type(input, '+33698765432{Enter}');
  expect(onChange).toHaveBeenLastCalledWith(['+33612345678', '+33698765432']);
  const list = screen.getByRole('list', { name: 'Numéros autorisés' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(2);
});

test('un numéro déjà dans la liste n\'est pas ajouté deux fois', async () => {
  const onChange = vi.fn();
  renderIntl(<Controlled initial={['+33612345678']} onChange={onChange} />);
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33612345678{Enter}');
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Numéro à autoriser')).toHaveValue('');
  const message = screen.getByText('Ce numéro est déjà dans la liste.');
  expect(screen.getByLabelText('Numéro à autoriser')).toHaveAttribute('aria-describedby', message.id);
  // Le message disparaît dès la saisie suivante.
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+');
  expect(screen.queryByText('Ce numéro est déjà dans la liste.')).not.toBeInTheDocument();
});

test('suppression : retire la ligne choisie', async () => {
  const onChange = vi.fn();
  renderIntl(<Controlled initial={['+33612345678', '+33698765432']} onChange={onChange} />);
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 98 76 54 32' }));
  expect(onChange).toHaveBeenCalledWith(['+33612345678']);
  expect(screen.queryByText('+33 6 98 76 54 32')).not.toBeInTheDocument();
});

test('au plus ALLOWLIST_MAX numéros : le vingt et unième ajout est bloqué avec sa raison', async () => {
  renderIntl(<Controlled initial={numbers(ALLOWLIST_MAX)} />);
  const input = screen.getByLabelText('Numéro à autoriser');
  expect(input).toBeDisabled();
  const add = screen.getByRole('button', { name: 'Ajouter' });
  expect(add).toBeDisabled();
  const reason = screen.getByText('20 numéros au plus');
  expect(add).toHaveAttribute('aria-describedby', reason.id);
  // Retirer une ligne rouvre l'ajout.
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33 6 10 00 00 00' }));
  expect(screen.getByLabelText('Numéro à autoriser')).toBeEnabled();
  expect(screen.queryByText('20 numéros au plus')).not.toBeInTheDocument();
});

test('une erreur du moteur s\'affiche sous la ligne d\'indice, les autres lignes restent', () => {
  renderIntl(<AllowlistEditor {...props({ entries: ['+33612345678', 'abc', '+33698765432'], errors: { 1: 'Numéro au format international attendu.' } })} />);
  const items = within(screen.getByRole('list', { name: 'Numéros autorisés' })).getAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(within(items[1]!).getByText('abc')).toBeInTheDocument();
  expect(within(items[1]!).getByRole('alert')).toHaveTextContent('Numéro au format international attendu.');
  expect(within(items[0]!).queryByRole('alert')).not.toBeInTheDocument();
  expect(within(items[2]!).queryByRole('alert')).not.toBeInTheDocument();
});

test('désactivé : ni ajout ni suppression', () => {
  renderIntl(<AllowlistEditor {...props({ entries: ['+33612345678'], disabled: true })} />);
  expect(screen.getByLabelText('Numéro à autoriser')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Ajouter' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Retirer +33 6 12 34 56 78' })).toBeDisabled();
});

test('la saisie en cours est remontée (onDraftChange)', async () => {
  const onDraftChange = vi.fn();
  renderIntl(<Controlled onDraftChange={onDraftChange} />);
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33');
  expect(onDraftChange).toHaveBeenLastCalledWith('+33');
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '612345678{Enter}');
  expect(onDraftChange).toHaveBeenLastCalledWith('');
});

// revue finale 2b-3 m-11 : la liste s'affiche avec formatPhone, ce que l'on envoie reste en E.164 ; un BSUID est rendu tel quel
test('affichage : numéros avec formatPhone, identifiant WhatsApp tel quel, valeur transmise inchangée', async () => {
  const onChange = vi.fn();
  renderIntl(<Controlled initial={['+33612345678', 'FR.abc123']} onChange={onChange} />);
  const items = within(screen.getByRole('list', { name: 'Numéros autorisés' })).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('+33 6 12 34 56 78');
  expect(items[0]).not.toHaveTextContent('+33612345678');
  expect(items[1]).toHaveTextContent('FR.abc123');
  await userEvent.click(screen.getByRole('button', { name: 'Retirer FR.abc123' }));
  expect(onChange).toHaveBeenCalledWith(['+33612345678']);
});

// revue finale 2b-3 (contraste)
test('contraste : la raison du bouton Ajouter désactivé est en text-muted', () => {
  renderIntl(<AllowlistEditor {...props()} />);
  expect(isReadableMuted(describedBy(screen.getByRole('button', { name: 'Ajouter' })))).toBe(true);
});

// contre-audit D-3 : le refus d'une entrée ramène le focus sur ce qui la corrige (« Retirer » de la première ligne refusée).
test('contre-audit D-3 : le focus va au bouton « Retirer » de la première ligne refusée', async () => {
  const entries = ['+33612345678', 'abc', 'def'];
  const view = renderIntl(<AllowlistEditor {...props({ entries, errors: {} })} />);
  expect(screen.getByRole('button', { name: 'Retirer abc' })).not.toHaveFocus();
  view.rerender(
    <NextIntlClientProvider locale="fr" messages={messages}>
      <AllowlistEditor {...props({ entries, errors: { 2: 'Numéro attendu.', 1: 'Numéro attendu.' } })} />
    </NextIntlClientProvider>,
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Retirer abc' })).toHaveFocus());
});
