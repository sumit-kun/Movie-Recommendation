// =====================================================================
// MovieMind — frontend logic
// Talks only to the local FastAPI backend. No external APIs, no keys.
// =====================================================================

const API_BASE_URL = "http://127.0.0.1:8000";

const searchInput = document.getElementById("searchInput");
const searchSpinner = document.getElementById("searchSpinner");
const suggestionsList = document.getElementById("suggestionsList");
const recommendBtn = document.getElementById("recommendBtn");
const selectedHint = document.getElementById("selectedHint");
const selectedTitleEl = document.getElementById("selectedTitle");

const stateIdle = document.getElementById("stateIdle");
const stateLoading = document.getElementById("stateLoading");
const stateNotFound = document.getElementById("stateNotFound");
const stateError = document.getElementById("stateError");
const stateResults = document.getElementById("stateResults");

const baseMovieTitle = document.getElementById("baseMovieTitle");
const baseMoviePoster = document.getElementById("baseMoviePoster");
const resultsCount = document.getElementById("resultsCount");
const cardsGrid = document.getElementById("cardsGrid");

let selectedMovie = null;
let debounceTimer = null;
let activeSuggestionIndex = -1;
let currentSuggestions = [];
let cardCounter = 0;

// In-memory cache so the same title is never fetched twice.
const posterCache = new Map();

// ---------------------------------------------------------------------
// Poster art — fetched from Wikipedia's public API.
// This is a genuinely CORS-enabled, no-key endpoint (unlike the iTunes
// Search API, whose JSONP behaviour turned out to be unreliable from
// the browser). We first search Wikipedia for the movie, then pull
// the lead image off that page. Purely for cover art — all
// recommendation data still comes from the FastAPI backend.
// ---------------------------------------------------------------------

async function fetchPosterUrl(title) {
  const key = title.trim().toLowerCase();
  if (posterCache.has(key)) return posterCache.get(key);

  const result = await lookupWikipediaThumbnail(title);
  posterCache.set(key, result);
  return result;
}

async function lookupWikipediaThumbnail(title) {
  try {
    // Step 1: find the best-matching Wikipedia article for this movie.
    const searchUrl =
      `https://en.wikipedia.org/w/api.php?origin=*&action=query&list=search` +
      `&format=json&srlimit=1&srsearch=${encodeURIComponent(title + " film")}`;
    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hit = searchData?.query?.search?.[0];
    if (!hit) return null;

    // Step 2: pull the page's lead image (its "poster", effectively).
    const pageTitle = hit.title.replace(/ /g, "_");
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) return null;
    const summaryData = await summaryRes.json();

    return summaryData?.thumbnail?.source || summaryData?.originalimage?.source || null;
  } catch (err) {
    return null;
  }
}

function applyPosterToElement(el, url) {
  if (!el || !url) return;
  const img = new Image();
  img.onload = () => {
    el.style.backgroundImage = `url(${url})`;
    el.classList.add("has-image");
  };
  img.src = url;
}

// A small fixed palette of cinematic gradients used for poster placeholders.
// Picked deterministically per-title so the same movie always gets the same look.
const POSTER_GRADIENTS = [
  ["#7a3b2e", "#2c1810"],
  ["#1f3a3d", "#0d1b1c"],
  ["#5c3d1e", "#2b1c0e"],
  ["#3a2942", "#1a1220"],
  ["#6e2f2a", "#2a1210"],
  ["#264a42", "#12211d"],
  ["#4a3821", "#241b0f"],
  ["#5a2a3a", "#22101a"],
  ["#2e3a52", "#141b28"],
  ["#4d3524", "#221810"],
];

