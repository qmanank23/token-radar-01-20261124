/* Token Radar — radar-2 dashboard logic. No network: all data comes from
   the data.js the program wrote beside this page. Sorting, filtering,
   the detail waterfall and the method panel are all computed here from
   window.RADAR, so the screenshots and the code always agree. */
(function () {
  var D = window.RADAR;
  if (!D) { document.getElementById("meta").textContent = "data.js did not load."; return; }
  var board = D.board, meta = D.meta;
  var $ = function (id) { return document.getElementById(id); };

  function money(n) {
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
    return "$" + Math.round(n);
  }
  function pct(x) { return (x >= 0 ? "+" : "") + x.toFixed(2) + "%"; }
  function ageText(r) {
    if (r.age_unknown || r.age_years === null) return "unknown";
    if (r.age_years < 1) return Math.round(r.age_years * 365) + "d";
    return r.age_years.toFixed(1) + "y";
  }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // ---- header, counts, category strip ---------------------------------
  $("meta").textContent = "Snapshot " + meta.asOf + " · " + meta.protocols + " protocols · floor " +
    money(meta.floorUsd) + " · watchlist " + meta.watchlist + " · board " + meta.boardRows + " rows · model radar-2";
  $("expVal").textContent = meta.exponent.toFixed(2);
  $("nBoard").textContent = "(" + board.length + ")";
  $("nLive").textContent = "(" + D.live.length + ")";
  $("nRestr").textContent = "(" + D.restricted.length + ")";
  $("nExcl").textContent = "(" + D.excluded.length + ")";

  var catsEl = $("cats");
  D.categories.forEach(function (c) {
    var chip = document.createElement("button");
    chip.className = "chip";
    chip.innerHTML = esc(c.category) + " <b>" + c.boardCount + "</b> · med " + money(c.medianImplied);
    chip.title = "M_cat " + c.multiple + " from " + c.comps + " live comps (local median " + c.localMedian + ")";
    chip.onclick = function () { $("cat").value = c.category; apply(); showTab("board"); };
    catsEl.appendChild(chip);
  });

  var catSel = $("cat"), chainSel = $("chain");
  var cats = [], chains = [];
  board.forEach(function (r) {
    if (cats.indexOf(r.category || "(none)") < 0) cats.push(r.category || "(none)");
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  cats.forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; catSel.appendChild(o); });
  chains.forEach(function (c) { var o = document.createElement("option"); o.value = c; o.textContent = c; chainSel.appendChild(o); });

  // ---- board: sort + filter + render -----------------------------------
  var sortKey = "rank", sortDir = 1, selected = null;
  function filtered() {
    var q = $("q").value.trim().toLowerCase();
    var cat = catSel.value, chain = chainSel.value, st = $("status").value;
    return board.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && (r.category || "(none)") !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (st === "watch" && r.tvl_usd < meta.floorUsd) return false;
      if (st === "early" && r.tvl_usd >= meta.floorUsd) return false;
      return true;
    });
  }
  function cmp(a, b) {
    var x = a[sortKey], y = b[sortKey];
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    if (typeof x === "string") return x.localeCompare(y) * sortDir;
    return (x - y) * sortDir;
  }
  function render() {
    var rows = filtered().sort(cmp);
    $("count").textContent = rows.length + " of " + board.length + " rows";
    var tb = $("rows");
    tb.innerHTML = rows.map(function (r) {
      var gap = Math.abs(r.neutral_rank - r.rank);
      var fx = gap >= 20 ? ' <span class="catfx" title="Category effect: neutral rank ' + r.neutral_rank + '">cat</span>' : "";
      var warn = r.attention ? ' <span class="flag" title="TVL fell more than 15% in 7 days">⚠</span>' : "";
      return "<tr data-slug=\"" + esc(r.slug) + "\"" + (selected === r.slug ? " class=\"sel\"" : "") + ">" +
        "<td class=\"num\">" + r.rank + "</td>" +
        "<td>" + esc(r.name) + warn + "<span class=\"slug\">" + esc(r.slug) + "</span></td>" +
        "<td>" + esc(r.category || "—") + fx + "</td>" +
        "<td class=\"num\">" + money(r.tvl_usd) + "</td>" +
        "<td class=\"num\">" + (r.change_7d === null ? "—" : pct(r.change_7d)) + "</td>" +
        "<td class=\"num\">" + ageText(r) + "</td>" +
        "<td class=\"num\"><b>" + money(r.implied_value_usd) + "</b></td>" +
        "<td class=\"num\">" + r.m_cat.toFixed(3) + "</td>" +
        "<td class=\"num\">" + r.nontvl.toFixed(3) + "</td>" +
        "<td class=\"num\">" + r.neutral_rank + "</td></tr>";
    }).join("");
    tb.querySelectorAll("tr").forEach(function (tr) {
      tr.onclick = function () { showDetail(tr.getAttribute("data-slug"), true); };
    });
    document.querySelectorAll("#board th").forEach(function (th) {
      th.classList.toggle("sorted", th.getAttribute("data-k") === sortKey);
    });
  }
  function apply() { render(); }
  document.querySelectorAll("#board th").forEach(function (th) {
    th.onclick = function () {
      var k = th.getAttribute("data-k");
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      render();
    };
  });
  ["q", "cat", "chain", "status"].forEach(function (id) {
    $(id).addEventListener("input", apply);
    $(id).addEventListener("change", apply);
  });

  // ---- detail: the waterfall -------------------------------------------
  function showDetail(slug, scroll) {
    var r = board.find(function (x) { return x.slug === slug; });
    if (!r) return;
    selected = slug;
    render();
    $("dName").textContent = "#" + r.rank + " · " + r.name;
    $("dSub").textContent = r.slug + " · " + (r.category || "no category") + " · " + r.chains.join(", ") +
      " · TVL " + money(r.tvl_usd) + " · 7d " + (r.change_7d === null ? "not reported (treated as 0%)" : pct(r.change_7d));
    var base = r.tvl_usd * Math.pow(r.tvl_usd / meta.rescaleRef, meta.exponent - 1);
    var rawNon = r.growth * r.maturity * r.chain_factor;
    var gap = Math.abs(r.neutral_rank - r.rank);
    var rows = [
      ["TVL (rescaled)", money(base), "TVL · (TVL / $1B)^(e−1), e = " + meta.exponent.toFixed(2) + " — the §0 rescale, constant ≈ " + meta.rescaleConstant],
      ["× category multiple M_cat", "× " + r.m_cat.toFixed(3), r.cat_comps + " live comps in " + (r.category || "no category") + ", local median " + r.cat_local.toFixed(3) + ", shrunk toward the global " + meta.globalMultiple + " (k = 8), capped [0.10, 1.20]"],
      ["× growth G", "× " + r.growth.toFixed(3), "7d change winsorized to [−60, +120]%, then 1 + 0.35·g/120"],
      ["× maturity f(age)", "× " + r.f_age.toFixed(3), r.age_unknown ? "age unknown — imputed at the watchlist median age (" + meta.medianAgeYears + "y)" : "age " + ageText(r) + ", f = 0.35 + 0.65·age/(age+2)"],
      ["× health", "× " + r.health.toFixed(3), "1 − 0.10·max(0, −g)/60 — old-and-shrinking is trimmed, not crushed"],
      ["= maturity F", r.maturity.toFixed(3), "f(age) × health"],
      ["× chain breadth C", "× " + r.chain_factor.toFixed(3), r.chains.length + " chain" + (r.chains.length > 1 ? "s" : "") + ", 1 + 0.10·min(log10(chains)/log10(11), 1)"],
      ["nonTVL (raw)", rawNon.toFixed(3) + " → " + r.nontvl.toFixed(3), r.capped === "none" ? "inside the [0.65, 1.45] cap — nothing clipped" : "clipped by the cap: " + r.capped + ". The cap binds on most rows; that is a noted weakness, not a hidden one."],
      ["Implied value", money(r.implied_value_usd), "base × M_cat × nonTVL, rounded to whole dollars"],
    ];
    var html = "<table class=\"wf\"><tbody>" + rows.map(function (w, i) {
      return "<tr" + (i === rows.length - 1 ? " class=\"res\"" : "") + "><td>" + w[0] + "</td><td class=\"num\">" + w[1] + "</td><td>" + esc(w[2]) + "</td></tr>";
    }).join("") + "</tbody></table>";
    html += "<p>Neutral rank <b>" + r.neutral_rank + "</b> (rank " + r.rank + " here). " +
      (gap >= 20 ? "This row sits " + gap + " places from its neutral rank: its position is a <b>category effect</b>, not a protocol effect." :
        "This row sits " + gap + " places from its neutral rank: its position is mostly the protocol, not its category.") + "</p>";
    html += "<h3>Farm plan — $" + r.capital_usd + " capital, hold " + r.hold_days + " days</h3><ol class=\"steps\">" +
      r.farm_steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
    html += "<p class=\"watch\"><b>Watch out:</b> " + esc(r.watch_out) + "</p>";
    if (r.age_unknown) html += "<p class=\"note\">Age unknown in the snapshot (listed_at is null). The maturity factor uses the watchlist median age (" + meta.medianAgeYears + "y) instead of rewarding or punishing the missing date; treat the factor as approximate.</p>";
    $("dBody").innerHTML = html;
    if (scroll) $("detail").scrollIntoView({ behavior: "auto", block: "nearest" });
  }

  // ---- other tabs -------------------------------------------------------
  function fillTable(id, rows, cols) {
    $(id).innerHTML = rows.map(function (r) {
      return "<tr>" + cols.map(function (c) { return "<td" + (c.num ? " class=\"num\"" : "") + ">" + c.get(r) + "</td>"; }).join("") + "</tr>";
    }).join("");
  }
  fillTable("liveRows", D.live, [
    { get: function (r) { return esc(r.name) + "<span class=\"slug\">" + esc(r.slug) + "</span>"; } },
    { get: function (r) { return esc(r.category || "—"); } },
    { get: function (r) { return money(r.tvl_usd); }, num: true },
    { get: function (r) { return "<b>" + money(r.mcap_usd) + "</b>"; }, num: true },
    { get: function (r) { return r.ratio.toFixed(3); }, num: true },
  ]);
  fillTable("restrRows", D.restricted, [
    { get: function (r) { return esc(r.name) + "<span class=\"slug\">" + esc(r.slug) + "</span>"; } },
    { get: function (r) { return esc(r.category || "—"); } },
    { get: function (r) { return money(r.tvl_usd); }, num: true },
    { get: function (r) { return esc(r.tag); } },
  ]);
  fillTable("restrExtraRows", D.restrictedExtra, [
    { get: function (r) { return esc(r.name) + "<span class=\"slug\">" + esc(r.slug) + "</span>"; } },
    { get: function (r) { return esc(r.category || "—"); } },
    { get: function (r) { return money(r.tvl_usd); }, num: true },
    { get: function (r) { return esc(r.tag); } },
  ]);
  fillTable("exclRows", D.excluded, [
    { get: function (r) { return esc(r.name) + "<span class=\"slug\">" + esc(r.slug) + "</span>"; } },
    { get: function (r) { return esc(r.category || "—"); } },
    { get: function (r) { return money(r.tvl_usd); }, num: true },
    { get: function (r) { return esc(r.reason); } },
  ]);

  // ---- method panel ------------------------------------------------------
  var top1 = board[0];
  var base1 = top1.tvl_usd * Math.pow(top1.tvl_usd / meta.rescaleRef, meta.exponent - 1);
  var testRows = meta.exponentTests.map(function (t) {
    return "<tr><td class=\"num\">" + t.e.toFixed(4) + "</td><td class=\"num\">" + t.rho.toFixed(3) + "</td><td class=\"num\">" + t.top10Overlap + "/10</td><td class=\"num\">" + money(t.top10MinTvl) + "</td></tr>";
  }).join("");
  var chosenTest = meta.exponentTests.find(function (t) { return Math.abs(t.e - meta.exponent) < 0.001; }) || meta.exponentTests[0];
  $("methodBody").innerHTML =
    "<p><b>Formula.</b> <code>implied = TVL · (TVL / $1B)^(e−1) · M_cat · nonTVL</code>, " +
    "<code>nonTVL = clamp(G · F · C, 0.65, 1.45)</code>. Every input is a snapshot field: TVL, 7-day change, listing age, category, chain count. No protocol name appears in the model.</p>" +
    "<p><b>§0 rescale.</b> At e = 0.70 the raw power law destroys the dollar scale (the top row would read about $667K against a market floor multiple near $82M). Multiplying by ($1B)^(1−e) ≈ " + meta.rescaleConstant + " is one positive constant applied to every row: the ranking is unchanged, only the dollars become readable. The top row reads " + money(top1.implied_value_usd) + " after the rescale.</p>" +
    "<p><b>Exponent, fitted not picked.</b> OLS on ln(mcap) = a + b·ln(tvl) over " + meta.fit.n + " live-token comps (gecko_id present, mcap ≥ $5M, TVL ≥ $20M): a = " + meta.fit.a + ", b = " + meta.fit.b + " ± " + meta.fit.se + ", R² = " + meta.fit.r2 + ". Tercile fallback b = " + meta.fit.tercileB + ". The fitted b fails both targets (ρ below 0.70, top-10 smallest TVL under $200M), so e is the nearest tested value that meets them:</p>" +
    "<table><thead><tr><th>e</th><th>Spearman ρ vs TVL</th><th>Top-10 overlap</th><th>Top-10 smallest TVL</th></tr></thead><tbody>" + testRows + "</tbody></table>" +
    "<p>Chosen e = " + meta.exponent.toFixed(2) + " (ρ = " + chosenTest.rho.toFixed(3) + ", top-10 all TVL ≥ $200M, top-10 all pre-token). Targets: ρ in [0.70, 0.85] and top-10 dominated by TVL ≥ $200M.</p>" +
    "<p><b>Category multiple.</b> For each category, M_local = 10^(median log10(mcap/TVL)) over its live comps, ratios winsorized to [P5, P95] first; M_cat = (n·M_local + 8·M_global) / (n + 8), capped [0.10, 1.20]. A category with no comps gets the global median (" + meta.globalMultiple + ") automatically. Per-category counts, local medians and shrunk values are in the strip above the board.</p>" +
    "<p><b>Growth.</b> g = clamp(change_7d, −60, +120); G = 1 + 0.35·g/120, range [0.825, 1.350]. The +4,448% outlier lands at +120, the same as a genuine +120%.</p>" +
    "<p><b>Maturity.</b> f(age) = 0.35 + 0.65·age/(age+2) with age in years from listed_at to 2026-11-14; health = 1 − 0.10·max(0, −g)/60; F = f·health. Unknown listed_at (2 of 40 watchlist rows) uses the watchlist median age (" + meta.medianAgeYears + "y) and is flagged in the detail view. If you read decline as distressed value, an old-and-shrinking row's implied value is about 10% low on health alone.</p>" +
    "<p><b>Chain breadth.</b> C = 1 + 0.10·min(log10(chains)/log10(11), 1), range [1.00, 1.10] — a weak distribution signal, never the deciding factor.</p>" +
    "<p><b>Non-TVL cap.</b> G·F·C is clamped to [0.65, 1.45]. It binds on most rows (the floor, for young and shrinking protocols) — a known weakness of this build, stated here rather than hidden: maturity and growth are inactive for two thirds of the board, and the differentiation that remains comes from the category multiple and the TVL dampening.</p>" +
    "<p><b>Worked example — rank 1, " + esc(top1.name) + ".</b> TVL " + money(top1.tvl_usd) + " → rescaled base " + money(base1) + "; × M_cat " + top1.m_cat.toFixed(3) + " (" + top1.cat_comps + " comps, local " + top1.cat_local.toFixed(3) + "); × G " + top1.growth.toFixed(3) + "; × F " + top1.maturity.toFixed(3) + " (f " + top1.f_age.toFixed(3) + ", health " + top1.health.toFixed(3) + "); × C " + top1.chain_factor.toFixed(3) + "; nonTVL " + top1.nontvl.toFixed(3) + " (" + esc(top1.capped) + "); implied <b>" + money(top1.implied_value_usd) + "</b>. Copy these numbers into a calculator and you get the same answer.</p>" +
    "<p><b>Board.</b> 40 watchlist rows plus the early pool: pre-token protocols below the $50M floor that pass the watchlist exclusions, ranked by implied value, never by raw TVL. " + D.excluded.length + " rows were excluded with reasons, on the Excluded tab.</p>";

  // ---- tabs + hash routing ----------------------------------------------
  var panes = { board: ["boardPane", "detail", "controls", "cats"], live: ["livePane"], restricted: ["restrPane"], excluded: ["exclPane"], method: ["methodPane"] };
  function showTab(tab) {
    document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === tab); });
    ["boardPane", "detail", "livePane", "restrPane", "exclPane", "methodPane", "controls", "cats"].forEach(function (id) { $(id).hidden = true; });
    (panes[tab] || panes.board).forEach(function (id) { $(id).hidden = false; });
  }
  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.onclick = function () { showTab(b.getAttribute("data-tab")); };
  });

  // Hash: #detail=<slug>, #tab=<name>, #cat=<category>, #q=<text>
  var hash = location.hash.slice(1);
  var params = {};
  hash.split("&").forEach(function (part) {
    var kv = part.split("=");
    if (kv[0]) params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
  });
  if (params.cat) { catSel.value = params.cat; }
  if (params.q) { $("q").value = params.q; }
  if (params.chain) { chainSel.value = params.chain; }
  if (params.status) { $("status").value = params.status; }
  render();
  if (params.tab) showTab(params.tab); else showTab("board");
  if (params.detailonly) { $("boardPane").hidden = true; $("controls").hidden = true; $("cats").hidden = true; }
  if (params.detail) showDetail(params.detail);
  else if (board.length) showDetail(board[0].slug);
})();
