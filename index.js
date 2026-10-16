// Stable Peg Monitor: prices every dollar stablecoin on a chain against the chain's main stable through Chord's
// router, at trade size and in both directions, and buys one that can be bought under 0.996 (sold back at 0.999).
// The table is the useful part even when nothing trades: executable bid and ask of every stable, not a mid price.
import { CONFIG, STABLE_SYMBOLS } from './lib/config.js';
import { resolveChain, board, quote, mapLimit } from './lib/chord.js';
import { Portfolio } from './lib/portfolio.js';
import { usd, pct, table, writeReport, runAgent } from './lib/util.js';

const P = {
  buyBelow: 0.996,          // executable ask (main stable per S) that counts as a depeg
  sellAt: 0.999,            // executable bid that counts as back on peg
  stopBelow: 0.97,          // a real depeg spiral: cut it
  maxStables: 6,
  pegBand: [0.95, 1.05],    // outside this it is not a $1 token
  maxHoldHours: 24 * 7,
};

async function discoverStables(chain) {
  const rows = new Map();
  for (const a of chain.anchors.filter((x) => x.stableUsd === 1)) rows.set(a.address, { address: a.address, symbol: a.symbol, decimals: a.decimals, anchor: true });
  for (const t of await board(chain, { limit: 200 })) {
    const sym = String(t.symbol || '').toUpperCase();
    if (!STABLE_SYMBOLS.has(sym) || t.screen) continue;
    rows.set(t.address, { ...rows.get(t.address), address: t.address, symbol: t.symbol, decimals: t.decimals, volume24h: t.volume24h });
  }
  rows.delete(chain.stable.address);
  // The chain's own $1 anchors first, then the most traded look-alikes from the board.
  return [...rows.values()].sort((a, b) => Number(Boolean(b.anchor)) - Number(Boolean(a.anchor)) || Number(b.volume24h || 0) - Number(a.volume24h || 0)).slice(0, P.maxStables);
}

// Executable prices at trade size, in main stable per 1 S.
async function probe(chain, s, sizeUsd) {
  const cash = chain.stable;
  const amountIn = BigInt(Math.round(sizeUsd * 1e6)) * 10n ** BigInt(cash.decimals - 6);
  const buy = await quote(chain, { inputMint: cash.address, outputMint: s.address, amount: amountIn });
  if (!buy.routePlan?.length || buy.outputAmount === '0') return { ...s, route: false, reason: buy.noRouteReason || 'no route' };
  const qty = Number(buy.outputAmount) / 10 ** s.decimals;
  const sell = await quote(chain, { inputMint: s.address, outputMint: cash.address, amount: buy.outputAmount });
  const back = sell.routePlan?.length ? Number(sell.outputAmount) / 10 ** cash.decimals : 0;
  return {
    ...s, route: true, qty,
    ask: sizeUsd / qty,
    bid: back ? back / qty : NaN,
    roundTripPct: back ? (back / sizeUsd - 1) * 100 : NaN,
    via: buy.routePlan.map((r) => r.swapInfo?.dex).join('+'),
    impact: Number(buy.priceImpactPct),
  };
}

async function cycle() {
  const chain = await resolveChain(CONFIG.chain || 'bnb');
  const pf = new Portfolio(chain, { name: 'stable-peg' });
  const size = CONFIG.maxTradeUsd;
  const stables = await discoverStables(chain);
  const probes = (await mapLimit(stables, 2, (s) => probe(chain, s, size))).filter((p) => p && !p.__error);
  const pegged = probes.filter((p) => p.route && p.ask >= P.pegBand[0] && p.ask <= P.pegBand[1]);

  for (const pos of pf.positions) {
    const q = await quote(chain, { inputMint: pos.token, outputMint: chain.stable.address, amount: pos.qtyRaw });
    const bid = q.routePlan?.length ? Number(q.outputAmount) / 10 ** chain.stable.decimals / (Number(pos.qtyRaw) / 10 ** pos.decimals) : NaN;
    const ageH = (Date.now() - pos.openedAt) / 3600_000;
    if (bid >= P.sellAt) await pf.sell(pos.token, `back on peg: bid ${bid.toFixed(4)}`);
    else if (bid > 0 && bid < P.stopBelow) await pf.sell(pos.token, `depeg deepening: bid ${bid.toFixed(4)}`);
    else if (ageH >= P.maxHoldHours) await pf.sell(pos.token, `time stop ${ageH.toFixed(0)}h, bid ${bid.toFixed(4)}`);
  }
  const entries = [];
  for (const p of pegged.filter((x) => x.ask < P.buyBelow && Math.abs(x.impact) <= CONFIG.maxPriceImpactPct).sort((a, b) => a.ask - b.ask)) {
    if (await pf.buy({ token: p.address, symbol: p.symbol, decimals: p.decimals, sizeUsd: size, meta: { ask: p.ask } })) entries.push(p.symbol);
  }

  const status = pegged.length === 0 ? `no other stable routes against ${chain.stable.symbol}`
    : pegged.some((p) => p.ask < P.buyBelow) ? 'DEPEG: a stable can be bought under the threshold' : 'every stable is inside the peg band';
  const md = [
    `# Stable Peg Monitor on ${chain.label}, ${new Date().toISOString()}`,
    `${stables.length} stables priced against ${chain.stable.symbol} at ${usd(size)} through Chord's router. Status: **${status}**`,
    `Rule: buy when the executable ask is under ${P.buyBelow}, sell when the bid is ${P.sellAt} or more, stop under ${P.stopBelow}.`,
    '',
    probes.length ? table(['Stable', 'Route', `Ask (${chain.stable.symbol} per 1)`, 'Bid', 'Round trip', 'Impact', 'Signal'],
      probes.map((p) => [p.symbol, p.route ? p.via : `none (${p.reason})`, p.route ? p.ask.toFixed(4) : '—', Number.isFinite(p.bid) ? p.bid.toFixed(4) : '—',
        Number.isFinite(p.roundTripPct) ? pct(p.roundTripPct, 3) : '—', p.route ? `${p.impact}%` : '—',
        !p.route ? '—' : p.ask < P.pegBand[0] || p.ask > P.pegBand[1] ? 'not a $1 token here' : Math.abs(p.impact) > CONFIG.maxPriceImpactPct ? 'too thin at this size' : p.ask < P.buyBelow ? 'BUY' : 'on peg'])) : '_no other stable found_',
    '',
    `Entries this cycle: ${entries.join(', ') || 'none'}`,
    `Book: ${pf.line()}`,
  ].join('\n');
  writeReport('report.md', md);
  console.log(md);
}

if (import.meta.url === `file://${process.argv[1]}`) runAgent('stable-peg-monitor', cycle, 300);
