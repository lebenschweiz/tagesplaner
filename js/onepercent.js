/* Reiter „1 %“: die Kernideen aus „Die 1%-Methode“ (James Clear) in eigenen Worten,
   mit interaktiver Zinseszins-Kurve, Plateau-Grafik und den vier Gesetzen zum Umschalten. */

const fmt = (n, d = 1) => n.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });

const LAWS = [
  { n: 1, key: "offensichtlich", phase: "Auslösereiz", color: "var(--gold)",
    build: { title: "Mach es offensichtlich", tips: [
      ["Konkreter Plan", "„Ich mache [Gewohnheit] um [Uhrzeit] in/am [Ort].“ Wer Zeit und Ort festlegt, muss nicht mehr auf Motivation warten."],
      ["Gewohnheiten koppeln", "„Nach [bestehende Gewohnheit] mache ich [neue Gewohnheit].“ Die alte Routine wird zum Startsignal."],
      ["Umfeld gestalten", "Lege die Auslöser für gute Gewohnheiten dorthin, wo du sie nicht übersehen kannst."] ] },
    stop: { title: "Mach es unsichtbar", tips: [
      ["Auslöser entfernen", "Was du nicht siehst, löst kein Verlangen aus. Handy in ein anderes Zimmer, Süsses aus dem Blickfeld."] ] } },
  { n: 2, key: "attraktiv", phase: "Verlangen", color: "var(--eve)",
    build: { title: "Mach es attraktiv", tips: [
      ["Bündeln", "Verbinde etwas, das du tun musst, mit etwas, das du tun willst. Zum Beispiel Lieblingspodcast nur beim Training."],
      ["Die richtige Gruppe", "Umgib dich mit Menschen, bei denen dein Wunschverhalten ganz normal ist."],
      ["Motivationsritual", "Tu direkt vor einer schwierigen Gewohnheit etwas, das dir Freude macht."] ] },
    stop: { title: "Mach es unattraktiv", tips: [
      ["Blickwinkel ändern", "Führe dir vor Augen, was du gewinnst, wenn du die schlechte Gewohnheit lässt."] ] } },
  { n: 3, key: "einfach", phase: "Reaktion", color: "var(--day)",
    build: { title: "Mach es einfach", tips: [
      ["Reibung senken", "Je weniger Schritte zwischen dir und der guten Gewohnheit liegen, desto öfter passiert sie."],
      ["Zwei-Minuten-Regel", "Schrumpfe die Gewohnheit, bis sie in höchstens zwei Minuten erledigt ist. Erst anfangen, dann ausbauen."],
      ["Automatisieren", "Einmalige Entscheidungen (Dauerauftrag, bessere Matratze, kleinere Teller) wirken jeden Tag von selbst."] ] },
    stop: { title: "Mach es schwierig", tips: [
      ["Reibung erhöhen", "Baue zusätzliche Schritte vor die schlechte Gewohnheit, zum Beispiel Apps abmelden oder den Fernseher ausstecken."],
      ["Selbstbindung", "Triff heute eine Entscheidung, die dir später nur noch gute Optionen lässt."] ] } },
  { n: 4, key: "befriedigend", phase: "Belohnung", color: "var(--ok)",
    build: { title: "Mach es befriedigend", tips: [
      ["Sofort belohnen", "Gönn dir direkt nach der Gewohnheit eine kleine Belohnung. Was sich gut anfühlt, wird wiederholt."],
      ["Tracker führen", "Ein Häkchen pro Tag macht Fortschritt sichtbar, und die Serie will niemand abreissen lassen."],
      ["Nie zweimal auslassen", "Ein verpasster Tag ist ein Ausrutscher. Zwei sind der Anfang einer neuen Gewohnheit."] ] },
    stop: { title: "Mach es unbefriedigend", tips: [
      ["Rechenschaftspartner", "Jemand, der zuschaut, macht das Ausweichen sofort unangenehm."],
      ["Gewohnheitsvertrag", "Schreib auf, was passiert, wenn du rückfällig wirst, und lass es jemanden unterschreiben."] ] } }
];

const LOOP = [
  ["Auslösereiz", "Etwas fällt dir auf.", "Das Handy vibriert."],
  ["Verlangen", "Du willst den Zustand ändern.", "Du willst wissen, wer schreibt."],
  ["Reaktion", "Die eigentliche Gewohnheit.", "Du greifst zum Handy."],
  ["Belohnung", "Das Verlangen ist gestillt.", "Neugier befriedigt, das Gehirn merkt sich: Vibration = greifen."]
];

