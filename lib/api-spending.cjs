'use strict';

// Suivi des dépenses API (0.6.9). L'utilisateur indique un montant de départ
// (sa dernière recharge) ; ensuite, chaque hausse du solde lu automatiquement
// est comptée comme une recharge payée, sauf si elle est marquée « crédit
// offert ». Le montant détecté est la hausse entre deux lectures : si des
// crédits ont été consommés entre-temps, la recharge réelle était un peu plus
// élevée. Aucun montant n'est inventé : sans solde lisible, rien n'est compté.

const { randomUUID } = require('node:crypto');

// En dessous, une hausse est un arrondi ou une correction du fournisseur.
const MIN_TOP_UP = 0.5;
const MAX_TOP_UPS = 500;
const MAX_AMOUNT = 1e9;

const round = value => Math.round(value * 100) / 100;

function balanceIn(snapshot, currency) {
  const balance = snapshot?.balances?.find(item => item.currency === currency);
  return typeof balance?.remaining === 'number' && Number.isFinite(balance.remaining) ? balance.remaining : null;
}

function validAmount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) throw new Error('Montant de départ invalide.');
  return round(value);
}

// Démarre (ou corrige) le suivi. La devise suit le solde du fournisseur.
function startSpending(p, amount, now = new Date()) {
  if (p?.type !== 'api') throw new Error('Le suivi des dépenses concerne les accès API.');
  const startAmount = validAmount(amount);
  if (p.spending) { p.spending.startAmount = startAmount; return p.spending; }
  const currency = p.snapshot?.balances?.[0]?.currency || p.currency || 'USD';
  p.spending = { currency, startAmount, startedAt: now.toISOString(), lastBalance: balanceIn(p.snapshot, currency), topUps: [] };
  return p.spending;
}

function stopSpending(p) { delete p.spending; }

// Appelé à chaque nouveau relevé enregistré : renvoie la recharge détectée.
function trackBalance(p, snapshot, now = new Date()) {
  if (p?.type !== 'api' || !p.spending || snapshot?.source !== 'api') return null;
  const balance = balanceIn(snapshot, p.spending.currency);
  if (balance === null) return null;
  const previous = p.spending.lastBalance;
  p.spending.lastBalance = balance;
  if (typeof previous !== 'number') return null;
  const amount = round(balance - previous);
  if (amount < MIN_TOP_UP) return null;
  const at = Number.isFinite(Date.parse(snapshot.updatedAt)) ? new Date(snapshot.updatedAt).toISOString() : now.toISOString();
  const topUp = { id: randomUUID(), at, amount, offered: false };
  p.spending.topUps = [topUp, ...(p.spending.topUps || [])].slice(0, MAX_TOP_UPS);
  return topUp;
}

function markTopUp(p, id, offered) {
  if (typeof offered !== 'boolean') throw new Error('Valeur invalide.');
  const topUp = p?.spending?.topUps?.find(item => item.id === id);
  if (!topUp) throw new Error('Recharge introuvable.');
  topUp.offered = offered;
  return topUp;
}

const sameMonth = (iso, now) => {
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
};

// Totaux d'un fournisseur : depuis le début du suivi et sur le mois en cours.
function providerSpending(p, now = new Date()) {
  const spending = p?.spending;
  if (!spending) return null;
  const paid = (spending.topUps || []).filter(item => !item.offered);
  const thisMonth = paid.filter(item => sameMonth(item.at, now)).reduce((sum, item) => sum + item.amount, 0)
    + (sameMonth(spending.startedAt, now) ? spending.startAmount : 0);
  const total = paid.reduce((sum, item) => sum + item.amount, 0) + spending.startAmount;
  return { currency: spending.currency, thisMonth: round(thisMonth), total: round(total), topUps: paid.length };
}

// Dépenses API du mois, par devise, pour la vue d'ensemble.
function spendingSummary(providers, now = new Date()) {
  const month = {};
  let tracked = 0, topUps = 0;
  for (const p of providers) {
    const totals = providerSpending(p, now);
    if (!totals) continue;
    tracked++;
    topUps += (p.spending.topUps || []).filter(item => !item.offered && sameMonth(item.at, now)).length;
    month[totals.currency] = round((month[totals.currency] || 0) + totals.thisMonth);
  }
  return { month, tracked, topUps };
}

module.exports = { MIN_TOP_UP, MAX_TOP_UPS, startSpending, stopSpending, trackBalance, markTopUp, providerSpending, spendingSummary };