function gradientForTitle(title) {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  const [c1, c2] = POSTER_GRADIENTS[hash % POSTER_GRADIENTS.length];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

// ---------------------------------------------------------------------
// Result state switching
// ---------------------------------------------------------------------

function setResultState(state) {
  stateIdle.classList.add("hidden");
  stateLoading.classList.add("hidden");
  stateNotFound.classList.add("hidden");
  stateError.classList.add("hidden");
  stateResults.classList.add("hidden");

  const panel = {
    idle: stateIdle,
    loading: stateLoading,
    notFound: stateNotFound,
    error: stateError,
    results: stateResults,
  }[state];

  if (panel) panel.classList.remove("hidden");
}

// ---------------------------------------------------------------------
// Suggestions dropdown
// ---------------------------------------------------------------------

function clearSuggestions() {
  suggestionsList.innerHTML = "";
  suggestionsList.classList.add("hidden");
  currentSuggestions = [];
  activeSuggestionIndex = -1;
}

function renderSuggestions(movies) {
  currentSuggestions = movies;
  activeSuggestionIndex = -1;

  if (!movies.length) {
    suggestionsList.innerHTML = `<li class="suggestions-empty">No matching movies found.</li>`;
    suggestionsList.classList.remove("hidden");
    return;
  }

  suggestionsList.innerHTML = movies
    .map(
      (m, i) => `
      <li data-index="${i}" role="option">
        <span>${escapeHtml(m.title)}</span>
        <span class="sugg-meta">⭐ ${formatRating(m.vote_average)}</span>
      </li>`
    )
    .join("");

  suggestionsList.classList.remove("hidden");

  suggestionsList.querySelectorAll("li[data-index]").forEach((li) => {
    li.addEventListener("click", () => {
      const idx = Number(li.dataset.index);
      selectMovie(currentSuggestions[idx]);
    });
  });
}

function selectMovie(movie) {
  selectedMovie = movie;
  searchInput.value = movie.title;
  clearSuggestions();
  recommendBtn.disabled = false;
  selectedTitleEl.textContent = movie.title;
  selectedHint.classList.remove("hidden");
}

// ---------------------------------------------------------------------
// Search movies (as-you-type)
// ---------------------------------------------------------------------

async function searchMovies(query) {
  searchSpinner.classList.remove("hidden");
  try {
    const url = `${API_BASE_URL}/movies?search=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderSuggestions(data.movies || []);
  } catch (err) {
    console.error("Search failed:", err);
    suggestionsList.innerHTML = `<li class="suggestions-empty">Couldn't reach the backend. Is it running?</li>`;
    suggestionsList.classList.remove("hidden");
  } finally {
    searchSpinner.classList.add("hidden");
  }
}

searchInput.addEventListener("input", () => {
  const query = searchInput.value.trim();

  // Typing invalidates the previous selection.
  selectedMovie = null;
  recommendBtn.disabled = true;
  selectedHint.classList.add("hidden");

  clearTimeout(debounceTimer);

  if (!query) {
    clearSuggestions();
    return;
  }

  debounceTimer = setTimeout(() => searchMovies(query), 300);
});

// Keyboard navigation through suggestions
searchInput.addEventListener("keydown", (e) => {
  const items = suggestionsList.querySelectorAll("li[data-index]");
  if (!items.length) return;

  if (e.key === "ArrowDown") {
    e.preventDefault();
    activeSuggestionIndex = Math.min(activeSuggestionIndex + 1, items.length - 1);
    updateActiveSuggestion(items);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    activeSuggestionIndex = Math.max(activeSuggestionIndex - 1, 0);
    updateActiveSuggestion(items);
  } else if (e.key === "Enter") {
    if (activeSuggestionIndex >= 0 && currentSuggestions[activeSuggestionIndex]) {
      e.preventDefault();
      selectMovie(currentSuggestions[activeSuggestionIndex]);
    }
  } else if (e.key === "Escape") {
    clearSuggestions();
  }
});

function updateActiveSuggestion(items) {
  items.forEach((li) => li.classList.remove("active"));
  if (activeSuggestionIndex >= 0) {
    items[activeSuggestionIndex].classList.add("active");
    items[activeSuggestionIndex].scrollIntoView({ block: "nearest" });
  }
}

// Close suggestions when clicking elsewhere
document.addEventListener("click", (e) => {
  if (!e.target.closest(".search-block")) {
    clearSuggestions();
  }
});

// ---------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------

recommendBtn.addEventListener("click", () => {
  if (!selectedMovie) return;
  getRecommendations(selectedMovie.title);
});

async function getRecommendations(movieTitle) {
  setResultState("loading");
  document.getElementById("recommendations").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const url = `${API_BASE_URL}/recommend/${encodeURIComponent(movieTitle)}?n=10`;
    const res = await fetch(url);

    if (res.status === 404) {
      setResultState("notFound");
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    displayRecommendations(data);
  } catch (err) {
    console.error("Recommendation fetch failed:", err);
    showError();
  }
}

function displayRecommendations(data) {
  const recs = data.recommendations || [];
  const baseTitle = data.movie || selectedMovie.title;

  baseMovieTitle.textContent = baseTitle;
  resultsCount.textContent = `${recs.length} movie${recs.length === 1 ? "" : "s"} recommended for you`;

  baseMoviePoster.style.backgroundImage = "";
  baseMoviePoster.classList.remove("has-image");
  baseMoviePoster.style.background = gradientForTitle(baseTitle);
  fetchPosterUrl(baseTitle).then((url) => applyPosterToElement(baseMoviePoster, url));

  if (!recs.length) {
    cardsGrid.innerHTML = `<p>No recommendations available for this title yet.</p>`;
    setResultState("results");
    return;
  }

  cardsGrid.innerHTML = recs.map(buildCard).join("");
  setResultState("results");

  // Load real poster art in the background for each card, without
  // blocking the initial render of titles, ratings and overviews.
  recs.forEach((movie) => {
    const id = movie.__cardId;
    fetchPosterUrl(movie.title).then((url) => {
      const el = cardsGrid.querySelector(`[data-poster-id="${id}"]`);
      applyPosterToElement(el, url);
    });
  });
}

function buildCard(movie) {
  const title = movie.title || "Untitled";
  const genres = formatGenres(movie.genres);
  const overview = movie.overview || "No overview available.";
  const tagline = movie.tagline;
  const rating = formatRating(movie.vote_average);
  const popularity = formatPopularity(movie.popularity);
  const matchPct = formatSimilarity(movie.similarity_score);

  const cardId = `p${cardCounter++}`;
  movie.__cardId = cardId;

  return `
    <article class="movie-card">
      <div class="poster" data-poster-id="${cardId}" style="background:${gradientForTitle(title)}">
        <span class="poster-reel" aria-hidden="true">🎬</span>
        <span class="poster-title">${escapeHtml(title)}</span>
      </div>
      <div class="card-body">
        <h3 class="card-title">${escapeHtml(title)}</h3>
        ${genres ? `<p class="card-genres">${escapeHtml(genres)}</p>` : ""}
        <p class="card-overview">${escapeHtml(overview)}</p>
        ${tagline ? `<p class="card-tagline">"${escapeHtml(tagline)}"</p>` : ""}
        <div class="card-stats">
          <div class="stat-field">
            <span class="stat-label">Rating</span>
            <span class="stat-value">${rating}</span>
          </div>
          <div class="stat-field">
            <span class="stat-label">Popularity</span>
            <span class="stat-value">${popularity}</span>
          </div>
          <div class="stat-field match">
            <span class="stat-label">Match</span>
            <span class="stat-value">${matchPct}</span>
          </div>
        </div>
      </div>
    </article>
  `;
}

// ---------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------

function formatGenres(genres) {
  if (!genres) return "";
  if (Array.isArray(genres)) return genres.join(" • ");
  return String(genres).split(/[,|]/).map((g) => g.trim()).filter(Boolean).join(" • ");
}

function formatRating(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "N/A";
}

function formatPopularity(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(1) : "N/A";
}

function formatSimilarity(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return "N/A";
  return `${Math.round(n * 100)}%`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function showLoading() {
  setResultState("loading");
}

function showError() {
  setResultState("error");
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

setResultState("idle");