function compoundSvg(p) {
  const W = 640, H = 260, L = 40, R = 16, T = 16, B = 30, days = 365;
  const up = d => Math.pow(1 + p / 100, d), down = d => Math.pow(1 - p / 100, d);
  const max = Math.max(2, up(days));
  const x = d => L + (d / days) * (W - L - R), y = v => T + (1 - v / max) * (H - T - B);
  const path = f => { let s = ""; for (let d = 0; d <= days; d += 3) s += (d ? "L" : "M") + x(d).toFixed(1) + " " + y(f(d)).toFixed(1); return s; };
  const ticks = [0, 90, 180, 270, 365].map(d => `<text x="${x(d)}" y="${H - 10}" text-anchor="middle">${d === 0 ? "Start" : d === 365 ? "1 Jahr" : d + " T."}</text>`).join("");
  const step = max > 20 ? 10 : max > 8 ? 2 : 1;
  let grid = ""; for (let v = 0; v <= max; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}×</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="op-chart" role="img" aria-label="Kurve: ${fmt(p)} % besser pro Tag ergibt nach einem Jahr das ${fmt(up(days))}-fache, ${fmt(p)} % schlechter ergibt ${fmt(down(days), 2)}">
    <g class="op-grid">${grid}</g>
    <line class="op-base" x1="${L}" x2="${W - R}" y1="${y(1)}" y2="${y(1)}"/>
    <path class="op-down" d="${path(down)}"/>
    <path class="op-up" d="${path(up)}"/>
    <circle class="op-up-dot" cx="${x(days)}" cy="${y(up(days))}" r="5"/>
    <circle class="op-down-dot" cx="${x(days)}" cy="${y(down(days))}" r="5"/>
    <g class="op-ticks">${ticks}</g>
  </svg>`;
}

function plateauSvg() {
  const W = 640, H = 260, L = 24, R = 16, T = 20, B = 30;
  const x = t => L + t * (W - L - R), y = v => T + (1 - v) * (H - T - B);
  const exp = t => (Math.exp(3.2 * t) - 1) / (Math.exp(3.2) - 1);
  const lin = t => t * 0.78;
  let a = "", b = "", gap = "";
  for (let i = 0; i <= 100; i++) { const t = i / 100; a += (i ? "L" : "M") + x(t).toFixed(1) + " " + y(lin(t)).toFixed(1); b += (i ? "L" : "M") + x(t).toFixed(1) + " " + y(exp(t)).toFixed(1); }
  // Tal der Enttäuschung: Fläche zwischen Erwartung und Wirklichkeit bis zum Schnittpunkt
  let cross = 0.9; for (let i = 5; i <= 100; i++) if (exp(i / 100) >= lin(i / 100)) { cross = i / 100; break; }
  let top = "", bot = "";
  for (let i = 0; i <= cross * 100; i++) { const t = i / 100; top += (i ? "L" : "M") + x(t).toFixed(1) + " " + y(lin(t)).toFixed(1); bot = "L" + x(t).toFixed(1) + " " + y(exp(t)).toFixed(1) + bot; }
  gap = top + bot + "Z";
  return `<svg viewBox="0 0 ${W} ${H}" class="op-chart" role="img" aria-label="Erwartet wird linearer Fortschritt. Tatsächlich passiert lange wenig, dann geht es steil nach oben. Die Lücke dazwischen ist das Tal der Enttäuschung.">
    <path class="op-gap" d="${gap}"/>
    <line class="op-axis" x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}"/>
    <line class="op-axis" x1="${L}" x2="${L}" y1="${T}" y2="${y(0)}"/>
    <path class="op-expect" d="${a}"/>
    <path class="op-up" d="${b}"/>
    <circle class="op-up-dot" cx="${x(cross)}" cy="${y(exp(cross))}" r="5"/>
    <g class="op-ticks">
      <text x="${x(0.45)}" y="${y(0.22)}" text-anchor="middle" class="op-gap-label">Tal der Enttäuschung</text>
      <text x="${x(0.62)}" y="${y(0.62)}" text-anchor="end">Was du erwartest</text>
      <text x="${x(0.93)}" y="${y(0.95)}" text-anchor="end" class="op-up-label">Was tatsächlich passiert</text>
      <text x="${x(cross) + 10}" y="${y(exp(cross)) + 18}">Durchbruch</text>
      <text x="${W - R}" y="${H - 10}" text-anchor="end">Zeit</text>
      <text x="${L + 6}" y="${T + 4}">Ergebnis</text>
    </g>
  </svg>`;
}

function lawsHtml(mode) {
  return LAWS.map(l => {
    const s = l[mode];
    return `<article class="op-law" style="--lc:${l.color}">
      <div class="op-law-head"><span class="op-law-n">${l.n}</span><div><h3>${s.title}</h3><span class="sub">Phase: ${l.phase}</span></div></div>
      <ul>${s.tips.map(([h, t]) => `<li><b>${h}.</b> ${t}</li>`).join("")}</ul>
    </article>`;
  }).join("");
}

export function createOnePercent({ root, onNav }) {
  let built = false, mode = "build";

  function build() {
    root.innerHTML = `
    <section class="op-hero">
      <p class="label spaced op-kicker">Aus dem Buch „Die 1%-Methode“</p>
      <h1>Täglich 1 % besser.</h1>
      <p class="op-lead">Grosse Veränderungen entstehen nicht durch einen grossen Moment, sondern durch kleine Gewohnheiten, die sich wie Zinseszins aufsummieren. Hier sind die wichtigsten Ideen, kurz und zum Anwenden.</p>
      <div class="op-big">
        <div class="op-num up"><b>37,8×</b><span>1 % besser, jeden Tag, ein Jahr lang</span><small>1,01<sup>365</sup></small></div>
        <div class="op-num down"><b>0,03</b><span>1 % schlechter, jeden Tag, ein Jahr lang</span><small>0,99<sup>365</sup></small></div>
      </div>
    </section>

    <section class="card op-sec">
      <h2 class="label">1 · Gewohnheiten sind Zinseszins</h2>
      <p>Ein einzelner Tag fühlt sich nach nichts an. Aber jede Wiederholung baut auf der vorherigen auf, im Guten wie im Schlechten. Zieh am Regler und sieh, was kleine Unterschiede über ein Jahr ausmachen.</p>
      <div class="op-slider">
        <label for="opPct">Pro Tag</label>
        <input type="range" id="opPct" min="0.1" max="2" step="0.1" value="1">
        <output id="opPctOut">1,0 %</output>
      </div>
      <div id="opCompound"></div>
      <div class="op-legend"><span class="up">besser: <b id="opUp"></b></span><span class="down">schlechter: <b id="opDown"></b></span></div>
    </section>

    <section class="card op-sec">
      <h2 class="label">2 · Das Plateau durchstehen</h2>
      <p>Wir erwarten, dass Fortschritt gleichmässig kommt. In Wirklichkeit passiert lange scheinbar nichts. Die Arbeit ist aber nicht verloren, sie wird gespeichert. Wie Eis, das von −5 auf −1 Grad nichts zeigt und bei 0 Grad plötzlich schmilzt.</p>
      ${plateauSvg()}
      <p class="op-takeaway">Wer im Tal der Enttäuschung aufgibt, verpasst genau den Moment, in dem es sich auszuzahlen beginnt.</p>
    </section>

    <div class="op-two">
      <section class="card op-sec">
        <h2 class="label">3 · Systeme statt Ziele</h2>
        <p>Gewinner und Verlierer haben oft dieselben Ziele. Der Unterschied liegt im System, also in dem, was man jeden Tag tut.</p>
        <div class="op-vs">
          <div><span class="sub">Ziel</span><b>Das Ergebnis, das du willst</b><span>„Ich will einen Halbmarathon laufen.“</span></div>
          <div class="sys"><span class="sub">System</span><b>Der Weg, der dorthin führt</b><span>„Ich laufe Di, Do und Sa um 6:30.“</span></div>
        </div>
        <p class="op-takeaway">Ziele geben die Richtung. Systeme bringen dich voran. Verliebe dich in den Prozess, nicht nur ins Ergebnis.</p>
      </section>

      <section class="card op-sec">
        <h2 class="label">4 · Bei der Identität anfangen</h2>
        <div class="op-onion">
          <svg viewBox="0 0 220 220" aria-hidden="true">
            <circle cx="110" cy="110" r="104" class="r1"/><circle cx="110" cy="110" r="70" class="r2"/><circle cx="110" cy="110" r="36" class="r3"/>
            <text x="110" y="24" text-anchor="middle">Resultate</text><text x="110" y="58" text-anchor="middle">Prozesse</text><text x="110" y="114" text-anchor="middle" class="core">Identität</text>
          </svg>
          <div>
            <p>Veränderung hat drei Schichten. Die meisten starten aussen bei dem, was sie <b>erreichen</b> wollen. Nachhaltiger ist es, innen anzufangen: bei dem, wer du <b>sein</b> willst.</p>
            <p class="op-quote">Nicht „Ich will rauchfrei werden“, sondern „Ich bin kein Raucher“.</p>
            <p>Jede Handlung ist eine Stimme für die Person, die du werden willst. Du brauchst keine Einstimmigkeit, nur eine Mehrheit.</p>
          </div>
        </div>
      </section>
    </div>

    <section class="card op-sec">
      <h2 class="label">5 · So funktioniert jede Gewohnheit</h2>
      <p>Jede Gewohnheit durchläuft dieselben vier Schritte, immer in derselben Reihenfolge. Das Beispiel zeigt, warum der Griff zum Handy so automatisch passiert.</p>
      <ol class="op-loop">${LOOP.map(([h, d, ex], i) => `<li style="--lc:${LAWS[i].color}"><span class="op-law-n">${i + 1}</span><b>${h}</b><span>${d}</span><small>${ex}</small></li>`).join("")}</ol>
    </section>

    <section class="op-sec op-laws-sec">
      <div class="op-laws-head">
        <div><h2>Die vier Gesetze</h2><p class="sub">Zu jedem Schritt gehört ein Hebel. Umgedreht helfen dieselben Hebel, schlechte Gewohnheiten loszuwerden.</p></div>
        <div class="moods" role="group" aria-label="Ansicht der Gesetze">
          <button type="button" data-opm="build" aria-pressed="true">Gute aufbauen</button>
          <button type="button" data-opm="stop" aria-pressed="false">Schlechte abstellen</button>
        </div>
      </div>
      <div class="op-laws" id="opLaws">${lawsHtml(mode)}</div>
    </section>

    <div class="op-two">
      <section class="card op-sec">
        <h2 class="label">6 · Die Zwei-Minuten-Regel</h2>
        <p>Eine neue Gewohnheit sollte am Anfang weniger als zwei Minuten dauern. Es geht darum, das Erscheinen zur Routine zu machen. Eine Gewohnheit, die es nicht gibt, kann man nicht verbessern.</p>
        <ul class="op-ladder">
          <li><span>Marathon laufen</span><small>sehr schwer</small></li>
          <li><span>5 km laufen</span><small>schwer</small></li>
          <li><span>10 Minuten gehen</span><small>mittel</small></li>
          <li class="go"><span>Laufschuhe anziehen</span><small>2 Minuten, hier anfangen</small></li>
        </ul>
      </section>
      <section class="card op-sec">
        <h2 class="label">7 · Dranbleiben</h2>
        <dl class="op-rules">
          <dt>Nie zweimal hintereinander auslassen</dt><dd>Perfekt muss es nicht sein. Nach einem verpassten Tag sofort zurück in die Spur.</dd>
          <dt>Goldlöckchen-Regel</dt><dd>Am motiviertesten sind wir bei Aufgaben, die knapp an der Grenze unseres Könnens liegen. Nicht zu leicht, nicht zu schwer.</dd>
          <dt>Langeweile ist der Gegner</dt><dd>Profis halten sich an den Plan, auch wenn es eintönig wird. Darin liegt der eigentliche Unterschied.</dd>
          <dt>Regelmässig zurückschauen</dt><dd>Automatische Gewohnheiten werden nicht von selbst besser. Reflexion verhindert Stillstand.</dd>
        </dl>
      </section>
    </div>

    <section class="card op-sec op-apply">
      <h2 class="label">Im Tagesplaner umsetzen</h2>
      <div class="op-apply-grid">
        <button type="button" class="op-go" data-go="week"><b>Gewohnheits-Tracker</b><span>Jeden Tag abhaken und die Serie nie zweimal reissen lassen.</span></button>
        <button type="button" class="op-go" data-go="day"><b>Tagesplan</b><span>Zeit und Ort festlegen: der konkrete Plan aus Gesetz 1.</span></button>
        <button type="button" class="op-go" data-go="goals"><b>Ziele</b><span>Ziel setzen, dann in Wochen- und Tagesschritte als System herunterbrechen.</span></button>
        <button type="button" class="op-go" data-go="journal"><b>Gedanken</b><span>Regelmässig zurückschauen: Was läuft, was soll sich ändern?</span></button>
      </div>
    </section>
    <p class="sub op-src">Zusammenfassung in eigenen Worten nach James Clear, „Die 1%-Methode. Minimale Veränderung, maximale Wirkung“ (Goldmann).</p>`;

    const pct = root.querySelector("#opPct");
    const draw = () => {
      const p = Number(pct.value);
      root.querySelector("#opPctOut").textContent = fmt(p) + " %";
      root.querySelector("#opCompound").innerHTML = compoundSvg(p);
      root.querySelector("#opUp").textContent = fmt(Math.pow(1 + p / 100, 365)) + "-fach";
      root.querySelector("#opDown").textContent = fmt(Math.pow(1 - p / 100, 365), 2) + "-fach";
    };
    pct.addEventListener("input", draw); draw();

    root.querySelector("[data-opm]").parentElement.addEventListener("click", e => {
      const b = e.target.closest("[data-opm]"); if (!b) return;
      mode = b.dataset.opm;
      root.querySelectorAll("[data-opm]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      root.querySelector("#opLaws").innerHTML = lawsHtml(mode);
      root.querySelector("#opLaws").classList.toggle("stop", mode === "stop");
    });
    root.addEventListener("click", e => { const g = e.target.closest("[data-go]"); if (g) onNav(g.dataset.go); });
    built = true;
  }

  return { show() { if (!built) build(); } };
}
