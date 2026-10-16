# Chord Stable Peg Monitor

Prices every dollar stablecoin on a chain at trade size through Chord's router and buys a depeg under 0.996.

An example agent built on [Chord](https://getchord.xyz), the trading API and on-chain data index for agents. Paper by default. Not financial advice.

## Run it

Node 20.12 or newer. Nothing to install and no key for paper mode.

```bash
git clone https://github.com/tuantqse90/chord-stable-peg-monitor
cd chord-stable-peg-monitor
node index.js                    # one cycle on bnb
node index.js --chain arbitrum   # another chain
node index.js --loop             # every 5 min (--interval <seconds> to change)
```

The report prints to the terminal and is saved to `state/report.md`.

## What it does each cycle

1. Lists the chain's dollar stablecoins: its own $1 anchors first, then the most traded look-alikes on the board (tokens Chord's scam screen hides are skipped).
2. Quotes a real round trip for each through Chord's router at `MAX_TRADE_USD`: main stable to S (the ask) and S back (the bid).
3. Marks anything priced outside $0.95 to $1.05 as not a $1 token on this chain, and anything with more price impact than `MAX_PRICE_IMPACT_PCT` as too thin.
4. Buys a stable whose executable ask is under 0.996 and sells when the bid is back at 0.999 (stop under 0.97, time stop after 7 days).

## Sample run (16 October 2026, paper)

```text
# Stable Peg Monitor on Avalanche C-Chain, 2026-10-16T14:28:41.173Z
6 stables priced against USDC at $25.00 through Chord's router. Status: **every stable is inside the peg band**
Rule: buy when the executable ask is under 0.996, sell when the bid is 0.999 or more, stop under 0.97.

| Stable | Route | Ask (USDC per 1) | Bid | Round trip | Impact | Signal |
| --- | --- | --- | --- | --- | --- | --- |
| USDt | pangolin_v3+uniswap_v4+uniswap_v4+pharaoh_v3 | 0.9989 | 0.9988 | -0.003% | 0% | on peg |
| USDC.e | lfj | 1.0003 | 1.0001 | -0.020% | 0% | on peg |
| USDT.e | lfj_v21 | 0.9980 | 0.9976 | -0.040% | 0% | on peg |
| USDe | uniswap_v3 | 1.0003 | 0.9993 | -0.100% | 0% | on peg |
| AUSD | pharaoh_dlmm | 1.0001 | 0.9999 | -0.010% | 0% | on peg |
| BUSD | uniswap_v3+lfj_v1+uniswap_v3+pangolin_v2 | 1.0376 | 0.9494 | -8.502% | 5.7688% | too thin at this size |

Entries this cycle: none
Book: PAPER · open 0 · unrealized $0.00 · realized $0.00 · equity $1000.00
```

## Chains

Ethereum, Base, Arbitrum, BNB Chain, Avalanche, Monad, Robinhood and Arc (keys `ethereum`, `base`, `arbitrum`, `bnb`, `avalanche`, `monad`, `robinhood`, `arc`). Pick one with `CHAIN=` in `.env` or `--chain`.

## Settings

Copy `.env.example` to `.env`. Every setting is optional.

| Variable | Default | What it does |
| --- | --- | --- |
| `CHAIN` | `bnb` | Chain key or id. |
| `LIVE` | `0` | 1 = sign and send real transactions with your key. Anything else = paper. |
| `PRIVATE_KEY` | — | Live only. A fresh hot wallet with small funds; the key never leaves this machine. |
| `RPC_URL` | — | Live only. Your RPC endpoint for the chain; transactions are dry-run and sent through it. |
| `MAX_TRADE_USD` | `25` | Largest single entry. |
| `MAX_OPEN_POSITIONS` | `5` | Entries are refused above this. |
| `MAX_SLIPPAGE_BPS` | `100` | Slippage sent with every quote (100 = 1%). |
| `MAX_PRICE_IMPACT_PCT` | `1.5` | Quotes with more price impact are refused. |
| `DAILY_LOSS_LIMIT_USD` | `50` | No new entries for the rest of the UTC day once realized losses reach this. |
| `PAPER_BANKROLL_USD` | `1000` | Starting cash of the paper book. |
| `CHORD_API` | `https://api.getchord.xyz/v1` | Chord API base URL. |
| `CHORD_API_KEY` | — | Optional. Not needed for anything this agent calls. |
| `CHORD_RPM` | `50` | Client-side request cap per minute (anonymous callers get 60 per IP). |

## Paper and live

**Paper (default).** Every quote is a real route from Chord's router; the fill is simulated at the quoted output, after Chord's fee. The book lives in `state/`.

**Live.** Set `LIVE=1`, `PRIVATE_KEY` and `RPC_URL`, then `npm install` (adds `viem`). Each trade goes: Chord quote → unsigned transaction from Chord (`POST /v1/swap`) → approval of Chord's router if needed → dry run on your RPC → your key signs → send → measure the tokens that actually arrived. Chord never takes custody of keys or funds.

Every entry passes the same risk gate: `MAX_TRADE_USD`, `MAX_OPEN_POSITIONS`, `MAX_PRICE_IMPACT_PCT` and `DAILY_LOSS_LIMIT_USD`. Use a fresh wallet with small funds: the cash leg is the chain's main dollar stablecoin, plus a little native coin for gas.

## Built on Chord

Chord calls this agent makes:

- the token board
- `GET /v1/quote` and, in live mode, `POST /v1/swap`

No key is needed: anonymous callers get 60 requests a minute per IP, and the client in `lib/chord.js` stays under that, caches reads briefly and backs off on 429.

- Docs and OpenAPI: https://getchord.xyz/docs
- Hosted MCP server for LLM agents (quotes, unsigned swaps, token boards, trades, wallet PnL; no key): `https://api.getchord.xyz/v1/mcp`. In Claude Code: `claude mcp add --transport http chord https://api.getchord.xyz/v1/mcp`
- More templates: https://github.com/tuantqse90/chord-agent-templates

## Files

```text
index.js          the agent
lib/chord.js      Chord client: rate limit, cache, chain paths from GET /v1/chains
lib/portfolio.js  paper / live book, risk gate, exits
lib/wallet.js     your key and RPC (live mode only)
lib/config.js     settings from .env
lib/util.js       formatting, --loop runner
```

## Disclaimer

Example code, not financial advice. Backtests and paper results do not predict real results. In live mode this program signs real transactions with your key and can lose money.

## License

MIT
