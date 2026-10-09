import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ApiError, API, request} from '../src/lib/api.ts';
const response = (data, status=200) => new Response(JSON.stringify(data), {status});
test('le dépôt public ne transmet aucun jeton RH', async () => {
 global.fetch = async (url, init) => {assert.equal(url, API + '/public/candidates'); assert.equal(init.headers.Authorization, undefined); assert.equal(init.method, 'POST'); assert.equal(JSON.parse(init.body).consent, true); return response({reference: 'CAND-2026-000010'}, 201);};
 assert.equal((await request('/public/candidates', {body: {consent: true}})).reference, 'CAND-2026-000010');
});
test('les lectures RH utilisent le jeton et GET', async () => {
 global.fetch = async (_, init) => {assert.equal(init.headers.Authorization, 'Bearer staff-test'); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); return response({items: []});};
 assert.deepEqual(await request('/drh/candidates/page', {token: 'staff-test'}), {items: []});
});
test('un refus de permission reste identifiable', async () => {
 global.fetch = async () => response({detail: 'Accès refusé'}, 403);
 await assert.rejects(request('/drh/candidates/page'), e => e instanceof ApiError && e.status === 403 && e.message === 'Accès refusé');
});
test('les erreurs de validation sont affichables', async () => {
 global.fetch = async () => response({detail: [{msg: 'Email invalide'}]}, 422);
 await assert.rejects(request('/public/candidates', {body: {}}), /Email invalide/);
});
test('une erreur réseau ne déclenche aucune répétition du dépôt', async () => {
 let count = 0; global.fetch = async () => {count++; throw new Error('network');};
 await assert.rejects(request('/public/candidates', {body: {}}), /Connexion indisponible/); assert.equal(count, 1);
});
test('une annulation est propagée à la requête', async () => {
 const controller = new AbortController(); controller.abort();
 global.fetch = async (_, init) => {assert.equal(init.signal.aborted, true); throw new DOMException('Aborted', 'AbortError');};
 await assert.rejects(request('/drh/candidates/page', {signal: controller.signal}), e => e.name === 'AbortError');
});
test('la fiche RH utilise PUT avec le jeton et conserve les champs du dossier', async () => {
 const body = {data: {numeroCnas: '1234567890', avisDecision: 'Favorable', customExisting: true}};
 global.fetch = async (url, init) => {assert.equal(url, API + '/drh/candidates/42'); assert.equal(init.method, 'PUT'); assert.equal(init.headers.Authorization, 'Bearer staff-test'); assert.deepEqual(JSON.parse(init.body), body); return response({status:'success'});};
 assert.deepEqual(await request('/drh/candidates/42', {token:'staff-test', method:'PUT', body}), {status:'success'});
});
