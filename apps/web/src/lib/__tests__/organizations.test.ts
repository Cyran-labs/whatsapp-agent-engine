import { test, expect } from 'vitest';
import {
  acceptedOrganization,
  initialsFromEmail,
  isOpenable,
  monogram,
  resolveActiveOrg,
  type OrganizationSummary,
} from '../organizations';

function org(client_id: string, status?: string): OrganizationSummary {
  return { client_id, name: `Org ${client_id}`, role: 'admin', read_only: false, ...(status ? { status } : {}) };
}

test('isOpenable : statut absent ou active', () => {
  expect(isOpenable(org('A'))).toBe(true);
  expect(isOpenable(org('A', 'active'))).toBe(true);
  expect(isOpenable(org('A', 'suspended'))).toBe(false);
});

test('resolveActiveOrg : le cookie valide gagne', () => {
  expect(resolveActiveOrg([org('A'), org('B')], 'B')?.client_id).toBe('B');
});

test('resolveActiveOrg : cookie inconnu ou absent : la première', () => {
  expect(resolveActiveOrg([org('A'), org('B')], 'Z')?.client_id).toBe('A');
  expect(resolveActiveOrg([org('A'), org('B')], undefined)?.client_id).toBe('A');
});

test('resolveActiveOrg : cookie d\'une organisation suspendue : la première ouvrable', () => {
  expect(resolveActiveOrg([org('A'), org('B', 'suspended')], 'B')?.client_id).toBe('A');
});

test('resolveActiveOrg : première suspendue (super admin) : la première ouvrable', () => {
  expect(resolveActiveOrg([org('A', 'suspended'), org('B')], undefined)?.client_id).toBe('B');
});

test('resolveActiveOrg : aucune organisation ou aucune ouvrable : null', () => {
  expect(resolveActiveOrg([], 'A')).toBeNull();
  expect(resolveActiveOrg([org('A', 'suspended')], 'A')).toBeNull();
});

test('initialsFromEmail', () => {
  expect(initialsFromEmail('claire.bernard@x.fr')).toBe('CB');
  expect(initialsFromEmail('contact@x.fr')).toBe('C');
  expect(initialsFromEmail('jean-paul_d@x.fr')).toBe('JP');
});

test('monogram', () => {
  expect(monogram('Maison Lumière')).toBe('ML');
  expect(monogram('Atelier')).toBe('AT');
  expect(monogram('Groupe de la Vallée')).toBe('GD');
});

test('acceptedOrganization : le nom d\'une organisation absente de « après » est ignoré', () => {
  const after = [org('A'), org('B')];
  expect(acceptedOrganization([org('A')], after, 'Org Z')?.client_id).toBe('B');
});

test('acceptedOrganization : le nom d\'une organisation déjà présente « avant » est ignoré', () => {
  const before = [org('A')];
  const after = [org('A'), org('B')];
  expect(acceptedOrganization(before, after, 'Org A')?.client_id).toBe('B');
});

test('acceptedOrganization : compte neuf, le nom départage, sinon la première ; rien de nouveau : null', () => {
  const after = [org('A'), org('B')];
  expect(acceptedOrganization([], after, 'Org B')?.client_id).toBe('B');
  expect(acceptedOrganization([], after)?.client_id).toBe('A');
  expect(acceptedOrganization(after, after, 'Org A')).toBeNull();
});

test('acceptedOrganization : une organisation suspendue apparue n\'est pas choisie', () => {
  expect(acceptedOrganization([], [org('A', 'suspended'), org('B')])?.client_id).toBe('B');
});
