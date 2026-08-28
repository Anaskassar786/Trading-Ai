// services/tradeplan.js — trade plan from the judge's structure-based levels + user risk.
// Pure math on real inputs only. Position size only when all required inputs exist.
import { computePositionSize } from './instruments.js';
import { round } from '../util.js';

export function buildTradePlan({ judgeResult, snapshot }) {
  const warnings = [];
  const j = judgeResult;
  const symbol = snapshot.symbol;
  const risk = snapshot.risk_amount ?? null;
  const balance = snapshot.account_balance ?? null;

  if (!j || j.final_decision === 'NO_TRADE') {
    return {
      decision: j?.final_decision || 'NO_TRADE',
      tradeable: false,
      reason: 'No trade recommended — no trade plan generated.',
      position_size: null,
      warnings: j?.warnings || [],
    };
  }

  const entryMid = j.entry.low !== null && j.entry.high !== null
    ? (j.entry.low + j.entry.high) / 2
    : (j.entry.low ?? j.entry.high);

  const plan = {
    decision: j.final_decision,
    tradeable: true,
    symbol,
    entry_zone: j.entry,
    entry_reference: round(entryMid),
    stop_loss: j.stop_loss,
    targets: j.targets,
    risk_amount: risk,
    account_balance: balance,
    risk_reward: j.risk_reward,
    position_size: null,
    position_size_reason: null,
    computed: {},
    warnings,
  };

  if (entryMid === null || j.stop_loss === null) {
    plan.position_size_reason = 'Position size unavailable: judge did not produce both an entry level and a structure-based stop loss.';
    warnings.push(plan.position_size_reason);
    return plan;
  }

  // Recompute R:R from actual levels (never trust an unverified number).
  const stopDist = Math.abs(entryMid - j.stop_loss);
  if (stopDist > 0) {
    for (const [k, tp] of Object.entries(j.targets)) {
      if (tp !== null) plan.computed[`rr_${k}`] = round(Math.abs(tp - entryMid) / stopDist, 2);
    }
    // Direction sanity checks — flag, never silently fix.
    if (j.final_decision === 'BUY' && j.stop_loss >= entryMid) warnings.push('Inconsistency: BUY decision but stop loss is not below entry. Review before acting.');
    if (j.final_decision === 'SELL' && j.stop_loss <= entryMid) warnings.push('Inconsistency: SELL decision but stop loss is not above entry. Review before acting.');
    for (const [k, tp] of Object.entries(j.targets)) {
      if (tp === null) continue;
      if (j.final_decision === 'BUY' && tp <= entryMid) warnings.push(`Inconsistency: ${k.toUpperCase()} is not above entry for a BUY.`);
      if (j.final_decision === 'SELL' && tp >= entryMid) warnings.push(`Inconsistency: ${k.toUpperCase()} is not below entry for a SELL.`);
    }
  }

  if (risk === null) {
    plan.position_size_reason = 'Position size unavailable: no risk amount provided.';
    return plan;
  }

  const latestClose = snapshot.market_data?.status === 'OK' ? snapshot.market_data.latest?.close : null;
  const ps = computePositionSize({ symbol, entry: entryMid, stopLoss: j.stop_loss, riskAmount: risk, snapshotLatestClose: latestClose });
  if (ps.available) {
    plan.position_size = { lots: ps.lots, units: ps.units, risk_per_lot_usd: ps.risk_per_lot_usd, spec: ps.spec };
    warnings.push(...ps.warnings);
  } else {
    plan.position_size_reason = ps.reason;
    warnings.push(ps.reason, ...ps.warnings);
  }

  // Risk-vs-balance warning (warn, never silently modify the user's risk).
  if (balance !== null && risk !== null && balance > 0) {
    const pct = risk / balance * 100;
    if (pct > 5) warnings.push(`Requested risk is ${pct.toFixed(1)}% of account balance — this exceeds conservative risk limits (commonly 1–2%). The risk amount was NOT modified.`);
  }
  return plan;
}
