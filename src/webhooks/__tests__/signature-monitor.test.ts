import { afterEach, describe, expect, it } from 'vitest';
import {
  SIGNATURE_REJECTION_THRESHOLD, isSignatureRejected, recordSignatureFailure, recordSignatureSuccess, resetSignatureMonitor,
} from '../signature-monitor.js';

// Choix 4 : compteur en mémoire par compte, aucune écriture en base avant authentification.
describe('compteur de signatures rejetées', () => {
  afterEach(() => resetSignatureMonitor());

  it('seuil de 20 : rejeté seulement au-delà, et levé par une signature valide', () => {
    expect(SIGNATURE_REJECTION_THRESHOLD).toBe(20);
    for (let i = 0; i < 20; i++) recordSignatureFailure(1);
    expect(isSignatureRejected(1)).toBe(false);
    recordSignatureFailure(1);
    expect(isSignatureRejected(1)).toBe(true);
    recordSignatureSuccess(1);
    expect(isSignatureRejected(1)).toBe(false);
  });

  it('propre à chaque compte', () => {
    for (let i = 0; i < 21; i++) recordSignatureFailure(1);
    expect(isSignatureRejected(1)).toBe(true);
    expect(isSignatureRejected(2)).toBe(false);
  });

  it('une signature valide remet le compte à zéro', () => {
    for (let i = 0; i < 15; i++) recordSignatureFailure(1);
    recordSignatureSuccess(1);
    for (let i = 0; i < 15; i++) recordSignatureFailure(1);
    expect(isSignatureRejected(1)).toBe(false);
  });
});
