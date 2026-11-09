import { describe, expect, it } from 'vitest';
import {
  Grants, CreateInvitationInput, SetMembershipsInput, SetMemberStatusInput,
  CreateEntityInput, UpdateEntityInput, OrganizationSettings, UpdateOrganizationSettingsInput,
  CreateBotInput, UpdateBotInput,
} from '../index.js';

describe('contracts: grants', () => {
  it('accepte une grant admin d\'organisation', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'admin' }]).success).toBe(true);
  });
  it('accepte un super manager en lecture seule', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'super_manager', read_only: true }]).success).toBe(true);
  });
  it('accepte des grants d\'entité distinctes', () => {
    expect(Grants.safeParse([{ entity_id: 1, role: 'manager' }, { entity_id: 2, role: 'advisor' }]).success).toBe(true);
  });
  it('refuse une liste vide', () => {
    expect(Grants.safeParse([]).success).toBe(false);
  });
  it('refuse le mélange organisation et entité', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'admin' }, { entity_id: 1, role: 'advisor' }]).success).toBe(false);
  });
  it('refuse deux grants sur la même entité', () => {
    expect(Grants.safeParse([{ entity_id: 1, role: 'manager' }, { entity_id: 1, role: 'advisor' }]).success).toBe(false);
  });
  it('refuse deux grants d\'organisation', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'admin' }, { entity_id: null, role: 'super_manager' }]).success).toBe(false);
  });
  it('refuse un rôle d\'entité sans entité', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'manager' }]).success).toBe(false);
  });
  it('refuse un rôle d\'organisation sur une entité', () => {
    expect(Grants.safeParse([{ entity_id: 1, role: 'admin' }]).success).toBe(false);
  });
  it('refuse read_only sur admin', () => {
    expect(Grants.safeParse([{ entity_id: null, role: 'admin', read_only: true }]).success).toBe(false);
  });
});

describe('contracts: comptes', () => {
  it('CreateInvitationInput normalise l\'email et exige des grants', () => {
    const r = CreateInvitationInput.parse({ email: '  X@Y.test ', grants: [{ entity_id: null, role: 'admin' }] });
    expect(r.email).toBe('x@y.test');
    expect(() => CreateInvitationInput.parse({ email: 'x@y.test', grants: [] })).toThrow();
  });
  it('SetMembershipsInput et SetMemberStatusInput', () => {
    expect(SetMembershipsInput.safeParse({ grants: [{ entity_id: 3, role: 'advisor' }] }).success).toBe(true);
    expect(SetMemberStatusInput.safeParse({ status: 'suspended' }).success).toBe(true);
    expect(SetMemberStatusInput.safeParse({ status: 'invited' }).success).toBe(false);
  });
  it('CreateEntityInput trim et borne le nom', () => {
    expect(CreateEntityInput.parse({ name: '  Paris  ' }).name).toBe('Paris');
    expect(CreateEntityInput.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateEntityInput.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
  it('UpdateEntityInput accepte statut archived', () => {
    expect(UpdateEntityInput.parse({ status: 'archived' })).toEqual({ status: 'archived' });
    expect(UpdateEntityInput.safeParse({ status: 'deleted' }).success).toBe(false);
  });
  it('OrganizationSettings applique les défauts', () => {
    expect(OrganizationSettings.parse({})).toEqual({
      visibility: 'all', pool_self_claim: true, reassign: 'managers', transfer: 'managers', takeover: 'owner',
    });
  });
  it('UpdateOrganizationSettingsInput est partiel sans défauts', () => {
    expect(UpdateOrganizationSettingsInput.parse({})).toEqual({});
    expect(UpdateOrganizationSettingsInput.parse({ visibility: 'entities' })).toEqual({ visibility: 'entities' });
  });
  it('entity_id optionnel sur les bots', () => {
    const base = { bot_id: 'a1', name: 'A', welcome: { enabled: false, message: {} } };
    expect(CreateBotInput.parse({ ...base, entity_id: 4 }).entity_id).toBe(4);
    expect(CreateBotInput.parse(base).entity_id).toBeUndefined();
    expect(CreateBotInput.safeParse({ ...base, entity_id: 0 }).success).toBe(false);
    expect(UpdateBotInput.parse({ entity_id: 2 })).toEqual({ entity_id: 2 });
  });
});
