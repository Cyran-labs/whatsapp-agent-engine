import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DialogFrame } from '../dialog-frame';

// recette 10 nov. 2026 : une fenêtre ouverte depuis une cellule de tableau alignée à droite (Connexions) héritait de
// `text-align: right` : titre et texte alignés à droite, contrairement aux autres fenêtres.
test('la fenêtre impose l\'alignement à gauche, quel que soit le conteneur qui l\'a ouverte', () => {
  render(
    <table>
      <tbody>
        <tr>
          <td className="text-right">
            <DialogFrame title="Débrancher Conseil ?" onClose={vi.fn()}>
              <p>Texte</p>
            </DialogFrame>
          </td>
        </tr>
      </tbody>
    </table>,
  );
  expect(screen.getByRole('dialog')).toHaveClass('text-left');
});
