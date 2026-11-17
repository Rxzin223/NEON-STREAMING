(() => {
  const FAVORITES_KEY = "neon:favorites";
  const PROGRESS_KEY = "neon:progress";
  const AUTO_NEXT_KEY = "neon:auto-next";
  const views = {
    home: document.getElementById("main-view"),
    details: document.getElementById("details-view"),
    player: document.getElementById("player-view")
  };
  const state = {
    works: [],
    session: null,
    oauthClient: null,
    currentView: "home",
    filter: "home",
    selectedWork: null,
    episodes: [],
    search: "",
    autoNext: localStorage.getItem(AUTO_NEXT_KEY) === "true"
  };
  let toastTimer;
  let hideControlsTimer;
  let watchTimer;
  let lastSavedTime = -1;
  let activePlayerCleanup = null;

  const readStore = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key)) || fallback; }
    catch { return fallback; }
  };
  const escapeHtml = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const favorites = () => readStore(FAVORITES_KEY, []);
  const progressStore = () => readStore(PROGRESS_KEY, {});
  const isWatched = (workId, fileId) => (progressStore()[`${workId}:${fileId}`]?.watchedSeconds || 0) >= 180;
  const workProgress = (work) => {
    const items = Object.entries(progressStore()).filter(([key, item]) =>
      key.startsWith(`${work.id}:`) && item.duration > 0 && item.currentTime > 0);
    if (!items.length) return 0;
    return Math.max(...items.map(([, item]) => Math.min(100, item.currentTime / item.duration * 100)));
  };

  async function api(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(result?.error || `Falha na solicitação (${response.status}).`);
    return result;
  }

  function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  function setConnected(session) {
    state.session = session;
    const connected = Boolean(session);
    document.getElementById("drive-status").textContent = connected
      ? `Drive conectado${session.email ? ` · ${session.email}` : ""}`
      : "Drive desconectado";
    document.querySelector(".drive-indicator").classList.toggle("connected", connected);
    document.getElementById("account-email").textContent = session?.email || "";
    document.getElementById("connect-drive").textContent = connected ? "Drive conectado" : "Conectar Drive";
    document.getElementById("connect-drive").classList.toggle("button-outline", true);
  }

  async function connectDrive() {
    try {
      const config = await api("/api/config");
      if (!config.clientId) {
        showToast("Configure GOOGLE_CLIENT_ID no arquivo .env para conectar o Drive.");
        return;
      }
      if (!window.google?.accounts?.oauth2) {
        showToast("O serviço de login do Google ainda está carregando. Tente novamente.");
        return;
      }
      state.oauthClient = window.google.accounts.oauth2.initTokenClient({
        client_id: config.clientId,
        scope: "https://www.googleapis.com/auth/drive.readonly",
        callback: async (tokenResponse) => {
          if (tokenResponse.error) {
            showToast(`Não foi possível conectar ao Drive: ${tokenResponse.error}`);
            return;
          }
          try {
            const session = await api("/api/session", {
              method: "POST",
              body: JSON.stringify({ accessToken: tokenResponse.access_token })
            });
            setConnected(session);
            await loadWorks();
            showToast("Google Drive conectado.");
          } catch (error) {
            showToast(error.message);
          }
        }
      });
      state.oauthClient.requestAccessToken({ prompt: state.session ? "" : "consent" });
    } catch (error) {
      showToast(error.message);
    }
  }

  async function initializeSession() {
    try {
      const session = await api("/api/session");
      setConnected(session.connected ? session : null);
    } catch {
      setConnected(null);
    }
    await loadWorks();
  }

  async function loadWorks() {
    try {
      state.works = await api("/api/works");
      renderWorks();
    } catch (error) {
      showToast(error.message);
    }
  }

  function cardMarkup(work) {
    const saved = favorites().includes(work.id);
    const progress = workProgress(work);
    return `<article class="work-card" data-work-id="${escapeHtml(work.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(work.title)}">
      <div class="poster">
        ${work.cover ? `<img src="${escapeHtml(work.cover)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="poster-placeholder">${escapeHtml(work.title.slice(0, 1).toUpperCase())}</span>`}
        <span class="poster-tag">${progress ? "CONTINUAR" : "SUA COLEÇÃO"}</span>
        <button class="favorite-toggle ${saved ? "is-favorite" : ""}" data-favorite-id="${escapeHtml(work.id)}" aria-label="${saved ? "Remover dos favoritos" : "Adicionar aos favoritos"}">${saved ? "♥" : "♡"}</button>
        <span class="poster-label">${escapeHtml(work.title)}</span>
      </div>
      <div class="card-meta"><span>${escapeHtml(work.synopsis || "Episódios no Google Drive")}</span>${progress ? `<span>${Math.round(progress)}%</span>` : ""}</div>
      ${progress ? `<div class="card-progress"><span style="width:${progress}%"></span></div>` : ""}
    </article>`;
  }

  function renderWorks() {
    const grid = document.getElementById("work-grid");
    const empty = document.getElementById("empty-state");
    const title = document.getElementById("catalog-title");
    const count = document.getElementById("work-count");
    let works = state.works.filter((work) => work.title.toLowerCase().includes(state.search.toLowerCase()));
    if (state.filter === "favorites") {
      works = works.filter((work) => favorites().includes(work.id));
      title.textContent = "Minha lista";
    } else if (state.filter === "continue") {
      works = works.filter((work) => workProgress(work) > 0);
      title.textContent = "Continuar assistindo";
    } else {
      title.textContent = state.search ? "Resultados da busca" : "Sua coleção";
    }
    grid.innerHTML = works.map(cardMarkup).join("");
    count.textContent = `${works.length} ${works.length === 1 ? "obra" : "obras"}`;
    empty.hidden = works.length > 0;
    document.getElementById("empty-title").textContent = state.filter === "favorites"
      ? "Sua lista está esperando por você"
      : state.filter === "continue" ? "Nada para continuar agora" : "Sua próxima aventura começa aqui";
    document.getElementById("empty-message").textContent = state.filter === "favorites"
      ? "Toque no coração de uma obra para encontrá-la aqui."
      : state.filter === "continue" ? "Comece um episódio e ele aparecerá aqui para você continuar."
        : state.search ? "Não encontramos nenhuma obra com esse nome." : "Adicione uma obra e conecte uma pasta do Drive para organizar seus episódios.";
    document.getElementById("empty-add").hidden = state.filter !== "home" || Boolean(state.search);
  }

  function showView(name) {
    Object.entries(views).forEach(([viewName, element]) => { element.hidden = name !== viewName; });
    state.currentView = name;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleFavorite(workId) {
    const current = favorites();
    const next = current.includes(workId) ? current.filter((id) => id !== workId) : [...current, workId];
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
    renderWorks();
  }

  function extractFolderId(value) {
    const input = value.trim();
    const match = input.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input;
  }

  function openModal() {
    if (!state.session) {
      showToast("Conecte seu Google Drive antes de adicionar uma obra.");
      connectDrive();
      return;
    }
    document.getElementById("form-error").textContent = "";
    document.getElementById("work-form").reset();
    document.querySelector('[name="openingSkipSeconds"]').value = "90";
    document.getElementById("work-modal").hidden = false;
    document.querySelector('[name="title"]').focus();
  }

  function closeModal() {
    document.getElementById("work-modal").hidden = true;
  }

  async function submitWork(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitButton = event.currentTarget.querySelector('[type="submit"]');
    submitButton.disabled = true;
    document.getElementById("form-error").textContent = "";
    try {
      const work = await api("/api/works", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title"),
          folderId: extractFolderId(form.get("folder")),
          synopsis: form.get("synopsis"),
          cover: form.get("cover"),
          openingSkipSeconds: Number(form.get("openingSkipSeconds"))
        })
      });
      closeModal();
      await loadWorks();
      showToast("Obra adicionada ao catálogo.");
      await openWork(work);
    } catch (error) {
      document.getElementById("form-error").textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return "0:00";
    const total = Math.floor(seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  function progressFor(workId, fileId) {
    return progressStore()[`${workId}:${fileId}`] || { currentTime: 0, duration: 0, watchedSeconds: 0 };
  }

  async function openWork(work) {
    state.selectedWork = work;
    showView("details");
    const details = views.details;
    details.innerHTML = `<button class="back-button" data-back>← Voltar ao catálogo</button>
      <section class="details-hero">
        ${work.cover ? `<img class="details-cover" src="${escapeHtml(work.cover)}" alt="Capa de ${escapeHtml(work.title)}">` : `<div class="details-cover details-placeholder">${escapeHtml(work.title.slice(0, 1).toUpperCase())}</div>`}
        <div class="details-copy"><span class="section-kicker">SUA COLEÇÃO</span><h1>${escapeHtml(work.title)}</h1>
        <p>${escapeHtml(work.synopsis || "Uma nova história para acompanhar.")}</p>
        <div class="details-actions"><button class="button button-primary" data-play-first>▶ Assistir episódios</button><button class="button button-outline" data-edit-work>Editar informações</button><button class="button button-outline" data-delete-work>Remover obra</button></div></div>
      </section>
      <div class="episodes-header"><h2>Episódios</h2><span class="section-count" data-episode-count>Carregando do Drive...</span></div>
      <div class="episode-list" data-episode-list><div class="error-panel">Buscando arquivos MP4 na pasta compartilhada...</div></div>`;
    try {
      state.episodes = await api(`/api/drive/files?folderId=${encodeURIComponent(work.folderId)}`);
      renderEpisodes(work);
    } catch (error) {
      details.querySelector("[data-episode-count]").textContent = "";
      details.querySelector("[data-episode-list]").innerHTML = `<div class="error-panel">${escapeHtml(error.message)}<br><br>Confirme que a pasta e os episódios foram compartilhados com a conta Google conectada.</div>`;
    }
  }

  function renderEpisodes(work) {
    const list = views.details.querySelector("[data-episode-list]");
    views.details.querySelector("[data-episode-count]").textContent =
      `${state.episodes.length} ${state.episodes.length === 1 ? "episódio" : "episódios"}`;
    if (!state.episodes.length) {
      list.innerHTML = '<div class="error-panel">Nenhum arquivo MP4 foi encontrado diretamente nesta pasta do Drive.</div>';
      return;
    }
    list.innerHTML = state.episodes.map((episode, index) => {
      const progress = progressFor(work.id, episode.id);
      const watched = progress.watchedSeconds >= 180;
      const size = episode.size ? `${(Number(episode.size) / 1024 / 1024).toFixed(0)} MB` : "Vídeo MP4";
      return `<article class="episode-row ${watched ? "is-watched" : ""}">
        <span class="episode-number">${watched ? "✓" : String(index + 1).padStart(2, "0")}</span>
        <div class="episode-info"><strong>${escapeHtml(episode.name.replace(/\.mp4$/i, ""))}</strong><small>${watched ? "Assistido" : size}${progress.currentTime > 0 && !watched ? ` · Retomar em ${formatTime(progress.currentTime)}` : ""}</small></div>
        <button class="button button-outline" data-episode-index="${index}">${progress.currentTime > 0 ? "Continuar" : "Assistir"} ▶</button>
      </article>`;
    }).join("");
  }

  function showControls() {
    const controls = views.player.querySelector(".player-controls");
    if (!controls) return;
    controls.classList.remove("is-hidden");
    clearTimeout(hideControlsTimer);
    hideControlsTimer = setTimeout(() => {
      controls.classList.add("is-hidden");
    }, 3000);
  }

  function savePlayback(video, work, episode) {
    if (!video.duration || !Number.isFinite(video.currentTime)) return;
    const key = `${work.id}:${episode.id}`;
    const store = progressStore();
    const previous = store[key] || { watchedSeconds: 0 };
    store[key] = {
      currentTime: video.currentTime,
      duration: video.duration,
      watchedSeconds: previous.watchedSeconds || 0,
      updatedAt: Date.now()
    };
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(store));
    lastSavedTime = video.currentTime;
  }

  function persistWatchedTime(work, episode, seconds) {
    const key = `${work.id}:${episode.id}`;
    const store = progressStore();
    const previous = store[key] || { currentTime: 0, duration: 0, watchedSeconds: 0 };
    previous.watchedSeconds = (previous.watchedSeconds || 0) + seconds;
    store[key] = previous;
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(store));
    if (previous.watchedSeconds >= 180 && previous.watchedSeconds - seconds < 180) {
      showToast("Episódio marcado como assistido.");
      if (state.currentView === "details") renderEpisodes(work);
      renderWorks();
    }
  }

  function playEpisode(work, index) {
    const episode = state.episodes[index];
    if (!episode) return;
    if (activePlayerCleanup) activePlayerCleanup();
    state.selectedWork = work;
    showView("player");
    views.player.innerHTML = `<section class="player-page">
      <div class="player-heading"><button class="back-button" data-back-details>← Episódios</button><div class="player-title"><strong>${escapeHtml(work.title)}</strong> · Episódio ${index + 1}</div><span></span></div>
      <div class="player-stage">
        <video playsinline preload="metadata" aria-label="${escapeHtml(episode.name)}"></video>
        <div class="player-click-layer" aria-hidden="true"></div>
        <div class="player-top-right">
          <label class="auto-next-label"><input type="checkbox" data-auto-next ${state.autoNext ? "checked" : ""}> Próximo automático</label>
          <button class="player-top-button" data-fullscreen>⛶ Tela cheia</button>
        </div>
        <button class="skip-intro" data-skip-intro hidden>⏭ Pular abertura</button>
        <div class="player-controls">
          <div class="seek-row"><span data-current-time>0:00</span><input data-seek type="range" min="0" max="1000" value="0" aria-label="Posição do episódio"><span data-duration>0:00</span></div>
          <div class="control-row"><button class="skip-control" data-back-10 aria-label="Voltar 10 segundos">↶<small>10</small></button><button class="play-control" data-toggle-play aria-label="Reproduzir">▶</button><button class="skip-control" data-forward-10 aria-label="Avançar 10 segundos">↷<small>10</small></button></div>
        </div>
        <div class="next-overlay" hidden><div class="next-card"><span class="section-kicker">FIM DO EPISÓDIO</span><h3 data-next-title>Pronto para o próximo?</h3><p>Seu progresso já está salvo.</p><button class="button button-primary" data-next-episode>Próximo episódio →</button><button class="text-button" data-back-details style="margin-top:12px">Voltar aos episódios</button></div></div>
      </div>
      <div class="player-below"><div><strong>${escapeHtml(episode.name.replace(/\.mp4$/i, ""))}</strong><span>O progresso é salvo automaticamente neste navegador.</span></div><button data-details-link>Ver episódios</button></div>
    </section>`;

    const video = views.player.querySelector("video");
    const stage = views.player.querySelector(".player-stage");
    const controls = views.player.querySelector(".player-controls");
    const introButton = views.player.querySelector("[data-skip-intro]");
    const saved = progressFor(work.id, episode.id);
    const introSeconds = Number(work.openingSkipSeconds) || 0;
    lastSavedTime = -1;
    video.src = `/api/drive/files/${encodeURIComponent(episode.id)}/content`;
    video.addEventListener("loadedmetadata", () => {
      views.player.querySelector("[data-duration]").textContent = formatTime(video.duration);
      const resumeAt = saved.currentTime > 5 && saved.currentTime < video.duration - 5 ? saved.currentTime : 0;
      if (resumeAt) video.currentTime = resumeAt;
      updatePlayer();
      video.play().then(showControls).catch(showControls);
    }, { once: true });

    function updatePlayer() {
      views.player.querySelector("[data-current-time]").textContent = formatTime(video.currentTime);
      views.player.querySelector("[data-seek]").value = video.duration ? String(video.currentTime / video.duration * 1000) : "0";
      views.player.querySelector("[data-toggle-play]").textContent = video.paused ? "▶" : "Ⅱ";
      introButton.hidden = !introSeconds || video.currentTime >= introSeconds || video.ended;
      if (video.currentTime - lastSavedTime >= 5) savePlayback(video, work, episode);
    }
    video.addEventListener("timeupdate", updatePlayer);
    video.addEventListener("play", () => {
      views.player.querySelector("[data-toggle-play]").textContent = "Ⅱ";
      showControls();
      clearInterval(watchTimer);
      watchTimer = setInterval(() => {
        if (!video.paused && document.visibilityState === "visible") persistWatchedTime(work, episode, 1);
      }, 1000);
    });
    video.addEventListener("pause", () => {
      views.player.querySelector("[data-toggle-play]").textContent = "▶";
      savePlayback(video, work, episode);
      clearInterval(watchTimer);
      controls.classList.remove("is-hidden");
    });
    video.addEventListener("ended", () => {
      savePlayback(video, work, episode);
      clearInterval(watchTimer);
      const overlay = views.player.querySelector(".next-overlay");
      const next = state.episodes[index + 1];
      overlay.hidden = false;
      if (next) {
        views.player.querySelector("[data-next-title]").textContent = `Episódio ${index + 2} · ${next.name.replace(/\.mp4$/i, "")}`;
      } else {
        views.player.querySelector("[data-next-title]").textContent = "Você chegou ao fim desta obra";
        views.player.querySelector("[data-next-episode]").textContent = "Voltar aos episódios";
      }
      if (state.autoNext && next) playEpisode(work, index + 1);
    });
    video.addEventListener("error", () => {
      showToast("Não foi possível reproduzir este vídeo. Verifique a conexão e o acesso ao arquivo no Drive.");
    });
    views.player.querySelector("[data-toggle-play]").addEventListener("click", () => {
      if (video.paused) video.play().catch((error) => showToast(error.message));
      else video.pause();
    });
    views.player.querySelector("[data-back-10]").addEventListener("click", () => { video.currentTime = Math.max(0, video.currentTime - 10); showControls(); });
    views.player.querySelector("[data-forward-10]").addEventListener("click", () => { video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10); showControls(); });
    views.player.querySelector("[data-seek]").addEventListener("input", (event) => {
      if (video.duration) video.currentTime = Number(event.target.value) / 1000 * video.duration;
      showControls();
    });
    introButton.addEventListener("click", () => {
      video.currentTime = introSeconds;
      showControls();
    });
    views.player.querySelector("[data-auto-next]").addEventListener("change", (event) => {
      state.autoNext = event.target.checked;
      localStorage.setItem(AUTO_NEXT_KEY, String(state.autoNext));
    });
    views.player.querySelector("[data-fullscreen]").addEventListener("click", () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else stage.requestFullscreen?.();
    });
    views.player.querySelectorAll("[data-back-details], [data-details-link]").forEach((button) => {
      button.addEventListener("click", () => {
        clearInterval(watchTimer);
        savePlayback(video, work, episode);
        openWork(work);
      });
    });
    views.player.querySelector("[data-next-episode]").addEventListener("click", () => {
      if (state.episodes[index + 1]) playEpisode(work, index + 1);
      else openWork(work);
    });
    stage.addEventListener("click", (event) => {
      if (event.target.closest("button, input, label")) return;
      const rect = stage.getBoundingClientRect();
      if (event.detail > 1) {
        video.currentTime = event.clientX - rect.left < rect.width / 2
          ? Math.max(0, video.currentTime - 10)
          : Math.min(video.duration || Infinity, video.currentTime + 10);
        showControls();
      } else {
        controls.classList.contains("is-hidden") ? showControls() : controls.classList.add("is-hidden");
      }
    });
    stage.addEventListener("mousemove", showControls);
    document.addEventListener("keydown", handlePlayerKeys);
    video.addEventListener("emptied", () => document.removeEventListener("keydown", handlePlayerKeys), { once: true });

    function handlePlayerKeys(event) {
      if (state.currentView !== "player" || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      if (event.code === "Space") {
        event.preventDefault();
        if (video.paused) video.play().catch((error) => showToast(error.message));
        else video.pause();
      } else if (event.code === "ArrowRight") video.currentTime = Math.min(video.duration || Infinity, video.currentTime + 10);
      else if (event.code === "ArrowLeft") video.currentTime = Math.max(0, video.currentTime - 10);
      else if (event.code === "Escape" && document.fullscreenElement) document.exitFullscreen();
      showControls();
    }

    activePlayerCleanup = () => {
      clearInterval(watchTimer);
      clearTimeout(hideControlsTimer);
      document.removeEventListener("keydown", handlePlayerKeys);
      savePlayback(video, work, episode);
      video.pause();
    };
    showControls();
    video.load();
  }

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.view;
      document.querySelectorAll("[data-view]").forEach((nav) => nav.classList.toggle("active", nav === button));
      showView("home");
      renderWorks();
    });
  });
  document.getElementById("connect-drive").addEventListener("click", connectDrive);
  document.getElementById("connect-drive-secondary").addEventListener("click", connectDrive);
  document.getElementById("add-work").addEventListener("click", openModal);
  document.getElementById("hero-add").addEventListener("click", openModal);
  document.getElementById("empty-add").addEventListener("click", openModal);
  document.getElementById("close-modal").addEventListener("click", closeModal);
  document.getElementById("cancel-modal").addEventListener("click", closeModal);
  document.getElementById("work-modal").addEventListener("click", (event) => {
    if (event.target.id === "work-modal") closeModal();
  });
  document.getElementById("work-form").addEventListener("submit", submitWork);
  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    state.filter = "home";
    document.querySelectorAll("[data-view]").forEach((nav) => nav.classList.toggle("active", nav.dataset.view === "home"));
    if (state.currentView === "home") renderWorks();
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      document.getElementById("search-input").focus();
    }
    if (event.key === "Escape" && !document.getElementById("work-modal").hidden) closeModal();
  });
  document.getElementById("work-grid").addEventListener("click", async (event) => {
    const favoriteButton = event.target.closest("[data-favorite-id]");
    if (favoriteButton) {
      event.stopPropagation();
      toggleFavorite(favoriteButton.dataset.favoriteId);
      return;
    }
    const card = event.target.closest("[data-work-id]");
    const work = state.works.find((item) => item.id === card?.dataset.workId);
    if (work) await openWork(work);
  });
  document.getElementById("work-grid").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.matches("[data-work-id]")) {
      const work = state.works.find((item) => item.id === event.target.dataset.workId);
      if (work) openWork(work);
    }
  });
  views.details.addEventListener("click", async (event) => {
    if (event.target.closest("[data-back]")) {
      showView("home");
      renderWorks();
      return;
    }
    const episodeButton = event.target.closest("[data-episode-index]");
    if (episodeButton) {
      playEpisode(state.selectedWork, Number(episodeButton.dataset.episodeIndex));
      return;
    }
    if (event.target.closest("[data-play-first]")) {
      if (state.episodes.length) playEpisode(state.selectedWork, 0);
      else showToast("Ainda não há arquivos MP4 nesta pasta.");
      return;
    }
    if (event.target.closest("[data-edit-work]")) {
      const work = state.selectedWork;
      const title = window.prompt("Nome da obra:", work.title);
      if (title === null) return;
      const synopsis = window.prompt("Sinopse (opcional):", work.synopsis || "");
      if (synopsis === null) return;
      try {
        await api(`/api/works/${encodeURIComponent(work.id)}`, {
          method: "PUT",
          body: JSON.stringify({ title, synopsis, cover: work.cover, openingSkipSeconds: work.openingSkipSeconds })
        });
        await loadWorks();
        await openWork(state.works.find((item) => item.id === work.id));
      } catch (error) { showToast(error.message); }
      return;
    }
    if (event.target.closest("[data-delete-work]")) {
      if (!window.confirm(`Remover "${state.selectedWork.title}" do catálogo? Os arquivos do Drive não serão apagados.`)) return;
      try {
        await api(`/api/works/${encodeURIComponent(state.selectedWork.id)}`, { method: "DELETE" });
        showView("home");
        await loadWorks();
        showToast("Obra removida do catálogo; os arquivos do Drive continuam intactos.");
      } catch (error) { showToast(error.message); }
    }
  });

  initializeSession();
})();
