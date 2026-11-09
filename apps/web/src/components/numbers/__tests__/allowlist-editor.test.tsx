import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, test, expect } from 'vitest';
import { ALLOWLIST_MAX } from '@wabagent/contracts';
import { AllowlistEditor } from '../allowlist-editor';
import { renderIntl } from '@/components/connections/__tests__/helpers';

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
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33698765432' }));
  expect(onChange).toHaveBeenCalledWith(['+33612345678']);
  expect(screen.queryByText('+33698765432')).not.toBeInTheDocument();
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
  await userEvent.click(screen.getByRole('button', { name: 'Retirer +33610000000' }));
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
  expect(screen.getByRole('button', { name: 'Retirer +33612345678' })).toBeDisabled();
});

test('la saisie en cours est remontée (onDraftChange)', async () => {
  const onDraftChange = vi.fn();
  renderIntl(<Controlled onDraftChange={onDraftChange} />);
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '+33');
  expect(onDraftChange).toHaveBeenLastCalledWith('+33');
  await userEvent.type(screen.getByLabelText('Numéro à autoriser'), '612345678{Enter}');
  expect(onDraftChange).toHaveBeenLastCalledWith('');
});
