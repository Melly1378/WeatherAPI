/* ============================================================
   Violet Azure Weather — OpenWeather API
   Requirements:
   - Any city search
   - Temp + humidity + icon
   - 5-day forecast
   - Day/Night theme toggle
   - Validation + loading + error handling
   - Dropdown suggestions (OpenWeather Geocoding)
   ============================================================ */

const API_KEY = "c78977dcb32cac75266a691c57e3cc4f";
const UNITS = "metric"; // "metric" = °C, "imperial" = °F
const DEFAULT_CITY = "Manila";

const el = {
    subtitle: document.getElementById("subtitle"),
    themeToggle: document.getElementById("themeToggle"),
    themeLabel: document.getElementById("themeLabel"),

    cityInput: document.getElementById("cityInput"),
    suggest: document.getElementById("suggest"),
    searchBtn: document.getElementById("searchBtn"),

    statusPill: document.getElementById("statusPill"),
    errorBox: document.getElementById("errorBox"),

    icon: document.getElementById("icon"),
    tempValue: document.getElementById("tempValue"),
    tempDesc: document.getElementById("tempDesc"),
    humValue: document.getElementById("humValue"),
    windValue: document.getElementById("windValue"),
    feelsValue: document.getElementById("feelsValue"),
    minmaxValue: document.getElementById("minmaxValue"),

    forecastGrid: document.getElementById("forecastGrid"),
};

let theme = "night"; // "night" | "day"
let suggestAbort = null;
let suggestTimer = null;

function setTheme(next) {
    theme = next;
    document.body.classList.toggle("day", theme === "day");
    el.themeLabel.textContent = theme === "day" ? "Day" : "Night";
}

function setStatus(msg) { el.statusPill.textContent = msg; }

function setError(msg) { el.errorBox.textContent = msg || ""; }

function setLoading(isLoading) {
    el.searchBtn.disabled = isLoading;
    el.cityInput.disabled = isLoading;
    setStatus(isLoading ? "Loading..." : "Ready");
}

function cleanCity(s) {
    return (s || "").trim().replace(/\s+/g, " ");
}

function validCity(s) {
    // allow letters, spaces, dots, hyphens, apostrophes
    return /^[a-zA-ZÀ-ž\s.\-']{2,}$/.test(s);
}

// For suggestions: be more permissive while typing
function validCityForSuggest(s) {
    // allow letters, spaces, commas, dots, hyphens, apostrophes (users often type commas)
    return /^[a-zA-ZÀ-ž\s,.\-']{2,}$/.test(s);
}

// simple emoji mapping by main weather condition
function iconFor(main, isNight) {
    const m = (main || "").toLowerCase();
    if (m.includes("clear")) return isNight ? "🌙" : "☀️";
    if (m.includes("cloud")) return "☁️";
    if (m.includes("rain") || m.includes("drizzle")) return "🌧️";
    if (m.includes("thunder")) return "⛈️";
    if (m.includes("snow")) return "❄️";
    if (m.includes("mist") || m.includes("fog") || m.includes("haze")) return "🌫️";
    return "⛅";
}

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json();
}

function showSuggest(show){
  el.suggest.classList.toggle("show", !!show);
}

function clearSuggestions(){
  el.suggest.innerHTML = "";
  showSuggest(false);
}

/* ---------- Suggestions via OpenWeather Geocoding ---------- */
async function loadSuggestions(query){
  const q = cleanCity(query);

  // minimum chars to avoid spam
  if (q.length < 2) return [];

  // do NOT block typing on strict regex; keep it permissive
  if (!validCityForSuggest(q)) return [];

  // cancel previous
  if (suggestAbort) suggestAbort.abort();
  suggestAbort = new AbortController();

  const url = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=5&appid=${API_KEY}`;
  const res = await fetch(url, { signal: suggestAbort.signal });
  if (!res.ok) return [];

  const data = await res.json();
  if (!Array.isArray(data)) return [];

  // de-dup (same name/state/country happens)
  const seen = new Set();
  const out = [];
  for (const x of data){
    const name = x?.name;
    const state = x?.state;
    const country = x?.country;
    const lat = x?.lat;
    const lon = x?.lon;

    if (!name || typeof lat !== "number" || typeof lon !== "number") continue;

    const key = `${name}|${state || ""}|${country || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ name, state, country, lat, lon });
  }
  return out;
}

