# token-radar-01-20261124

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/qmanank23/token-radar-01-20261124/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/qmanank23/token-radar-01-20261124/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over a sealed DefiLlama snapshot of 758 protocols. It ranks 178 pre-token protocols by implied launch value — TVL^0.70 × category multiple × growth × maturity × chain breadth — with concrete farm plans (capital tiers, hold days, gas wording) and an offline dashboard. Live-token protocols are shown separately in an "Already trading" view; 258 ambiguous protocols (symbol XOR gecko_id) are flagged and never silently ranked as pre-token.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

Node 22, standard library only. Reads the sealed snapshot (`snapshot.json`), writes the ranked board to `out/board.json`, the dashboard data to `out/data.js`, copies `dashboard/` and `screenshots/` into `out/`, and writes `out/dossier.json`. The run is deterministic: the same snapshot always writes the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
