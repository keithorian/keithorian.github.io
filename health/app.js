/* Public health log. No dependencies. Dates are calendar days; clocks are Singapore (UTC+8). */
(function () {
  const FALLBACK_GOALS = {
    weight_start_kg: 92,
    weight_start_date: "2026-11-18",
    weight_target_kg: 80,
    pace_kg_per_week: 0.5,
    steps_per_day: 10000,
    cardio_min_per_week: 150,
  };

  const ACTIVITIES = {
    houseWork: "Housework",
    walking: "Walking",
    running: "Running",
    yoga: "Yoga",
    pilates: "Pilates",
    cycling: "Cycling",
    dance: "Dance",
    tennis: "Tennis",
    yardwork: "Garden work",
    other: "Other activity",
  };

  const state = { range: 30, doc: null, weights: [] };

  const $ = (id) => document.getElementById(id);
  const num = new Intl.NumberFormat("en-GB");
  const kgFmt = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function addDays(iso, n) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${dt.getUTCFullYear()}-${mm}-${dd}`;
  }

  function diffDays(a, b) {
    const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
    return Math.round(ms / 86400000);
  }

  function calendar(start, end) {
    const out = [];
    for (let day = start; day <= end; day = addDays(day, 1)) out.push(day);
    return out;
  }

  function formatDay(iso, withYear) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC",
      day: "numeric",
      month: "short",
      year: withYear ? "numeric" : undefined,
    }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  function weekday(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
  }

  function rangeLabel(start, end) {
    if (start.slice(0, 4) !== end.slice(0, 4)) return `${formatDay(start, true)} – ${formatDay(end, true)}`;
    return `${formatDay(start)} – ${formatDay(end)}`;
  }

  function weekStart(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    return addDays(iso, wd === 0 ? -6 : 1 - wd);
  }

  function clock(iso) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  }

  function dayKeySgt(iso) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Singapore",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  }

  function formatUpdated(iso) {
    const dt = new Date(iso);
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(dt);
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Singapore",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(dt);
    return `Updated ${day}, ${time} SGT`;
  }

  function xml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
    }[ch]));
  }

  function mean(rows, field, digits) {
    const vals = rows.map((row) => row[field]).filter((value) => value != null && Number.isFinite(value));
    if (!vals.length) return null;
    const avg = vals.reduce((sum, value) => sum + value, 0) / vals.length;
    const factor = 10 ** (digits || 0);
    return Math.round(avg * factor) / factor;
  }

  function dash(value, digits) {
    if (value == null || Number.isNaN(value)) return "—";
    if (digits) return value.toFixed(digits);
    return num.format(value);
  }

  function activityName(key) {
    if (ACTIVITIES[key]) return ACTIVITIES[key];
    const raw = String(key || "Activity");
    const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function guideKg(iso, goals) {
    const days = diffDays(goals.weight_start_date, iso);
    const kg = goals.weight_start_kg - goals.pace_kg_per_week * (days / 7);
    return Math.max(goals.weight_target_kg, kg);
  }

  function targetDate(goals) {
    const weeks = (goals.weight_start_kg - goals.weight_target_kg) / goals.pace_kg_per_week;
    return addDays(goals.weight_start_date, Math.round(weeks * 7));
  }

  function parseWeights(text) {
    const rows = [];
    for (const line of text.trim().split(/\r?\n/).slice(1)) {
      const [date, kg] = line.split(",");
      if (!date || !kg) continue;
      const value = Number(kg.trim());
      if (!Number.isFinite(value)) continue;
      rows.push({ date: date.trim(), kg: value });
    }
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    return rows;
  }

  function colours() {
    return {
      ink: css("--axis") || "#5e6e66",
      grid: css("--grid") || "#e4ebe6",
      bar: css("--bar") || "#0b6b48",
      goal: css("--goal") || "#8d3b32",
      proj: css("--mark") || "#b86112",
      deep: css("--deep") || "#1e4d7b",
      rem: css("--rem") || "#2a7f7a",
      light: css("--light") || "#c5ddd2",
      accent: css("--accent") || "#0b6b48",
    };
  }

  function mountChart(node, summary, svg) {
    if (!svg) {
      node.removeAttribute("role");
      node.removeAttribute("aria-label");
      node.textContent = "";
      return;
    }
    node.setAttribute("role", "img");
    node.setAttribute("aria-label", summary);
    node.innerHTML = svg;
  }

  function axisLabels(count) {
    if (count <= 1) return [0];
    if (count <= 8) return Array.from({ length: count }, (_, i) => i);
    return [0, Math.floor((count - 1) / 2), count - 1];
  }

  function barChart(labels, values, goal, goalLabel) {
    const c = colours();
    const width = 640;
    const height = 210;
    const pad = { l: 44, r: 10, t: 16, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const nums = values.filter((value) => value != null);
    const peak = Math.max(goal || 0, ...(nums.length ? nums : [0]), 1);
    const yMax = peak * 1.08;
    const n = Math.max(values.length, 1);
    const slot = plotW / n;
    const yAt = (value) => pad.t + plotH - (value / yMax) * plotH;
    const ticks = [0, Math.round(yMax / 2), Math.round(yMax)];
    let body = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" font-family="Avenir Next, Segoe UI, system-ui, sans-serif">`;
    for (const tick of ticks) {
      const y = yAt(tick);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.grid}" stroke-width="1"/>`;
      body += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${c.ink}">${xml(num.format(tick))}</text>`;
    }
    if (goal) {
      const y = yAt(goal);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.goal}" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      body += `<text x="${pad.l + 4}" y="${y - 4}" font-size="11" fill="${c.goal}">${xml(goalLabel)}</text>`;
    }
    values.forEach((value, index) => {
      if (value == null) return;
      const h = Math.max(0, (value / yMax) * plotH);
      const x = pad.l + index * slot + slot * 0.15;
      const w = Math.max(1, slot * 0.7);
      body += `<rect x="${x.toFixed(2)}" y="${(yAt(value)).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="2" fill="${c.bar}"><title>${xml(labels[index])}: ${xml(num.format(value))}</title></rect>`;
    });
    for (const index of axisLabels(labels.length)) {
      const x = pad.l + index * slot + slot / 2;
      const anchor = labels.length > 1 && index === 0 ? "start" : (labels.length > 1 && index === labels.length - 1 ? "end" : "middle");
      body += `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="${c.ink}">${xml(labels[index])}</text>`;
    }
    body += "</svg>";
    return body;
  }

  function lineChart(labels, values, opts) {
    const c = colours();
    const width = 640;
    const height = 210;
    const pad = { l: 44, r: 10, t: 16, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const nums = values.filter((value) => value != null);
    if (!nums.length) return "";
    let yMin = Math.min(...nums);
    let yMax = Math.max(...nums);
    if (opts && opts.floor != null) yMin = Math.min(yMin, opts.floor);
    if (opts && opts.ceil != null) yMax = Math.max(yMax, opts.ceil);
    if (yMax - yMin < 1) {
      yMin -= 1;
      yMax += 1;
    } else {
      const padY = (yMax - yMin) * 0.12;
      yMin -= padY;
      yMax += padY;
    }
    const n = values.length;
    const xAt = (index) => pad.l + (n === 1 ? plotW / 2 : (index / (n - 1)) * plotW);
    const yAt = (value) => pad.t + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
    const ticks = [yMin, (yMin + yMax) / 2, yMax].map((value) => Math.round(value));
    let body = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" font-family="Avenir Next, Segoe UI, system-ui, sans-serif">`;
    for (const tick of ticks) {
      const y = yAt(tick);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.grid}"/>`;
      body += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${c.ink}">${xml(num.format(tick))}</text>`;
    }
    let segment = [];
    const flush = () => {
      if (!segment.length) return;
      if (segment.length === 1) {
        const p = segment[0];
        body += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="${c.accent}"><title>${xml(p.label)}: ${xml(String(p.value))}</title></circle>`;
      } else {
        body += `<polyline fill="none" stroke="${c.accent}" stroke-width="2" points="${segment.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ")}"/>`;
      }
      segment = [];
    };
    values.forEach((value, index) => {
      if (value == null) flush();
      else segment.push({ x: xAt(index), y: yAt(value), label: labels[index], value });
    });
    flush();
    for (const index of axisLabels(labels.length)) {
      const anchor = labels.length > 1 && index === 0 ? "start" : (labels.length > 1 && index === labels.length - 1 ? "end" : "middle");
      body += `<text x="${xAt(index).toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="${c.ink}">${xml(labels[index])}</text>`;
    }
    body += "</svg>";
    return body;
  }

  function stackedSleep(rows) {
    const c = colours();
    const width = 640;
    const height = 210;
    const pad = { l: 44, r: 10, t: 16, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const totals = rows.map((row) => (row.deep_h || 0) + (row.rem_h || 0) + (row.light_h || 0));
    const peak = Math.max(8, ...totals, 1);
    const yMax = peak * 1.05;
    const slot = plotW / Math.max(rows.length, 1);
    const yAt = (value) => pad.t + plotH - (value / yMax) * plotH;
    let body = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" font-family="Avenir Next, Segoe UI, system-ui, sans-serif">`;
    for (const tick of [0, 4, 8]) {
      if (tick > yMax) continue;
      const y = yAt(tick);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.grid}"/>`;
      body += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${c.ink}">${tick}h</text>`;
    }
    rows.forEach((row, index) => {
      if (row.sleep_h == null && row.deep_h == null) return;
      const parts = [
        [row.deep_h || 0, c.deep, "Deep"],
        [row.rem_h || 0, c.rem, "REM"],
        [row.light_h || 0, c.light, "Light"],
      ];
      let base = 0;
      const x = pad.l + index * slot + slot * 0.18;
      const w = Math.max(1, slot * 0.64);
      for (const [hours, fill, name] of parts) {
        if (!hours) continue;
        const y = yAt(base + hours);
        const h = (hours / yMax) * plotH;
        body += `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}"><title>${xml(formatDay(row.date))}: ${name} ${hours.toFixed(2)} h</title></rect>`;
        base += hours;
      }
    });
    const labels = rows.map((row) => formatDay(row.date));
    for (const index of axisLabels(labels.length)) {
      const x = pad.l + index * slot + slot / 2;
      const anchor = labels.length > 1 && index === 0 ? "start" : (labels.length > 1 && index === labels.length - 1 ? "end" : "middle");
      body += `<text x="${x.toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="${c.ink}">${xml(labels[index])}</text>`;
    }
    body += "</svg>";
    return body;
  }

  function weightChart(weights, goals, asOf, extraDays) {
    const c = colours();
    const goalEnd = targetDate(goals);
    let end = addDays(asOf, extraDays);
    if (goalEnd < end) end = goalEnd;
    const lastLogged = weights.length ? weights[weights.length - 1].date : goals.weight_start_date;
    if (lastLogged > end) end = lastLogged;
    let start = goals.weight_start_date;
    if (weights.length && weights[0].date < start) start = weights[0].date;
    if (end < start) end = start;
    const days = calendar(start, end);
    const logged = new Map(weights.map((row) => [row.date, row.kg]));
    const ys = [];
    for (const day of days) {
      if (day >= goals.weight_start_date) ys.push(guideKg(day, goals));
      if (logged.has(day)) ys.push(logged.get(day));
    }
    if (!ys.length) return { svg: "", offScale: true };
    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);
    if (yMax - yMin < 0.8) {
      const mid = (yMax + yMin) / 2;
      yMin = mid - 0.7;
      yMax = mid + 0.7;
    } else {
      const padY = (yMax - yMin) * 0.14;
      yMin -= padY;
      yMax += padY;
    }
    const width = 640;
    const height = 230;
    const pad = { l: 46, r: 12, t: 16, b: 28 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    const xAt = (iso) => pad.l + (days.length === 1 ? plotW / 2 : (diffDays(start, iso) / (days.length - 1)) * plotW);
    const yAt = (value) => pad.t + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
    let body = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" font-family="Avenir Next, Segoe UI, system-ui, sans-serif">`;
    const ticks = [yMin, (yMin + yMax) / 2, yMax];
    for (const tick of ticks) {
      const y = yAt(tick);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.grid}"/>`;
      body += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${c.ink}">${tick.toFixed(1)}</text>`;
    }
    const proj = days.filter((day) => day >= goals.weight_start_date);
    if (proj.length) {
      const points = proj.map((day) => `${xAt(day).toFixed(1)},${yAt(guideKg(day, goals)).toFixed(1)}`).join(" ");
      body += `<polyline fill="none" stroke="${c.proj}" stroke-width="2" stroke-dasharray="5 4" points="${points}"/>`;
      const last = proj[proj.length - 1];
      body += `<text x="${xAt(last) - 4}" y="${yAt(guideKg(last, goals)) - 6}" text-anchor="end" font-size="11" fill="${c.proj}">Projection</text>`;
    }
    const actual = weights.filter((row) => row.date >= start && row.date <= end);
    if (actual.length > 1) {
      const points = actual.map((row) => `${xAt(row.date).toFixed(1)},${yAt(row.kg).toFixed(1)}`).join(" ");
      body += `<polyline fill="none" stroke="${c.accent}" stroke-width="2.5" points="${points}"/>`;
    }
    for (const row of actual) {
      body += `<circle cx="${xAt(row.date).toFixed(1)}" cy="${yAt(row.kg).toFixed(1)}" r="4.5" fill="${c.accent}"><title>${xml(formatDay(row.date, true))}: ${kgFmt.format(row.kg)} kg</title></circle>`;
    }
    const labelDays = [...new Set([start, days[Math.floor((days.length - 1) / 2)], end])];
    for (const iso of labelDays) {
      const anchor = iso === start && iso !== end ? "start" : (iso === end && iso !== start ? "end" : "middle");
      body += `<text x="${xAt(iso).toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="${c.ink}">${xml(formatDay(iso))}</text>`;
    }
    body += "</svg>";
    return { svg: body, offScale: yMin > goals.weight_target_kg + 0.05, start, end };
  }

  function weeksOverlapping(byDate, rangeStart, rangeEnd) {
    const weeks = [];
    let cursor = weekStart(rangeStart);
    const last = weekStart(rangeEnd);
    while (cursor <= last) {
      const end = addDays(cursor, 6);
      const from = cursor < rangeStart ? rangeStart : cursor;
      const to = end > rangeEnd ? rangeEnd : end;
      const dates = calendar(from, to);
      const rows = dates.map((day) => byDate.get(day)).filter(Boolean);
      weeks.push({
        start: cursor,
        end,
        dates,
        rows,
        partial: dates.length < 7 || rows.some((row) => row.incomplete),
      });
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }

  function weekStats(rows) {
    const steps = rows.filter((row) => row.steps != null);
    return {
      avgSteps: steps.length ? Math.round(steps.reduce((sum, row) => sum + row.steps, 0) / steps.length) : null,
      hits: steps.filter((row) => row.steps >= (state.goals.steps_per_day || 10000)).length,
      cardio: rows.reduce((sum, row) => sum + (row.cardio_min || 0), 0),
      workouts: rows.reduce((sum, row) => sum + (row.workout_min || 0), 0),
      mh: rows.reduce((sum, row) => sum + (row.medium_min || 0) + (row.high_min || 0), 0),
      active: mean(rows, "active_cal", 0),
      sleep: mean(rows, "sleep_h", 2),
      ready: mean(rows, "readiness", 0),
    };
  }

  function stepStreak(days, goal) {
    if (!days.length) return 0;
    const byDate = new Map(days.map((row) => [row.date, row]));
    let cursor = days[days.length - 1].date;
    const last = byDate.get(cursor);
    if (last.incomplete && (last.steps == null || last.steps < goal)) cursor = addDays(cursor, -1);
    let streak = 0;
    while (byDate.has(cursor)) {
      const row = byDate.get(cursor);
      if (row.steps == null || row.steps < goal) break;
      streak += 1;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function render() {
    const doc = state.doc;
    const goals = state.goals;
    const days = doc.days || [];
    const byDate = new Map(days.map((row) => [row.date, row]));
    const latest = days[days.length - 1];
    const asOf = (doc.generated_at || `${latest.date}T00:00:00+08:00`).slice(0, 10);
    const dataEnd = latest.date;
    const rangeStart = addDays(dataEnd, -(state.range - 1));
    const inRange = days.filter((row) => row.date >= rangeStart && row.date <= dataEnd);
    const spanDays = calendar(rangeStart, dataEnd);

    setText("updated", doc.generated_at ? formatUpdated(doc.generated_at) : "Updated time unavailable");
    setText("range-note", `Showing ${rangeLabel(rangeStart, dataEnd)}. This filters the charts below. The weight chart also adds this many days of the illustrative pace.`);

    renderWeight(goals, asOf);
    renderLatest(latest, goals, inRange, spanDays);
    renderCardio(byDate, dataEnd, goals, rangeStart, dataEnd);
    renderConsistency(days, inRange, spanDays, byDate, rangeStart, dataEnd, goals);
    renderWeeks(byDate, rangeStart, dataEnd, goals);
    renderCorrelation(inRange);
    renderRecovery(inRange);
    renderWorkouts(doc.workouts || [], rangeStart, dataEnd);
  }

  function renderWeight(goals, asOf) {
    const weights = state.weights;
    const latest = weights.length ? weights[weights.length - 1] : null;
    const current = latest ? latest.kg : goals.weight_start_kg;
    const span = goals.weight_start_kg - goals.weight_target_kg;
    const lost = goals.weight_start_kg - current;
    const pct = Math.max(0, Math.min(100, (lost / span) * 100));
    const guide = guideKg(asOf, goals);
    const paceLost = goals.weight_start_kg - guide;
    const pacePct = Math.max(0, Math.min(100, (paceLost / span) * 100));
    setText("weight-value", `${kgFmt.format(current)} kg`);
    setText("weight-when", latest ? `Logged ${formatDay(latest.date, true)}` : "No weight logged yet");
    let progress = `${kgFmt.format(goals.weight_start_kg)} kg on ${formatDay(goals.weight_start_date, true)}. Target ${kgFmt.format(goals.weight_target_kg)} kg.`;
    if (lost > 0.05) progress = `${kgFmt.format(lost)} kg down from the start. ${kgFmt.format(span - lost)} kg to go.`;
    else if (lost < -0.05) progress = `${kgFmt.format(-lost)} kg above the ${formatDay(goals.weight_start_date)} start. Target ${kgFmt.format(goals.weight_target_kg)} kg.`;
    else progress = `Level with the ${kgFmt.format(goals.weight_start_kg)} kg start. ${kgFmt.format(span)} kg to go.`;
    setText("weight-progress", progress);
    $("weight-fill").style.width = `${pct}%`;
    $("weight-pace").style.left = `${pacePct}%`;
    const bar = $("weight-bar");
    bar.setAttribute("aria-valuemax", String(span));
    bar.setAttribute("aria-valuenow", String(Math.max(0, Math.round(lost * 10) / 10)));
    bar.setAttribute("aria-valuetext", progress);
    setText("weight-start-label", `${kgFmt.format(goals.weight_start_kg)} kg`);
    setText("weight-target-label", `${kgFmt.format(goals.weight_target_kg)} kg`);

    const chart = weightChart(weights, goals, asOf, state.range);
    const summary = `Weight from ${kgFmt.format(goals.weight_start_kg)} kg towards ${kgFmt.format(goals.weight_target_kg)} kg. Latest ${kgFmt.format(current)} kg. Dashed line is an illustrative projection of ${goals.pace_kg_per_week} kg per week, not a forecast.`;
    mountChart($("weight-chart"), summary, chart.svg);
    const delta = current - guide;
    let compare = `The illustrative pace on ${formatDay(asOf, true)} is ${kgFmt.format(guide)} kg. The latest log is ${kgFmt.format(current)} kg, on that line.`;
    if (delta > 0.05) compare = `The illustrative pace on ${formatDay(asOf, true)} is ${kgFmt.format(guide)} kg. The latest log is ${kgFmt.format(current)} kg, ${kgFmt.format(delta)} kg higher than that line.`;
    else if (delta < -0.05) compare = `The illustrative pace on ${formatDay(asOf, true)} is ${kgFmt.format(guide)} kg. The latest log is ${kgFmt.format(current)} kg, ${kgFmt.format(-delta)} kg lower than that line.`;
    const reach = `At ${goals.pace_kg_per_week} kg per week from ${kgFmt.format(goals.weight_start_kg)} kg on ${formatDay(goals.weight_start_date, true)}, the line reaches ${kgFmt.format(goals.weight_target_kg)} kg on ${formatDay(targetDate(goals), true)}. It is a projection, not a forecast.`;
    const scale = chart.offScale ? ` The target of ${kgFmt.format(goals.weight_target_kg)} kg is below the scale of this chart.` : "";
    setText("pace-note", `${compare} ${reach}${scale}`);

    const list = $("weight-list");
    list.replaceChildren();
    for (const row of [...weights].reverse().slice(0, 12)) {
      const item = document.createElement("li");
      item.textContent = `${formatDay(row.date, true)} · ${kgFmt.format(row.kg)} kg`;
      list.append(item);
    }
  }

  function renderLatest(latest, goals, inRange, spanDays) {
    const steps = latest.steps;
    const goal = goals.steps_per_day;
    const when = `${weekday(latest.date)} ${formatDay(latest.date, true)}`;
    setText("latest-when", latest.incomplete ? `${when}, still in progress` : when);
    setText("steps-value", steps == null ? "—" : num.format(steps));
    setText("steps-of", `of ${num.format(goal)}`);
    const pct = steps == null ? 0 : Math.max(0, Math.min(100, (steps / goal) * 100));
    $("steps-fill").style.width = `${pct}%`;
    setText("cal-active", latest.active_cal == null ? "—" : num.format(latest.active_cal));
    setText("cal-total", latest.total_cal == null ? "—" : num.format(latest.total_cal));
    setText("sleep-latest", latest.sleep_h == null ? "—" : latest.sleep_h.toFixed(2));
    setText(
      "sleep-latest-note",
      latest.sleep_h == null
        ? "No main sleep recorded"
        : (latest.sleep_score == null ? "Hours asleep" : `Hours asleep · score ${latest.sleep_score}`),
    );

    const byDate = new Map(inRange.map((row) => [row.date, row]));
    const labels = spanDays.map((day) => formatDay(day));
    const values = spanDays.map((day) => (byDate.has(day) ? byDate.get(day).steps : null));
    const known = values.filter((value) => value != null);
    const avg = known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
    mountChart(
      $("steps-chart"),
      `Daily steps from ${rangeLabel(spanDays[0], spanDays[spanDays.length - 1])}. Average ${avg == null ? "unavailable" : num.format(avg)}. Target ${num.format(goal)}.`,
      barChart(labels, values, goal, num.format(goal)),
    );
    const missing = spanDays.length - known.length;
    setText(
      "steps-summary",
      avg == null
        ? "No step counts in these dates."
        : `Average ${num.format(avg)} steps a day across ${known.length} day${known.length === 1 ? "" : "s"} with a count.${missing ? ` ${missing} day${missing === 1 ? "" : "s"} had no step count.` : ""}`,
    );
  }

  function renderCardio(byDate, dataEnd, goals, rangeStart, rangeEnd) {
    const start = weekStart(dataEnd);
    const end = addDays(start, 6);
    const rows = calendar(start, end).map((day) => byDate.get(day)).filter(Boolean);
    const stats = weekStats(rows);
    const goal = goals.cardio_min_per_week;
    const partial = end > dataEnd || rows.some((row) => row.incomplete);
    setText("cardio-when", `${rangeLabel(start, end)}${partial ? " · still in progress" : ""}`);
    setText("cardio-value", `${num.format(stats.cardio)} min`);
    setText("cardio-of", `of ${num.format(goal)} minutes`);
    $("cardio-fill").style.width = `${Math.max(0, Math.min(100, (stats.cardio / goal) * 100))}%`;
    setText(
      "cardio-detail",
      `Medium and high activity ${num.format(stats.mh)} min. Logged workouts ${num.format(stats.workouts)} min. Counted towards the target: ${num.format(stats.cardio)} min. Each day uses the longer of those two, so a workout already inside the ring’s activity minutes is not added twice.`,
    );

    const weeks = weeksOverlapping(byDate, rangeStart, rangeEnd);
    const labels = weeks.map((week) => formatDay(week.start));
    const values = weeks.map((week) => weekStats(week.rows).cardio);
    mountChart(
      $("cardio-chart"),
      `Weekly cardio minutes. Target ${goal} minutes. Latest week ${stats.cardio} minutes.`,
      barChart(labels, values, goal, String(goal)),
    );
  }

  function renderConsistency(days, inRange, spanDays, byDate, rangeStart, rangeEnd, goals) {
    const goal = goals.steps_per_day;
    const streak = stepStreak(days, goal);
    setText("streak", `${num.format(streak)} day${streak === 1 ? "" : "s"}`);
    const known = inRange.filter((row) => row.steps != null);
    const hits = known.filter((row) => row.steps >= goal).length;
    setText("hit-10k", `${num.format(hits)} of ${num.format(spanDays.length)}`);
    setText("logged-days", `${num.format(known.length)} of ${num.format(spanDays.length)}`);
    const weeks = weeksOverlapping(byDate, rangeStart, rangeEnd);
    const met = weeks.filter((week) => weekStats(week.rows).cardio >= goals.cardio_min_per_week).length;
    setText("weeks-hit", `${num.format(met)} of ${num.format(weeks.length)}`);
  }

  function renderWeeks(byDate, rangeStart, rangeEnd, goals) {
    const body = $("week-body");
    body.replaceChildren();
    const weeks = weeksOverlapping(byDate, rangeStart, rangeEnd).reverse();
    for (const week of weeks) {
      const stats = weekStats(week.rows);
      const tr = document.createElement("tr");
      const cells = [
        rangeLabel(week.start, week.end),
        week.partial ? `${week.dates.length} of 7` : "7",
        dash(stats.avgSteps),
        dash(stats.hits),
        dash(stats.cardio),
        dash(stats.workouts),
        dash(stats.active),
        stats.sleep == null ? "—" : stats.sleep.toFixed(2),
        dash(stats.ready),
      ];
      cells.forEach((value, index) => {
        const cell = document.createElement(index === 0 ? "th" : "td");
        if (index === 0) cell.scope = "row";
        cell.textContent = value;
        if (index === 0 && week.partial) {
          const tag = document.createElement("span");
          tag.className = "tag";
          tag.textContent = "partial";
          cell.append(tag);
        }
        tr.append(cell);
      });
      body.append(tr);
    }
    if (!weeks.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.textContent = "No weeks in this range.";
      tr.append(td);
      body.append(tr);
    }
  }

  function scatterChart(points) {
    if (!points.length) return "";
    const c = colours();
    const width = 640;
    const height = 220;
    const pad = { l: 48, r: 14, t: 16, b: 32 };
    const plotW = width - pad.l - pad.r;
    const plotH = height - pad.t - pad.b;
    let xMin = Math.min(...points.map((point) => point.x));
    let xMax = Math.max(...points.map((point) => point.x));
    let yMin = Math.min(...points.map((point) => point.y));
    let yMax = Math.max(...points.map((point) => point.y));
    if (xMax - xMin < 0.4) {
      xMin -= 0.3;
      xMax += 0.3;
    } else {
      const padX = (xMax - xMin) * 0.08;
      xMin -= padX;
      xMax += padX;
    }
    if (yMax - yMin < 1) {
      yMin -= 1;
      yMax += 1;
    } else {
      const padY = (yMax - yMin) * 0.1;
      yMin -= padY;
      yMax += padY;
    }
    const xAt = (value) => pad.l + ((value - xMin) / (xMax - xMin)) * plotW;
    const yAt = (value) => pad.t + plotH - ((value - yMin) / (yMax - yMin)) * plotH;
    const yTicks = [yMin, (yMin + yMax) / 2, yMax].map((value) => Math.round(value));
    const xTicks = [xMin, (xMin + xMax) / 2, xMax];
    let body = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true" font-family="Avenir Next, Segoe UI, system-ui, sans-serif">`;
    for (const tick of yTicks) {
      const y = yAt(tick);
      body += `<line x1="${pad.l}" y1="${y}" x2="${width - pad.r}" y2="${y}" stroke="${c.grid}"/>`;
      body += `<text x="${pad.l - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="${c.ink}">${xml(num.format(tick))}</text>`;
    }
    for (const point of points) {
      body += `<circle cx="${xAt(point.x).toFixed(1)}" cy="${yAt(point.y).toFixed(1)}" r="4" fill="${c.accent}" fill-opacity="0.85"><title>${xml(point.label)}: ${point.x.toFixed(2)} h, ${xml(num.format(point.y))}</title></circle>`;
    }
    xTicks.forEach((tick, index) => {
      const anchor = index === 0 ? "start" : (index === xTicks.length - 1 ? "end" : "middle");
      body += `<text x="${xAt(tick).toFixed(1)}" y="${height - 8}" text-anchor="${anchor}" font-size="11" fill="${c.ink}">${tick.toFixed(1)} h</text>`;
    });
    body += "</svg>";
    return body;
  }

  function formatR(value) {
    return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}`;
  }

  function describeLink(r, count, copy) {
    if (r == null || count < 8) {
      return `Not enough days with both ${copy.both} to describe a link (${num.format(count)} day${count === 1 ? "" : "s"}).`;
    }
    const shown = `r = ${formatR(r)}, ${num.format(count)} days`;
    if (Math.abs(r) < 0.2) return `${copy.flat} do not move together in these dates (${shown}).`;
    const strength = Math.abs(r) >= 0.7 ? "a strong link in these dates" : Math.abs(r) >= 0.4 ? "a moderate link" : "a weak link";
    const direction = r > 0 ? copy.higher : copy.lower;
    return `${copy.more} goes with ${direction} (${strength}, ${shown}).`;
  }

  function pairs(rows, xField, yField) {
    return rows.filter((row) => row[xField] != null && row[yField] != null);
  }

  function correlation(rows, xField, yField) {
    const matched = pairs(rows, xField, yField);
    const n = matched.length;
    if (n < 3) return { r: null, n };
    const xs = matched.map((row) => row[xField]);
    const ys = matched.map((row) => row[yField]);
    const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
    const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
    let nume = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < n; i += 1) {
      const x = xs[i] - meanX;
      const y = ys[i] - meanY;
      nume += x * y;
      dx += x * x;
      dy += y * y;
    }
    if (dx === 0 || dy === 0) return { r: null, n };
    return { r: nume / Math.sqrt(dx * dy), n };
  }

  function groupBlurb(rows) {
    if (!rows.length) return "No nights in this range.";
    const steps = mean(rows, "steps", 0);
    const cardio = mean(rows, "cardio_min", 0);
    const ready = mean(rows, "readiness", 0);
    const bits = [];
    if (steps != null) bits.push(`${num.format(steps)} steps`);
    if (cardio != null) bits.push(`${num.format(cardio)} cardio min`);
    if (ready != null) bits.push(`readiness ${num.format(ready)}`);
    return bits.length ? `Average ${bits.join(", ")}.` : "No steps, cardio or readiness on these nights.";
  }

  function renderCorrelation(inRange) {
    const rows = inRange.filter((row) => !row.incomplete);
    const leftOut = inRange.some((row) => row.incomplete);
    const steps = correlation(rows, "sleep_h", "steps");
    const cardio = correlation(rows, "sleep_h", "cardio_min");
    const ready = correlation(rows, "sleep_h", "readiness");
    const lines = $("corr-lines");
    lines.replaceChildren();
    const sentences = [
      describeLink(steps.r, steps.n, {
        both: "a sleep length and a step count",
        flat: "Sleep length and steps",
        more: "Longer sleep",
        higher: "more steps",
        lower: "fewer steps",
      }),
      describeLink(cardio.r, cardio.n, {
        both: "a sleep length and a cardio total",
        flat: "Sleep length and cardio",
        more: "Longer sleep",
        higher: "more cardio minutes",
        lower: "fewer cardio minutes",
      }),
      describeLink(ready.r, ready.n, {
        both: "a sleep length and a readiness score",
        flat: "Sleep length and readiness",
        more: "Longer sleep",
        higher: "higher readiness",
        lower: "lower readiness",
      }),
    ];
    for (const sentence of sentences) {
      const item = document.createElement("li");
      item.textContent = sentence;
      lines.append(item);
    }
    const base = "Each night’s main sleep is paired with that same day’s steps, cardio and readiness. This describes the dates in view. It is not a cause, and it is not medical advice.";
    const hold = leftOut ? " The latest day is still in progress, so it is left out of these pairings." : "";
    setText("corr-summary", base + hold);

    const short = rows.filter((row) => row.sleep_h != null && row.sleep_h < 7);
    const longer = rows.filter((row) => row.sleep_h != null && row.sleep_h >= 7);
    setText("corr-short-n", `${num.format(short.length)} night${short.length === 1 ? "" : "s"}`);
    setText("corr-long-n", `${num.format(longer.length)} night${longer.length === 1 ? "" : "s"}`);
    setText("corr-short-detail", groupBlurb(short));
    setText("corr-long-detail", groupBlurb(longer));

    const stepPoints = pairs(rows, "sleep_h", "steps").map((row) => ({
      x: row.sleep_h, y: row.steps, label: formatDay(row.date, true),
    }));
    const readyPoints = pairs(rows, "sleep_h", "readiness").map((row) => ({
      x: row.sleep_h, y: row.readiness, label: formatDay(row.date, true),
    }));
    mountChart(
      $("corr-steps-chart"),
      `Scatter of hours asleep against steps. ${sentences[0]}`,
      scatterChart(stepPoints),
    );
    mountChart(
      $("corr-ready-chart"),
      `Scatter of hours asleep against readiness. ${sentences[2]}`,
      scatterChart(readyPoints),
    );
  }

  function latestWith(rows, field) {
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      if (rows[i][field] != null) return rows[i];
    }
    return null;
  }

  function renderRecovery(rows) {
    const labels = rows.map((row) => formatDay(row.date));
    const sleep = latestWith(rows, "sleep_h") || latestWith(rows, "sleep_score");
    const sleepAvg = mean(rows, "sleep_h", 2);
    const scoreAvg = mean(rows, "sleep_score", 0);
    let sleepText = "Hours asleep come from the main sleep period. The score is Oura’s sleep score.";
    if (sleep) {
      const bits = [`${weekday(sleep.date)} ${formatDay(sleep.date)}`];
      if (sleep.sleep_h != null) bits.push(`${sleep.sleep_h.toFixed(2)} h asleep`);
      if (sleep.sleep_score != null) bits.push(`score ${sleep.sleep_score}`);
      if (sleep.efficiency != null) bits.push(`efficiency ${sleep.efficiency}%`);
      if (sleep.bedtime_start && sleep.bedtime_end) bits.push(`in bed ${clock(sleep.bedtime_start)}–${clock(sleep.bedtime_end)}`);
      sleepText = `${bits.join(" · ")}.`;
      if (sleepAvg != null) sleepText += ` Average asleep in this range: ${sleepAvg.toFixed(2)} h.`;
      if (scoreAvg != null) sleepText += ` Average score: ${scoreAvg}.`;
    }
    setText("sleep-summary", sleepText);
    mountChart($("sleep-chart"), sleepText, rows.some((row) => row.sleep_h != null) ? stackedSleep(rows) : "");

    const ready = latestWith(rows, "readiness");
    const readyAvg = mean(rows, "readiness", 0);
    const readyText = ready
      ? `Latest score ${ready.readiness} on ${formatDay(ready.date)}.${readyAvg != null ? ` Average in this range: ${readyAvg}.` : ""}`
      : "No readiness scores in these dates.";
    setText("ready-summary", readyText);
    mountChart($("ready-chart"), readyText, lineChart(labels, rows.map((row) => row.readiness)));

    const hrv = latestWith(rows, "hrv");
    const hrvAvg = mean(rows, "hrv", 0);
    const hrvText = hrv
      ? `Latest ${hrv.hrv} ms on ${formatDay(hrv.date)}.${hrvAvg != null ? ` Average in this range: ${hrvAvg} ms.` : ""} Average during the main sleep.`
      : "No heart-rate variability in these dates.";
    setText("hrv-summary", hrvText);
    mountChart($("hrv-chart"), hrvText, lineChart(labels, rows.map((row) => row.hrv)));

    const rhr = latestWith(rows, "resting_hr");
    const rhrAvg = mean(rows, "resting_hr", 0);
    const rhrText = rhr
      ? `Latest ${rhr.resting_hr} bpm on ${formatDay(rhr.date)}.${rhrAvg != null ? ` Average in this range: ${rhrAvg} bpm.` : ""} Lowest heart rate during the main sleep.`
      : "No resting heart rate in these dates.";
    setText("rhr-summary", rhrText);
    mountChart($("rhr-chart"), rhrText, lineChart(labels, rows.map((row) => row.resting_hr)));

    const stress = latestWith(rows, "stress");
    const stressAvg = mean(rows, "stress_high_min", 0);
    const label = stress && stress.stress ? stress.stress.charAt(0).toUpperCase() + stress.stress.slice(1) : null;
    let stressText = "Oura’s label for the day, plus minutes it marked as high stress.";
    if (stress && label) {
      stressText = `${formatDay(stress.date)}: ${label}. High stress ${stress.stress_high_min == null ? "—" : num.format(stress.stress_high_min)} min. Recovery ${stress.recovery_high_min == null ? "—" : num.format(stress.recovery_high_min)} min.`;
      if (stressAvg != null) stressText += ` Average high-stress minutes in this range: ${stressAvg}.`;
    }
    setText("stress-summary", stressText);
    mountChart(
      $("stress-chart"),
      stressText,
      barChart(labels, rows.map((row) => row.stress_high_min), null, ""),
    );
  }

  function renderWorkouts(workouts, rangeStart, rangeEnd) {
    const rows = workouts
      .filter((item) => item.day >= rangeStart && item.day <= rangeEnd)
      .slice()
      .sort((a, b) => (a.start < b.start ? 1 : -1));
    setText(
      "workout-summary",
      rows.length
        ? `${num.format(rows.length)} workout${rows.length === 1 ? "" : "s"} in these dates. Times are Singapore time (UTC+8).`
        : "No workouts in these dates.",
    );
    const list = $("workout-list");
    list.replaceChildren();
    for (const item of rows) {
      const li = document.createElement("li");
      const title = document.createElement("strong");
      const startDay = dayKeySgt(item.start);
      const endDay = dayKeySgt(item.end);
      const when = startDay === endDay
        ? `${formatDay(startDay)} · ${clock(item.start)}–${clock(item.end)}`
        : `${formatDay(startDay)} ${clock(item.start)} – ${formatDay(endDay)} ${clock(item.end)}`;
      title.textContent = `${activityName(item.activity)} · ${num.format(item.minutes)} min`;
      const meta = document.createElement("span");
      const intensity = item.intensity ? item.intensity.charAt(0).toUpperCase() + item.intensity.slice(1) : "";
      const kcal = item.kcal == null ? "" : `${num.format(item.kcal)} kcal`;
      meta.textContent = [when, intensity, kcal].filter(Boolean).join(" · ");
      li.append(title, meta);
      list.append(li);
    }
  }

  function showError(message) {
    const node = $("load-error");
    node.hidden = false;
    node.textContent = message;
    setText("updated", "The log could not be loaded.");
  }

  async function load() {
    try {
      const [dailyRes, weightRes] = await Promise.all([
        fetch("data/daily.json", { cache: "no-store" }),
        fetch("data/weight.csv", { cache: "no-store" }),
      ]);
      if (!dailyRes.ok) throw new Error(`Activity data returned ${dailyRes.status}`);
      if (!weightRes.ok) throw new Error(`Weight log returned ${weightRes.status}`);
      state.doc = await dailyRes.json();
      state.weights = parseWeights(await weightRes.text());
      state.goals = Object.assign({}, FALLBACK_GOALS, state.doc.goals || {});
      if (!state.doc.days || !state.doc.days.length) throw new Error("The activity file has no days.");
      $("load-error").hidden = true;
      render();
    } catch (err) {
      showError("Could not load the health data. Open this page over HTTP. GitHub Pages serves it at /health/.");
      console.error(err);
    }
  }

  document.querySelectorAll(".range button").forEach((button) => {
    button.addEventListener("click", () => {
      state.range = Number(button.dataset.days);
      document.querySelectorAll(".range button").forEach((other) => {
        other.setAttribute("aria-pressed", other === button ? "true" : "false");
      });
      if (state.doc) render();
    });
  });

  const scheme = window.matchMedia("(prefers-color-scheme: dark)");
  if (scheme.addEventListener) scheme.addEventListener("change", () => { if (state.doc) render(); });

  load();
})();