function renderSuggestions(items){
  el.suggest.innerHTML = "";

  if (!items || items.length === 0){
    showSuggest(false);
    return;
  }

  items.forEach(item => {
    const btn = document.createElement("button");
    btn.type = "button";

    const tail = [item.state, item.country].filter(Boolean).join(", ");
    const label = `${item.name}${tail ? `, ${tail}` : ""}`;
    btn.textContent = label;

    // IMPORTANT: use mousedown so it fires before document click closes the dropdown
    btn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      el.cityInput.value = label;
      showSuggest(false);
      runWeatherByCoords(item.lat, item.lon, label);
    });

    el.suggest.appendChild(btn);
  });

  showSuggest(true);
}

/* ---------- Weather fetch ---------- */
async function runWeatherByCity(cityText){
  const city = cleanCity(cityText);
  setError("");

  if (!city){
    setError("Invalid input: city is empty.");
    return;
  }
  if (!validCity(city)){
    setError("Invalid input: use letters/spaces only (basic punctuation allowed).");
    return;
  }
  if (!API_KEY || API_KEY.includes("PUT_YOUR")){
    setError("API key missing. Put your OpenWeather API key in app.js.");
    return;
  }

  setLoading(true);
  try{
    // Geocode → coords for stable results
    const geoUrl = `https://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(city)}&limit=1&appid=${API_KEY}`;
    const geo = await fetchJSON(geoUrl);
    if (!Array.isArray(geo) || geo.length === 0){
      throw new Error("No results found for that city.");
    }
    const { lat, lon, name, country, state } = geo[0];
    const label = [name, state, country].filter(Boolean).join(", ");
    await runWeatherByCoords(lat, lon, label);
  } catch(err){
    setError(err.message || "Failed API call.");
  } finally{
    setLoading(false);
  }
}

async function runWeatherByCoords(lat, lon, label){
  setLoading(true);
  setError("");

  try{
    const currentUrl =
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=${UNITS}`;
    const forecastUrl =
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=${UNITS}`;

    const [cur, fc] = await Promise.all([fetchJSON(currentUrl), fetchJSON(forecastUrl)]);

    renderCurrent(cur, label);
    renderForecast(fc);

  } catch(err){
    setError(err.message || "Failed API call.");
  } finally{
    setLoading(false);
  }
}

function renderCurrent(cur, label){
  el.subtitle.textContent = label || cur?.name || "—";

  const main = cur?.weather?.[0]?.main || "";
  const desc = cur?.weather?.[0]?.description || "—";
  const temp = cur?.main?.temp;
  const feels = cur?.main?.feels_like;
  const hum = cur?.main?.humidity;
  const tmin = cur?.main?.temp_min;
  const tmax = cur?.main?.temp_max;
  const wind = cur?.wind?.speed;

  // Determine night from icon code (OpenWeather: "01n" etc)
  const iconCode = cur?.weather?.[0]?.icon || "";
  const isNight = iconCode.endsWith("n");

  // Auto-switch theme based on data (still user can toggle after)
  setTheme(isNight ? "night" : "day");

  el.icon.textContent = iconFor(main, isNight);
  el.tempValue.textContent = (temp != null) ? `${Math.round(temp)}°` : "--°";
  el.tempDesc.textContent = desc;

  el.humValue.textContent = (hum != null) ? `${hum}%` : "--%";
  el.windValue.textContent = (wind != null) ? `${wind.toFixed(1)} m/s` : "-- m/s";
  el.feelsValue.textContent = (feels != null) ? `${Math.round(feels)}°` : "--°";
  el.minmaxValue.textContent =
    (tmin != null && tmax != null) ? `${Math.round(tmin)}° / ${Math.round(tmax)}°` : "--° / --°";
}

function dayKeyFromDt(dtTxt){
  // dtTxt: "2025-12-22 12:00:00"
  return (dtTxt || "").slice(0, 10);
}

