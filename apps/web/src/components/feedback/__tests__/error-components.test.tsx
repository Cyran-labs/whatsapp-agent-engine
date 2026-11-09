import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { expect, test, vi } from 'vitest';
import fr from '../../../../messages/fr.json';
import en from '../../../../messages/en.json';
import { FieldError } from '../field-error';
import { InlineError } from '../inline-error';
import { LoadError } from '../load-error';
import { PartialValue } from '../partial-value';

function renderIntl(ui: React.ReactNode, locale: 'fr' | 'en' = 'fr') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? fr : en}>
      {ui}
    </NextIntlClientProvider>,
  );
}

test('FieldError : message relié au champ par aria-describedby', () => {
  renderIntl(
    <>
      <input aria-label="Nom" aria-invalid="true" aria-describedby="name-error" />
      <FieldError id="name-error" message="Le nom est requis." />
    </>,
  );
  const input = screen.getByRole('textbox', { name: 'Nom' });
  expect(input).toHaveAccessibleDescription('Le nom est requis.');
  expect(document.getElementById('name-error')).toHaveClass('text-danger');
});

test('FieldError : rien sans message', () => {
  const { container } = renderIntl(<FieldError id="name-error" message={null} />);
  expect(container).toBeEmptyDOMElement();
});

// audit R-14 : la référence de la requête accompagne le texte de panne, en petit.
test('InlineError : role="alert", message et « Référence : … »', () => {
  renderIntl(<InlineError message="Enregistrement impossible pour le moment. Réessayez." reference="req-7f3a" />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Enregistrement impossible pour le moment. Réessayez.');
  expect(screen.getByText('Référence : req-7f3a')).toBeInTheDocument();
});

test('InlineError : sans référence, aucune ligne de référence ; action affichée', () => {
  renderIntl(<InlineError message="Ce numéro a changé." action={<button type="button">Relire la liste</button>} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Ce numéro a changé.');
  expect(screen.queryByText(/Référence/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Relire la liste' })).toBeInTheDocument();
});

test('InlineError : référence en anglais', () => {
  renderIntl(<InlineError message="Could not save." reference="req-1" />, 'en');
  expect(screen.getByText('Reference: req-1')).toBeInTheDocument();
});

test('LoadError : message à la place du contenu et bouton Réessayer', async () => {
  const onRetry = vi.fn();
  renderIntl(<LoadError message="Impossible de charger les membres." onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Impossible de charger les membres.');
  await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

// audit R-3 : un chiffre inconnu se lit « indisponible », jamais 0.
test('PartialValue : « indisponible », jamais 0', () => {
  const { container } = renderIntl(<PartialValue />);
  expect(container).toHaveTextContent('indisponible');
  expect(container).not.toHaveTextContent('0');
});

test('PartialValue : « unavailable » en anglais', () => {
  const { container } = renderIntl(<PartialValue />, 'en');
  expect(container).toHaveTextContent('unavailable');
});
