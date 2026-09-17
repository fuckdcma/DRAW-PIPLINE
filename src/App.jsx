import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

const STORAGE_KEY = "mermaid-live-lite.projects.v1";
const THEME_KEY = "mermaid-live-lite.theme.v1";

const SAMPLE = `flowchart TD
    A[Nhận yêu cầu] --> B{File đã tồn tại?}
    B -->|Có| C[(Database)]
    B -->|Không| D[Download]
    D --> E[FFmpeg]
    E --> F[AI Processing]
    F --> G[Upload]
    G --> C`;

function id() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function initialProjects() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return [{
    id: id(),
    name: "Pipeline đầu tiên",
    code: SAMPLE,
    updatedAt: Date.now()
  }];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeFilename(name) {
  return (name || "diagram")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80) || "diagram";
}

export default function App() {
  const [projects, setProjects] = useState(initialProjects);
  const [activeId, setActiveId] = useState(() => initialProjects()[0]?.id);
  const [theme, setTheme] = useState(
    () => localStorage.getItem(THEME_KEY) || "dark"
  );
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const renderSeq = useRef(0);
  const fileInput = useRef(null);

  const active = useMemo(
    () => projects.find((p) => p.id === activeId) ?? projects[0],
    [projects, activeId]
  );

  useEffect(() => {
    if (!active && projects[0]) setActiveId(projects[0].id);
  }, [active, projects]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }, [projects]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(async () => {
      const seq = ++renderSeq.current;

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "default",
        flowchart: { useMaxWidth: false },
        suppressErrorRendering: true
      });

      try {
        await mermaid.parse(active.code);
        const renderId = `mermaid-${active.id.replace(/[^a-zA-Z0-9]/g, "")}-${seq}`;
        const result = await mermaid.render(renderId, active.code);
        if (seq !== renderSeq.current) return;
        setSvg(result.svg);
        setError("");
      } catch (e) {
        if (seq !== renderSeq.current) return;
        setError(e?.message || String(e));
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [active?.code, active?.id, theme]);

  function updateActive(patch) {
    if (!active) return;
    setProjects((items) =>
      items.map((p) =>
        p.id === active.id
          ? { ...p, ...patch, updatedAt: Date.now() }
          : p
      )
    );
  }

  function createProject() {
    const p = {
      id: id(),
      name: `Sơ đồ ${projects.length + 1}`,
      code: "flowchart TD\n    A[Start] --> B[End]",
      updatedAt: Date.now()
    };
    setProjects((items) => [p, ...items]);
    setActiveId(p.id);
  }

  function deleteProject(projectId) {
    if (projects.length === 1) {
      const reset = {
        id: id(),
        name: "Pipeline đầu tiên",
        code: SAMPLE,
        updatedAt: Date.now()
      };
      setProjects([reset]);
      setActiveId(reset.id);
      return;
    }

    const idx = projects.findIndex((p) => p.id === projectId);
    const next = projects.filter((p) => p.id !== projectId);
    setProjects(next);

    if (projectId === activeId) {
      setActiveId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id);
    }
  }

  async function copyCode() {
    await navigator.clipboard.writeText(active?.code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function exportMmd() {
    if (!active) return;
    downloadBlob(
      new Blob([active.code], { type: "text/plain;charset=utf-8" }),
      `${safeFilename(active.name)}.mmd`
    );
  }

  function exportSvg() {
    if (!active || !svg || error) return;
    downloadBlob(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
      `${safeFilename(active.name)}.svg`
    );
  }

  function openImport() {
    fileInput.current?.click();
  }

  async function importMmd(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const code = await file.text();
    const name = file.name.replace(/\.(mmd|mermaid|txt|md)$/i, "") || "Imported";
    const p = { id: id(), name, code, updatedAt: Date.now() };
    setProjects((items) => [p, ...items]);
    setActiveId(p.id);
  }

  if (!active) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div>
            <strong>Mermaid Live Lite</strong>
            <span>Local-first · không cần backend</span>
          </div>
        </div>

        <div className="toolbar">
          <button onClick={copyCode}>{copied ? "Đã copy" : "Copy code"}</button>
          <button onClick={openImport}>Import .mmd</button>
          <button onClick={exportMmd}>Export .mmd</button>
          <button onClick={exportSvg} disabled={!!error || !svg}>Export SVG</button>
          <button
            className="icon-button"
            title="Đổi giao diện"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".mmd,.mermaid,.txt,.md,text/plain"
            hidden
            onChange={importMmd}
          />
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <button className="new-project" onClick={createProject}>＋ Sơ đồ mới</button>
          <div className="project-list">
            {projects
              .slice()
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((p) => (
                <div
                  key={p.id}
                  className={`project-row ${p.id === active.id ? "active" : ""}`}
                  onClick={() => setActiveId(p.id)}
                >
                  <div className="project-meta">
                    <strong>{p.name}</strong>
                    <span>
                      {new Date(p.updatedAt).toLocaleString("vi-VN", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit"
                      })}
                    </span>
                  </div>
                  <button
                    className="delete"
                    title="Xóa"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteProject(p.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
          </div>
          <div className="sidebar-note">
            Dữ liệu được lưu trong <code>localStorage</code> của trình duyệt.
          </div>
        </aside>

        <section className="editor-pane">
          <div className="pane-header">
            <input
              className="title-input"
              value={active.name}
              onChange={(e) => updateActive({ name: e.target.value })}
              aria-label="Tên sơ đồ"
            />
            <span className="status">{error ? "Syntax error" : "Live"}</span>
          </div>

          <textarea
            className="code-editor"
            spellCheck="false"
            value={active.code}
            onChange={(e) => updateActive({ code: e.target.value })}
            aria-label="Mermaid code"
          />

          {error && (
            <div className="error-box">
              <strong>Mermaid không render được</strong>
              <pre>{error}</pre>
            </div>
          )}
        </section>

        <section className="preview-pane">
          <div className="pane-header">
            <strong>Preview</strong>
            <span>{error ? "Giữ preview gần nhất" : "SVG"}</span>
          </div>
          <div className="preview-scroll">
            {svg ? (
              <div
                className="diagram"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : (
              <div className="empty-state">Nhập Mermaid code để render sơ đồ.</div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
