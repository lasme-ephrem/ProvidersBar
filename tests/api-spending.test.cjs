'use strict';
// Suivi des dépenses API (0.6.9) : montant de départ, recharges détectées par
// la hausse du solde, crédits offerts exclus, totaux du mois et depuis le début.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MIN_TOP_UP, MAX_TOP_UPS, startSpending, stopSpending, trackBalance, markTopUp, providerSpending, spendingSummary } = require('../lib/api-spending.cjs');

const NOW = new Date(2026, 10, 5, 12);
const snapshot = (remaining, updatedAt = NOW.toISOString(), currency = 'USD') => ({ source: 'api', updatedAt, balances: [{ currency, remaining }] });
const api = (extra = {}) => ({ id: 'deepseek', type: 'api', currency: 'USD', snapshot: snapshot(2.47), ...extra });

test('startSpending démarre le suivi depuis le solde courant, dans la devise du fournisseur', () => {
  const p = api({ snapshot: snapshot(30, NOW.toISOString(), 'CNY') });
  const spending = startSpending(p, 10.004, NOW);
  assert.deepEqual(spending, { currency: 'CNY', startAmount: 10, startedAt: NOW.toISOString(), lastBalance: 30, topUps: [] });
  // Corriger le montant de départ ne remet pas le suivi à zéro.
  startSpending(p, 12, new Date(2027, 0, 1));
  assert.equal(p.spending.startAmount, 12);
  assert.equal(p.spending.startedAt, NOW.toISOString());
  for (const bad of [-1, Number.NaN, '10', 2e9]) assert.throws(() => startSpending(api(), bad), /Montant de départ/);
  assert.throws(() => startSpending({ type: 'subscription' }, 10), /accès API/);
  const unread = api({ snapshot: null });
  assert.equal(startSpending(unread, 5, NOW).lastBalance, null, 'sans solde lu, aucune base n’est inventée');
  stopSpending(p);
  assert.equal('spending' in p, false);
});

test('trackBalance compte une hausse du solde comme recharge payée, jamais une baisse ni un arrondi', () => {
  const p = api();
  startSpending(p, 10, NOW);
  assert.equal(trackBalance(p, snapshot(2.1), NOW), null, 'une consommation n’est pas une recharge');
  assert.equal(p.spending.lastBalance, 2.1);
  assert.equal(trackBalance(p, snapshot(2.1 + MIN_TOP_UP - 0.01), NOW), null, 'une hausse minime est un arrondi');
  const later = new Date(2026, 10, 6, 9).toISOString();
  const topUp = trackBalance(p, snapshot(22.59, later), NOW);
  assert.equal(topUp.amount, 20);
  assert.equal(topUp.at, later);
  assert.equal(topUp.offered, false);
  assert.match(topUp.id, /^[0-9a-f-]{36}$/);
  assert.equal(p.spending.topUps[0], topUp);
  // Sans solde lisible, dans une autre devise, hors API ou relevé manuel : rien.
  assert.equal(trackBalance(p, { source: 'api', balances: [] }, NOW), null);
  assert.equal(trackBalance(p, snapshot(500, later, 'EUR'), NOW), null);
  assert.equal(trackBalance(p, { ...snapshot(900), source: 'manual' }, NOW), null);
  assert.equal(trackBalance({ type: 'subscription', spending: p.spending }, snapshot(900), NOW), null);
  assert.equal(trackBalance(api(), snapshot(900), NOW), null, 'sans suivi démarré, aucune recharge');
  // Premier solde lu après un démarrage sans solde : il sert de base, sans recharge.
  const unread = api({ snapshot: null });
  startSpending(unread, 5, NOW);
  assert.equal(trackBalance(unread, snapshot(40), NOW), null);
  assert.equal(unread.spending.lastBalance, 40);
});

test('les totaux distinguent le mois en cours, le total depuis le début et les crédits offerts', () => {
  const p = api();
  startSpending(p, 10, new Date(2026, 9, 20));
  p.spending.lastBalance = 0;
  trackBalance(p, snapshot(5, new Date(2026, 9, 25).toISOString()), NOW); // octobre : +5
  trackBalance(p, snapshot(25, new Date(2026, 10, 2).toISOString()), NOW); // novembre : +20
  trackBalance(p, snapshot(40, new Date(2026, 10, 4).toISOString()), NOW); // novembre : +15
  assert.deepEqual(providerSpending(p, NOW), { currency: 'USD', thisMonth: 35, total: 50, topUps: 3 });
  const offered = p.spending.topUps.find(item => item.amount === 15);
  markTopUp(p, offered.id, true);
  assert.deepEqual(providerSpending(p, NOW), { currency: 'USD', thisMonth: 20, total: 35, topUps: 2 });
  markTopUp(p, offered.id, false);
  assert.equal(providerSpending(p, NOW).thisMonth, 35);
  assert.throws(() => markTopUp(p, 'inconnu', true), /introuvable/);
  assert.throws(() => markTopUp(p, offered.id, 'oui'), /invalide/);
  // Le montant de départ compte pour le mois où le suivi a démarré.
  const started = api();
  startSpending(started, 8, NOW);
  assert.deepEqual(providerSpending(started, NOW), { currency: 'USD', thisMonth: 8, total: 8, topUps: 0 });
  assert.equal(providerSpending(api(), NOW), null);
  // Vue d'ensemble : dépenses du mois par devise et recharges payées du mois.
  const euro = api({ id: 'runinfra', snapshot: snapshot(3, NOW.toISOString(), 'EUR') });
  startSpending(euro, 4, NOW);
  assert.deepEqual(spendingSummary([p, started, euro, api({ id: 'openrouter' }), { type: 'subscription' }], NOW),
    { month: { USD: 43, EUR: 4 }, tracked: 3, topUps: 2 });
});

test('l’historique des recharges est borné', () => {
  const p = api();
  startSpending(p, 0, NOW);
  p.spending.lastBalance = 0;
  for (let index = 1; index <= MAX_TOP_UPS + 5; index++) trackBalance(p, snapshot(index), NOW);
  assert.equal(p.spending.topUps.length, MAX_TOP_UPS);
  assert.equal(p.spending.lastBalance, MAX_TOP_UPS + 5);
});
