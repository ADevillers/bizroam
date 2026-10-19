import React, {
  useEffect,
  useLayoutEffect,
  useState,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Compass,
  Settings2,
  MapPin,
  Clock,
  Play,
  Pause,
  X,
  Plus,
  Check,
  LockKeyhole,
  Loader2,
  ExternalLink,
  Trash2,
  LogOut,
  Navigation,
  LocateFixed,
} from "lucide-react";
import { MapView } from "./map";
import {
  sourcedCompanyValue,
  formatCompanyValue,
  companyValueKind,
} from "../../../packages/shared/src/company-value";
import {
  loadPreferences,
  savePreferences,
  loadEncounters,
  saveEncounters,
  clearHistory,
} from "./storage";
import {
  defaultPreferences,
  safeUrl,
  type Preferences,
  type WalkState,
  type LocationSample,
  type CompanyCandidate,
  type CompanyProfile,
  type Encounter,
} from "../../../packages/shared/src/schema";
import "./style.css";
// Invitation credentials stay out of HTTP URLs and are removed before API calls.
const invitation = new URLSearchParams(window.location.hash.slice(1));
let invitationPassword = invitation.get("password");
if (invitationPassword !== null) {
  invitation.delete("password");
  window.history.replaceState(
    null,
    "",
    window.location.pathname +
      window.location.search +
      (invitation.size ? `#${invitation.toString()}` : ""),
  );
  if (!invitationPassword || invitationPassword.length > 200)
    invitationPassword = null;
}
let csrf = "";
async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const r = await fetch(`/api${path}`, {
    method: body === undefined ? "GET" : method,
    signal: AbortSignal.timeout(15000),
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}
const formatDistance = (d: number) =>
  d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`;
const time = (n: number) =>
  new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(
    n,
  );
function Brand() {
  return (
    <span className="brand">
      bizroam<span className="brand-mark">↗</span>
    </span>
  );
}
function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [error, setError] = useState("");
  const [config, setConfig] = useState<{
      configured: boolean;
    } | null>(null),
    [prefs, setPrefs] = useState<Preferences>(defaultPreferences),
    [settings, setSettings] = useState(false),
    [newTag, setNewTag] = useState("");
  const [walk, setWalk] = useState<WalkState | null>(null),
    [history, setHistory] = useState<Encounter[]>([]),
    [position, setPosition] = useState<LocationSample | null>(null),
    [starting, setStarting] = useState(false),
    [tab, setTab] = useState<"nearby" | "history">("nearby"),
    [selected, setSelected] = useState<string | null>(null),
    [toast, setToast] = useState(""),
    [recenter, setRecenter] = useState(0),
    [expanded, setExpanded] = useState(false),
    [connected, setConnected] = useState(true);
  const walkRef = useRef<WalkState | null>(null),
    positionRef = useRef<LocationSample | null>(null),
    lastSend = useRef(0),
    seenEvents = useRef(new Set<number>()),
    openedAt = useRef(Date.now()),
    active = useRef(false);
  walkRef.current = walk;
  positionRef.current = position;
  useEffect(() => {
    if (auth === true) invitationPassword = null;
    if (auth !== false || !invitationPassword) return;
    const supplied = invitationPassword;
    invitationPassword = null;
    void signIn(supplied);
  }, [auth]);
  useLayoutEffect(() => {
    api<any>("/session")
      .then((d) => {
        csrf = d.csrf || "";
        setAuth(d.authenticated);
      })
      .catch(() => {
        setAuth(false);
        setError("Could not connect. Try again.");
      });
    loadPreferences().then((p) => {
      if (p) setPrefs(p);
    });
    loadEncounters().then(setHistory);
  }, []);
  useEffect(() => {
    if (!auth) return;
    api<any>("/config")
      .then(setConfig)
      .catch((e) => setError(e.message));
    const id = sessionStorage.getItem("bizroam-walk");
    if (id)
      api<WalkState>(`/walks/${id}/state`)
        .then(async (state) => {
          if (sessionStorage.getItem("bizroam-active") === "true") {
            active.current = true;
            state = await api<WalkState>(`/walks/${id}/resume`, {});
          }
          setWalk(state);
        })
        .catch(() => sessionStorage.removeItem("bizroam-walk"));
  }, [auth]);
  useEffect(() => {
    if (!auth || config?.configured) return;
    const timer = setInterval(() => {
      api<any>("/config")
        .then(setConfig)
        .catch(() => {});
    }, 10000);
    return () => clearInterval(timer);
  }, [auth, config?.configured]);
  const ingest = useCallback(async (state: WalkState) => {
    setWalk(state);
    setConfig((old) => (old ? { ...old, configured: state.configured } : old));
    if (state.encounters.length) {
      await saveEncounters(state.encounters);
      setHistory(await loadEncounters());
    }
    for (const e of state.events) {
      if (seenEvents.current.has(e.id)) continue;
      seenEvents.current.add(e.id);
      if (e.type === "company.ready" && e.createdAt >= openedAt.current) {
        const profile = state.profiles.find((p) => p.id === e.data.companyId);
        if (profile) setToast(`${profile.name} — a new discovery`);
      }
    }
  }, []);
  useEffect(() => {
    if (!walk?.id) return;
    const es = new EventSource(`/api/walks/${walk.id}/events`);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    es.addEventListener("discovery", () => {
      setConnected(true);
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = undefined;
        api<WalkState>(`/walks/${walk.id}/state`)
          .then(ingest)
          .catch((e) => setError(e.message));
      }, 250);
    });
    es.onerror = () => setConnected(false);
    es.onopen = () => setConnected(true);
    return () => {
      es.close();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [walk?.id, ingest]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!walk?.id) return;
    const id = walk.id;
    const send = async () => {
      const p = positionRef.current;
      if (!p || !active.current || document.hidden) return;
      try {
        await ingest(
          await api<WalkState>(`/walks/${id}/location`, {
            ...p,
            visible: true,
          }),
        );
      } catch (e: any) {
        setError(e.message);
      }
    };
    const timer = setInterval(send, 10000);
    const onVisibility = () => {
      if (document.hidden) {
        if (active.current) api(`/walks/${id}/pause`, {}).catch(() => {});
      } else if (active.current) {
        api(`/walks/${id}/resume`, {})
          .then(send)
          .catch((e: any) => setError(e.message));
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [walk?.id, ingest]);
  useEffect(() => {
    if (!walk?.id) return;
    let watch: number;
    watch = navigator.geolocation.watchPosition(
      async (p) => {
        const sample = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          timestamp: p.timestamp,
          visible: !document.hidden,
        };
        setPosition(sample);
        positionRef.current = sample;
        if (
          active.current &&
          !document.hidden &&
          Date.now() - lastSend.current >= 5000
        ) {
          lastSend.current = Date.now();
          api<WalkState>(`/walks/${walk.id}/location`, sample)
            .then(ingest)
            .catch((e: any) => setError(e.message));
        }
      },
      (e) => {
        setError(
          e.code === 1
            ? "Location access is off. Enable it in your browser settings."
            : positionRef.current
              ? "Could not refresh your location. Your last position is still on the map."
              : "Could not get your location. Please try again.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [walk?.id, ingest]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    await signIn(password);
  }
  async function signIn(suppliedPassword: string) {
    setLoginBusy(true);
    setError("");
    try {
      const d = await api<any>("/auth/login", { password: suppliedPassword });
      csrf = d.csrf;
      setPassword("");
      setAuth(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPassword("");
      setLoginBusy(false);
    }
  }
  async function start() {
    setStarting(true);
    setError("");
    try {
      if (!navigator.geolocation)
        throw new Error("This browser does not support location.");
      const p = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        }),
      );
      const sample = {
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        timestamp: p.timestamp,
        visible: true,
      };
      const result = walk
        ? { id: walk.id }
        : await api<{ id: string }>("/walks", prefs);
      sessionStorage.setItem("bizroam-walk", result.id);
      if (walk) await api(`/walks/${result.id}/resume`, {});
      active.current = true;
      sessionStorage.setItem("bizroam-active", "true");
      positionRef.current = sample;
      setPosition(sample);
      await ingest(
        await api<WalkState>(`/walks/${result.id}/location`, sample),
      );
    } catch (e: any) {
      setError(
        e.code === 1
          ? "Allow location access to discover companies around you."
          : e.message || "Could not get your location.",
      );
    } finally {
      setStarting(false);
    }
  }
  async function pause() {
    if (!walk) return;
    active.current = false;
    sessionStorage.setItem("bizroam-active", "false");
    try {
      await ingest(await api<WalkState>(`/walks/${walk.id}/pause`, {}));
    } catch (e: any) {
      setError(e.message);
    }
  }
  async function updatePrefs() {
    await savePreferences(prefs);
    if (walk)
      await ingest(
        await api<WalkState>(`/walks/${walk.id}/preferences`, prefs, "PATCH"),
      );
    setSettings(false);
  }
  const [restoredPlaces, setRestoredPlaces] = useState<
    Record<string, CompanyCandidate>
  >({});
  const hydrationAttempted = useRef(new Set<string>());
  useEffect(() => {
    if (!auth || tab !== "history" || !config?.configured) return;
    let cancelled = false;
    (async () => {
      for (const h of history.filter((h) => !h.profile?.address).slice(0, 10)) {
        if (hydrationAttempted.current.has(h.id)) continue;
        hydrationAttempted.current.add(h.id);
        try {
          const place = await api<CompanyCandidate>(
            `/places/${encodeURIComponent(h.id)}`,
          );
          if (!cancelled)
            setRestoredPlaces((old) => ({ ...old, [h.id]: place }));
        } catch {
          /* A sourced profile or another active walk may still supply these details later. */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auth, tab, history, config?.configured]);
  const candidates = walk?.candidates || [];
  const profile =
    walk?.profiles.find((p) => p.id === selected) ||
    history.find((h) => h.id === selected)?.profile;
  const candidate =
    candidates.find((c) => c.id === selected) ||
    history.find((h) => h.id === selected)?.place ||
    (selected ? restoredPlaces[selected] : undefined);
  const companyValue = sourcedCompanyValue(profile);
  const isRunning = walk && ["active", "researching"].includes(walk.status);
  const select = useCallback((id: string) => setSelected(id), []);
  if (auth === null)
    return (
      <div className="loading-screen">
        <Brand />
        <Loader2 className="spin" size={22} />
      </div>
    );
  if (!auth)
    return (
      <div className="login-page">
        <header>
          <Brand />
          <span className="eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</span>
        </header>
        <div className="login-layout">
          <section className="login-story">
            <span className="pill">
              <Compass size={14} /> LOOK A LITTLE CLOSER
            </span>
            <h1>
              There’s a story
              <br />
              behind every
              <br />
              <span>front door.</span>
            </h1>
            <p>
              The companies you walk past.
              <br />
              The ideas you didn’t know were there.
            </p>
            <div className="story-coordinates">
              <span>37.7749° N</span>
              <span>122.4194° W</span>
              <ArrowUpRight size={20} />
            </div>
          </section>
          <section className="login-panel">
            <div className="login-symbol">
              <ArrowUpRight size={34} />
            </div>
            <span className="eyebrow">YOUR CITY, A LITTLE LESS UNKNOWN</span>
            <h2>
              Welcome to
              <br />
              the neighbourhood.
            </h2>
            <p>
              Your personal guide to the companies
              <br className="desktop-only" /> hiding in plain sight.
            </p>
            <form onSubmit={login}>
              <label htmlFor="password">Access password</label>
              <div className="password-input">
                <LockKeyhole size={17} />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your invitation starts here"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              <button className="primary wide" disabled={loginBusy}>
                {loginBusy ? (
                  <Loader2 size={18} className="spin" />
                ) : (
                  <>
                    Let’s explore <ArrowRight size={18} />
                  </>
                )}
              </button>
            </form>
            <span className="private-note">
              <LockKeyhole size={12} /> A private space for curious people.
            </span>
          </section>
        </div>
        <footer>
          <span>Discover the companies hiding in plain sight.</span>
          <span>BUILT TO WANDER ↗</span>
        </footer>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <div className="header-middle">
          <span className="live-dot" />
          {walk?.status === "researching"
            ? "RESEARCHING NEARBY COMPANIES"
            : isRunning
              ? "WALK ACTIVE · FOLLOWING YOUR LOCATION"
              : "YOUR NEXT DISCOVERY AWAITS"}
        </div>
        <button
          className="icon-button"
          aria-label="Preferences"
          onClick={() => setSettings(true)}
        >
          <Settings2 size={20} />
        </button>
      </header>
      <main className="explore-layout">
        <section className="map-wrap">
          <MapView
            position={position}
            candidates={candidates}
            onSelect={select}
            recenter={recenter}
          />
          <div className="map-top">
            <span className="location-pill">
              <MapPin size={14} />
              {position
                ? `${position.lat.toFixed(3)}°, ${position.lng.toFixed(3)}°`
                : "Somewhere interesting"}
            </span>
            <span className="radius-pill">500 m discovery radius</span>
          </div>
          <div className="map-bottom">
            <div className="walk-status">
              <span className={`status-orb ${isRunning ? "on" : ""}`} />
              <div>
                <strong>
                  {starting
                    ? "Finding your location…"
                    : walk?.status === "researching"
                      ? "Your agent is exploring"
                      : isRunning
                        ? "You walk. We connect the dots."
                        : "A good day to get curious."}
                </strong>
                <span>
                  {!connected
                    ? "Reconnecting to your discoveries…"
                    : walk?.message ||
                      (position && position.accuracy > 50
                        ? `Location accuracy: ~${Math.round(position.accuracy)} m · discovery is available`
                        : "A new perspective on the places around you.")}
                </span>
              </div>
            </div>
            <button
              className="primary walk-button"
              onClick={isRunning ? pause : start}
              disabled={starting || walk?.status === "limited"}
            >
              {starting ? (
                <Loader2 size={16} className="spin" />
              ) : isRunning ? (
                <>
                  <Pause size={15} /> Pause walk
                </>
              ) : (
                <>
                  <Play size={15} /> {walk ? "Resume walk" : "Start exploring"}
                </>
              )}
            </button>
          </div>
        </section>
        <aside className={`discovery-panel ${expanded ? "expanded" : ""}`}>
          <button
            className="mobile-handle"
            aria-label="Expand discoveries"
            onClick={() => setExpanded(!expanded)}
          >
            <span />
            {expanded ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <div className="panel-heading">
            <span className="eyebrow">
              GOOD THINGS ARE CLOSER THAN YOU THINK
            </span>
            <h1>
              Around the corner<span>.</span>
            </h1>
            <p>Small discoveries. Bigger possibilities.</p>
          </div>
          <div className="tabs">
            <button
              className={tab === "nearby" ? "active" : ""}
              onClick={() => setTab("nearby")}
            >
              <Compass size={16} /> Nearby <span>{candidates.length}</span>
            </button>
            <button
              className={tab === "history" ? "active" : ""}
              onClick={() => setTab("history")}
            >
              <Clock size={16} /> Passed by <span>{history.length}</span>
            </button>
          </div>
          <div className="filter-row">
            <span>Looking for</span>
            <button onClick={() => setSettings(true)}>
              {prefs.tags[0] || "Interesting companies"}
              {prefs.tags.length > 1 ? ` +${prefs.tags.length - 1}` : ""}
              <Settings2 size={12} />
            </button>
          </div>
          <div className="cards-scroll">
            {error && (
              <div className="notice error" role="alert">
                {error}
                <button aria-label="Dismiss error" onClick={() => setError("")}>
                  <X size={15} />
                </button>
              </div>
            )}
            {config && !config.configured && (
              <div className="notice">
                <span className="notice-dot" />
                <div>
                  <strong>Your guide is getting ready</strong>
                  <p>
                    Company discovery will be available once the research
                    connections are ready.
                  </p>
                </div>
              </div>
            )}
            {tab === "nearby" ? (
              candidates.length ? (
                candidates.map((c, i) => (
                  <CompanyCard
                    key={c.id}
                    c={c}
                    index={i}
                    onClick={() => setSelected(c.id)}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <div className="empty-icon">
                    <Compass size={30} />
                  </div>
                  <h2>Let the city surprise you.</h2>
                  <p>
                    {walk?.status === "researching"
                      ? "Your agent is looking for companies that match your interests. Discoveries will appear here."
                      : "Start a walk to uncover the companies, products and ideas in your neighbourhood."}
                  </p>
                  <div className="empty-steps">
                    <span>
                      <Navigation size={14} /> Follow your curiosity
                    </span>
                    <span>
                      <MapPin size={14} /> Discover something nearby
                    </span>
                    <span>
                      <Clock size={14} /> Keep the places you pass
                    </span>
                  </div>
                </div>
              )
            ) : history.length ? (
              <>
                <div className="history-intro">
                  Your collection of chance encounters.
                </div>
                {[...history]
                  .sort((a, b) => b.lastSeen - a.lastSeen)
                  .map((h, i) => (
                    <CompanyCard
                      key={h.id}
                      c={{
                        id: h.id,
                        name:
                          h.profile?.name ||
                          h.place?.name ||
                          restoredPlaces[h.id]?.name ||
                          "A company you passed",
                        address:
                          h.profile?.address ||
                          h.place?.address ||
                          restoredPlaces[h.id]?.address ||
                          "Address verification pending",
                        lat: 0,
                        lng: 0,
                        distance: 0,
                        status: h.profile ? "ready" : "discovered",
                        profile: h.profile,
                      }}
                      index={i}
                      timeLabel={time(h.lastSeen)}
                      onClick={() => setSelected(h.id)}
                    />
                  ))}
                <button
                  className="clear-history"
                  onClick={async () => {
                    await clearHistory();
                    setHistory([]);
                  }}
                >
                  <Trash2 size={14} /> Clear your collection
                </button>
              </>
            ) : (
              <div className="empty-state">
                <div className="empty-icon">
                  <Clock size={28} />
                </div>
                <h2>A little trail of discovery.</h2>
                <p>
                  Companies you pass within 100 metres will land here, ready for
                  a closer look later.
                </p>
              </div>
            )}
          </div>
          <div className="panel-footer">
            <span className="tiny-mark">↗</span> THE WORLD IS MORE INTERESTING
            UP CLOSE.
          </div>
        </aside>
      </main>
      {toast && (
        <div className="toast" role="status">
          <span className="toast-icon">
            <Check size={17} />
          </span>
          <span>{toast}</span>
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <section
            className="modal preferences"
            role="dialog"
            aria-modal="true"
            aria-label="Discovery preferences"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="eyebrow">MAKE IT YOUR NEIGHBOURHOOD</span>
              <button
                className="icon-button"
                aria-label="Close preferences"
                onClick={() => setSettings(false)}
              >
                <X size={20} />
              </button>
            </div>
            <h2>
              What catches
              <br />
              your attention?
            </h2>
            <p>Point your guide towards the things you care about.</p>
            <label>Your interests</label>
            <div className="tags">
              {prefs.tags.map((t) => (
                <button
                  key={t}
                  onClick={() =>
                    setPrefs({
                      ...prefs,
                      tags: prefs.tags.filter((x) => x !== t),
                    })
                  }
                >
                  {t}
                  <X size={12} />
                </button>
              ))}
            </div>
            <form
              className="add-tag"
              onSubmit={(e) => {
                e.preventDefault();
                if (newTag.trim() && prefs.tags.length < 10)
                  setPrefs({
                    ...prefs,
                    tags: [
                      ...new Set([...prefs.tags, newTag.trim().slice(0, 50)]),
                    ],
                  });
                setNewTag("");
              }}
            >
              <input
                aria-label="Add an interest"
                value={newTag}
                maxLength={50}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="AI, robotics, climate tech…"
              />
              <button aria-label="Add interest">
                <Plus size={18} />
              </button>
            </form>
            <label htmlFor="preferences-text">Anything else?</label>
            <textarea
              id="preferences-text"
              maxLength={600}
              value={prefs.text}
              onChange={(e) => setPrefs({ ...prefs, text: e.target.value })}
              placeholder="I’m curious about companies building useful developer tools…"
            />
            <button
              className="primary wide"
              onClick={() =>
                updatePrefs().catch((e: any) => setError(e.message))
              }
            >
              Save my preferences <ArrowRight size={17} />
            </button>
            <button
              className="logout"
              onClick={async () => {
                active.current = false;
                sessionStorage.removeItem("bizroam-active");
                if (walk) await api(`/walks/${walk.id}/pause`, {});
                await api("/auth/logout", {});
                setAuth(false);
                setWalk(null);
                sessionStorage.removeItem("bizroam-walk");
                setSettings(false);
              }}
            >
              <LogOut size={14} /> Sign out
            </button>
          </section>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal company-detail"
            role="dialog"
            aria-modal="true"
            aria-label="Company profile"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-heading">
              <span className="eyebrow">A CLOSER LOOK</span>
              <button
                className="icon-button"
                aria-label="Close company profile"
                onClick={() => setSelected(null)}
              >
                <X size={20} />
              </button>
            </div>
            <div className="company-monogram large">
              {(profile?.name || candidate?.name || "?").slice(0, 1)}
            </div>
            <h2>
              {profile?.name || candidate?.name || "Discovery in progress"}
            </h2>
            <div className="detail-tags">
              {profile?.tags.map((t) => (
                <span key={t}>{t}</span>
              ))}
            </div>
            <p className="description">
              {profile?.description ||
                "Your guide is researching this company. Check back shortly for a sourced profile."}
            </p>
            <div className="address-block">
              <MapPin size={18} />
              <div>
                <strong>
                  {profile?.address ||
                    candidate?.address ||
                    "Address verification pending"}
                </strong>
                <span>
                  {profile?.addressVerified
                    ? "Address supported by web sources"
                    : "Location not independently verified"}
                </span>
              </div>
            </div>
            {profile?.reason && (
              <div className="why-block">
                <span className="eyebrow">WHY IT CAUGHT OUR EYE</span>
                <p>{profile.reason}</p>
              </div>
            )}
            {profile?.product && (
              <div className="detail-section">
                <h3>What they’re building</h3>
                <p>{profile.product}</p>
              </div>
            )}
            {profile?.fact && (
              <div className="detail-section">
                <h3>A little more to the story</h3>
                <p>{profile.fact}</p>
              </div>
            )}
            {profile?.founders.length ? (
              <div className="detail-section">
                <h3>Founded by</h3>
                <p>{profile.founders.join(", ")}</p>
              </div>
            ) : null}
            {profile?.funding && (
              <div className="detail-section">
                <h3>Funding</h3>
                <p>
                  {profile.funding.amount} {profile.funding.currency} ·{" "}
                  {profile.funding.date}
                </p>
              </div>
            )}
            {profile && (
              <div className="detail-section company-value-detail">
                <h3>Reported company value</h3>
                {companyValue ? (
                  <>
                    <p>
                      <strong>
                        {formatCompanyValue(companyValue.amountUsd)}
                      </strong>{" "}
                      USD · {companyValueKind(companyValue.kind)} ·{" "}
                      {companyValue.asOf}
                    </p>
                    <a
                      href={companyValue.source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View value source <ExternalLink size={12} />
                    </a>
                    <p>
                      Historical reported value, not a live estimate. Map
                      circles use a logarithmic scale.
                    </p>
                  </>
                ) : (
                  <p>N/A — no dated, sourced value available.</p>
                )}
              </div>
            )}
            {profile && (
              <div className="detail-section sources">
                <h3>
                  Go straight to the source <ArrowUpRight size={16} />
                </h3>
                {profile.sources
                  .filter((s) => safeUrl(s.url))
                  .map((s) => (
                    <a
                      href={s.url}
                      key={s.url}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {s.title}
                      <ExternalLink size={13} />
                    </a>
                  ))}
                <span className="research-date">
                  Researched{" "}
                  {new Date(profile.researchedAt).toLocaleDateString("en")}
                </span>
              </div>
            )}
            {!!profile?.discussions?.length && (
              <section className="profile-section">
                <h3>From the tech community</h3>
                <div className="source-links">
                  {profile.discussions
                    .filter((d) => safeUrl(d.url))
                    .map((d) => (
                      <a
                        key={d.url}
                        href={d.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {d.title}
                        <ExternalLink size={13} />
                      </a>
                    ))}
                </div>
              </section>
            )}
            {candidate && !profile?.address && (
              <span className="place-attribution">
                Location information: OpenStreetMap
              </span>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function CompanyCard({
  c,
  index,
  onClick,
  timeLabel,
}: {
  c: CompanyCandidate;
  index: number;
  onClick: () => void;
  timeLabel?: string;
}) {
  return (
    <button className="company-card" onClick={onClick}>
      <div className="card-top">
        <div className={`company-monogram tone-${index % 3}`}>
          {c.name.slice(0, 1)}
        </div>
        <span className="card-distance">
          {timeLabel ? (
            <>
              <Clock size={12} />
              {timeLabel}
            </>
          ) : (
            <>
              <MapPin size={12} />
              {formatDistance(c.distance)}
            </>
          )}
        </span>
        <ArrowUpRight size={18} className="card-arrow" />
      </div>
      <div className="card-tags">
        {c.profile?.tags.slice(0, 2).join(" · ") || "NEIGHBOURHOOD DISCOVERY"}
      </div>
      <h3>{c.profile?.name || c.name}</h3>
      <p>
        {c.profile?.description ||
          (c.status === "failed"
            ? "Research is unavailable right now."
            : "A company worth getting to know. Your guide is taking a closer look.")}
      </p>
      <div className="card-bottom">
        <span>
          <MapPin size={12} />
          {c.profile?.address || c.address || "Address verification pending"}
        </span>
        {!c.profile && <Loader2 size={14} className="spin" />}
      </div>
      {!c.profile && <span className="place-attribution">OpenStreetMap</span>}
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
