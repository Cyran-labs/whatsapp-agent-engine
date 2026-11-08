import { test, expect } from 'vitest';
import { accessSubject, encodeOrgCookie, orgOfUser } from '../org-cookie';
import { fakeAccess } from './fake-access';

test('encodeOrgCookie : <user_id>:<client_id>', () => {
  expect(encodeOrgCookie(7, 'c2')).toBe('7:c2');
  expect(encodeOrgCookie('7', 'c2')).toBe('7:c2');
});

test('orgOfUser : organisation reprise seulement par son utilisateur', () => {
  expect(orgOfUser('7:c2', 7)).toBe('c2');
  expect(orgOfUser('7:c2', '7')).toBe('c2');
  expect(orgOfUser('7:c2', 8)).toBeUndefined();
  expect(orgOfUser('7:c2', undefined)).toBeUndefined();
});

test('orgOfUser : un identifiant d\'organisation contenant « : » est gardé entier', () => {
  expect(orgOfUser('7:org:a', 7)).toBe('org:a');
});

test('orgOfUser : ancien format nu, vide ou absent, traité comme absent', () => {
  expect(orgOfUser('c2', 7)).toBeUndefined();
  expect(orgOfUser('7:', 7)).toBeUndefined();
  expect(orgOfUser(':c2', 7)).toBeUndefined();
  expect(orgOfUser(undefined, 7)).toBeUndefined();
});

test('accessSubject : sujet du jeton d\'accès, undefined si illisible', () => {
  expect(accessSubject(fakeAccess(7))).toBe('7');
  expect(accessSubject('opaque')).toBeUndefined();
  expect(accessSubject('a.b.c')).toBeUndefined();
  expect(accessSubject(undefined)).toBeUndefined();
});