function weekdayShort(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function aggregate5Days(list){
  const map = new Map();

  for (const item of list){
    const key = dayKeyFromDt(item.dt_txt);
    if (!key) continue;

    const temp = item?.main?.temp;
    const hum = item?.main?.humidity;
    const main = item?.weather?.[0]?.main || "";
    const iconCode = item?.weather?.[0]?.icon || "";
    const hour = Number((item.dt_txt || "").slice(11,13));

    if (!map.has(key)){
      map.set(key, {
        key,
        min: temp,
        max: temp,
        humSum: (hum ?? 0),
        humN: hum != null ? 1 : 0,
        noonPick: null,
        fallback: { main, iconCode }
      });
    }
    const agg = map.get(key);

    if (typeof temp === "number"){
      agg.min = (typeof agg.min === "number") ? Math.min(agg.min, temp) : temp;
      agg.max = (typeof agg.max === "number") ? Math.max(agg.max, temp) : temp;
    }
    if (typeof hum === "number"){
      agg.humSum += hum;
      agg.humN += 1;
    }

    // prefer near 12:00
    const distToNoon = Math.abs(hour - 12);
    if (!agg.noonPick || distToNoon < agg.noonPick.dist){
      agg.noonPick = { dist: distToNoon, main, iconCode };
    }
  }

  const keys = Array.from(map.keys()).sort();
  return keys.slice(0, 5).map(k => {
    const agg = map.get(k);
    const pick = agg.noonPick || agg.fallback;
    const avgHum = agg.humN ? Math.round(agg.humSum / agg.humN) : null;
    return {
      date: agg.key,
      min: agg.min,
      max: agg.max,
      hum: avgHum,
      main: pick.main,
      iconCode: pick.iconCode
    };
  });
}

function renderForecast(fc){
  const list = fc?.list;
  if (!Array.isArray(list) || list.length === 0){
    el.forecastGrid.innerHTML = "";
    setError("No forecast results found.");
    return;
  }

  const days = aggregate5Days(list);
  el.forecastGrid.innerHTML = "";

  days.forEach(d => {
    const card = document.createElement("div");
    card.className = "dayCard";

    const isNight = (d.iconCode || "").endsWith("n");
    const ico = iconFor(d.main, isNight);

    card.innerHTML = `
      <div class="dayCard__d">${weekdayShort(d.date)}</div>
      <div class="dayCard__i">${ico}</div>
      <div class="dayCard__t">${Math.round(d.max)}° / ${Math.round(d.min)}°</div>
      <div class="dayCard__h">${d.hum != null ? `Hum ${d.hum}%` : ""}</div>
    `;
    el.forecastGrid.appendChild(card);
  });
}

/* ---------- Events ---------- */
el.themeToggle.addEventListener("click", () => {
  setTheme(theme === "day" ? "night" : "day");
});

el.searchBtn.addEventListener("click", () => {
  clearSuggestions();
  runWeatherByCity(el.cityInput.value);
});

el.cityInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter"){
    clearSuggestions();
    runWeatherByCity(el.cityInput.value);
  }
  // ESC closes dropdown
  if (e.key === "Escape"){
    clearSuggestions();
  }
});

// suggestion typing (debounced)
el.cityInput.addEventListener("input", () => {
  clearTimeout(suggestTimer);

  const q = el.cityInput.value;

  // hide dropdown if too short
  if (cleanCity(q).length < 2){
    clearSuggestions();
    return;
  }

  suggestTimer = setTimeout(async () => {
    try{
      const items = await loadSuggestions(q);
      renderSuggestions(items);
    } catch {
      renderSuggestions([]);
    }
  }, 180);
});

// keep dropdown open when input is focused (if there are items)
el.cityInput.addEventListener("focus", () => {
  if (el.suggest.children.length > 0) showSuggest(true);
});

// close suggestions on outside click (mousedown choice prevents race)
document.addEventListener("click", (e) => {
  if (!el.suggest.contains(e.target) && e.target !== el.cityInput){
    clearSuggestions();
  }
});

/* ---------- Boot ---------- */
setTheme("night");
el.cityInput.value = DEFAULT_CITY;
runWeatherByCity(DEFAULT_CITY);