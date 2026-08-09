(() => {
  const root = document.querySelector("[data-search-root]");
  if (!root) return;

  const input = root.querySelector("[data-search-input]");
  const status = root.querySelector("[data-search-status]");
  const results = root.querySelector("[data-search-results]");
  const params = new URLSearchParams(window.location.search);
  let index = [];

  const normalize = (value) => String(value || "").toLowerCase().trim();
  const clearResults = () => {
    while (results.firstChild) results.removeChild(results.firstChild);
  };

  const render = (query) => {
    clearResults();
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    if (!terms.length) {
      status.textContent = "Start typing to search the full PicoFlow documentation.";
      return;
    }

    const matches = index
      .map((entry) => {
        const title = normalize(entry.title);
        const lede = normalize(entry.lede);
        const text = normalize(entry.text);
        const score = terms.reduce((total, term) => total + (title.includes(term) ? 10 : 0) + (lede.includes(term) ? 5 : 0) + (text.includes(term) ? 1 : 0), 0);
        return { ...entry, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
      .slice(0, 12);

    status.textContent = matches.length
      ? `${matches.length} result${matches.length === 1 ? "" : "s"} for “${query}”.`
      : `No documentation pages matched “${query}”.`;

    for (const entry of matches) {
      const item = document.createElement("article");
      item.className = "docs-search__result";
      const link = document.createElement("a");
      link.href = entry.url;
      link.textContent = entry.title;
      const section = document.createElement("span");
      section.textContent = entry.section;
      const summary = document.createElement("p");
      summary.textContent = entry.lede || entry.text.slice(0, 220);
      item.append(section, link, summary);
      results.append(item);
    }
  };

  fetch("/docs/search-index.json")
    .then((response) => response.ok ? response.json() : Promise.reject(new Error("search index unavailable")))
    .then((entries) => {
      index = Array.isArray(entries) ? entries : [];
      const initial = params.get("q") || "";
      input.value = initial;
      render(initial);
      input.addEventListener("input", () => render(input.value));
    })
    .catch(() => {
      status.textContent = "The search index could not be loaded. Use the section navigation above.";
    });
})();
