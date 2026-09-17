import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

const STORAGE_KEY = "mermaid-live-lite.projects.v2";
const LEGACY_STORAGE_KEY = "mermaid-live-lite.projects.v1";
const THEME_KEY = "mermaid-live-lite.theme.v1";

const SAMPLE = `flowchart TD
    A[Nhận yêu cầu] --> B{File đã tồn tại?}
    B -->|Có| C[(Database)]
    B -->|Không| D[Download]

    subgraph PROCESS[Media Processing]
        D --> E[FFmpeg]
        E --> F[AI Processing]
    end

    F --> G[Upload]
    G --> C`;

const SHAPES = [
  { value: "rect", label: "Chữ nhật", open: "[", close: "]" },
  { value: "rounded", label: "Bo tròn", open: "(", close: ")" },
  { value: "stadium", label: "Stadium", open: "([", close: "])" },
  { value: "subroutine", label: "Subroutine", open: "[[", close: "]]" },
  { value: "cylinder", label: "Database", open: "[(", close: ")]" },
  { value: "circle", label: "Hình tròn", open: "((", close: "))" },
  { value: "diamond", label: "Điều kiện", open: "{", close: "}" },
  { value: "hexagon", label: "Lục giác", open: "{{", close: "}}" }
];

function uid() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function loadProjects() {
  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {}
  }
  return [{ id: uid(), name: "Pipeline đầu tiên", code: SAMPLE, updatedAt: Date.now() }];
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeLabel(value) {
  return String(value || "Node")
    .replace(/[\r\n]+/g, " ")
    .replace(/[\[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Node";
}

function safeMermaidId(value, fallback = "N") {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/^([^A-Za-z_])/, "_$1");
  return normalized || fallback;
}

function parseSubgraphs(code) {
  const lines = code.split("\n");
  const stack = [];
  const result = [];

  lines.forEach((line, index) => {
    const match = line.match(/^\s*subgraph\s+([A-Za-z0-9_-]+)(?:\s*\[([^\]]*)\])?\s*$/i);
    if (match) {
      stack.push({ id: match[1], title: match[2] || match[1], start: index });
      return;
    }
    if (/^\s*end\s*$/i.test(line) && stack.length) {
      const item = stack.pop();
      result.push({ ...item, end: index });
    }
  });

  return result.sort((a, b) => a.start - b.start);
}

function shapeRegex(shape, nodeId) {
  const sid = escapeRegExp(nodeId);
  const open = escapeRegExp(shape.open);
  const close = escapeRegExp(shape.close);
  return new RegExp(`(^|[^A-Za-z0-9_-])(${sid})\\s*${open}([^\\n]*?)${close}`, "m");
}

function findNodeDefinition(code, nodeId) {
  for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
    const match = code.match(shapeRegex(shape, nodeId));
    if (match) return { shape: shape.value, label: match[3], match };
  }
  return { shape: "rect", label: nodeId };
}

function nodeSyntax(nodeId, label, shapeValue) {
  const shape = SHAPES.find((item) => item.value === shapeValue) || SHAPES[0];
  return `${nodeId}${shape.open}${safeLabel(label)}${shape.close}`;
}

function replaceNodeDefinition(code, nodeId, label, shapeValue) {
  const replacement = nodeSyntax(nodeId, label, shapeValue);
  for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
    const regex = shapeRegex(shape, nodeId);
    if (regex.test(code)) {
      return code.replace(regex, (_, prefix) => `${prefix}${replacement}`);
    }
  }
  return insertAtRoot(code, `    ${replacement}`);
}

function stripNodeShapeEverywhere(code, nodeId) {
  let output = code;
  for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
    const sid = escapeRegExp(nodeId);
    const open = escapeRegExp(shape.open);
    const close = escapeRegExp(shape.close);
    const regex = new RegExp(`(^|[^A-Za-z0-9_-])(${sid})\\s*${open}([^\\n]*?)${close}`, "gm");
    output = output.replace(regex, (_, prefix) => `${prefix}${nodeId}`);
  }
  return output;
}

function removeStandaloneNodeLine(code, nodeId) {
  const sid = escapeRegExp(nodeId);
  return code
    .split("\n")
    .filter((line) => !new RegExp(`^\\s*${sid}\\s*$`).test(line))
    .join("\n");
}

function insertAtRoot(code, line) {
  const lines = code.split("\n");
  const headerIndex = lines.findIndex((item) => /^\s*(flowchart|graph)\b/i.test(item));
  lines.splice(headerIndex >= 0 ? headerIndex + 1 : 0, 0, line);
  return lines.join("\n");
}

function insertIntoSubgraph(code, subgraphId, line) {
  const groups = parseSubgraphs(code);
  const group = groups.find((item) => item.id === subgraphId);
  if (!group) return insertAtRoot(code, line.trimStart());
  const lines = code.split("\n");
  lines.splice(group.end, 0, `        ${line.trim()}`);
  return lines.join("\n");
}

function moveNodeToSubgraph(code, nodeId, targetSubgraphId) {
  const def = findNodeDefinition(code, nodeId);
  let output = stripNodeShapeEverywhere(code, nodeId);
  output = removeStandaloneNodeLine(output, nodeId);
  const declaration = nodeSyntax(nodeId, def.label || nodeId, def.shape);
  return targetSubgraphId
    ? insertIntoSubgraph(output, targetSubgraphId, declaration)
    : insertAtRoot(output, `    ${declaration}`);
}

function addSubgraphToCode(code, subgraphId, title) {
  const block = `\n    subgraph ${subgraphId}[${safeLabel(title)}]\n    end`;
  return `${code.trimEnd()}${block}\n`;
}

function nextNodeId(code) {
  let index = 1;
  while (new RegExp(`(^|[^A-Za-z0-9_-])N${index}([^A-Za-z0-9_-]|$)`, "m").test(code)) index += 1;
  return `N${index}`;
}

function nextSubgraphId(code) {
  const groups = parseSubgraphs(code);
  let index = 1;
  while (groups.some((group) => group.id === `SG${index}`)) index += 1;
  return `SG${index}`;
}

function findNodeSubgraph(code, nodeId) {
  const lines = code.split("\n");
  const groups = parseSubgraphs(code);
  const sid = escapeRegExp(nodeId);
  let lineIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(`(^|[^A-Za-z0-9_-])${sid}(?:\\s*[\\[({>]|[^A-Za-z0-9_-]|$)`).test(lines[i])) {
      lineIndex = i;
      break;
    }
  }

  if (lineIndex < 0) return "";
  const containers = groups
    .filter((group) => lineIndex > group.start && lineIndex < group.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start));
  return containers[0]?.id || "";
}

function extractNodeId(element) {
  const dataId = element.getAttribute("data-id") || element.dataset?.id;
  if (dataId) return dataId;
  const raw = element.id || "";
  const flowchartMatch = raw.match(/^flowchart-(.+?)-\d+$/);
  if (flowchartMatch) return flowchartMatch[1];
  const nodeMatch = raw.match(/^(.+?)-\d+$/);
  return nodeMatch ? nodeMatch[1] : raw;
}

function extractClusterId(element) {
  return element.getAttribute("data-id") || element.dataset?.id || element.id || "";
}

export default function App() {
  const firstLoad = useMemo(() => loadProjects(), []);
  const [projects, setProjects] = useState(firstLoad);
  const [activeId, setActiveId] = useState(firstLoad[0]?.id);
  const [theme, setTheme] = useState(() => localStorage.getItem(THEME_KEY) || "dark");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [selected, setSelected] = useState(null);
  const [nodeLabel, setNodeLabel] = useState("");
  const [nodeShape, setNodeShape] = useState("rect");
  const [nodeTarget, setNodeTarget] = useState("");
  const [newSubgraphTitle, setNewSubgraphTitle] = useState("Nhóm mới");
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const renderSeq = useRef(0);
  const fileInput = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const panRef = useRef(null);

  const active = useMemo(
    () => projects.find((p) => p.id === activeId) ?? projects[0],
    [projects, activeId]
  );
  const subgraphs = useMemo(() => parseSubgraphs(active?.code || ""), [active?.code]);

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
    setSelected(null);
    setView({ x: 0, y: 0, scale: 1 });
  }, [active?.id]);

  useEffect(() => {
    if (!active) return;

    const timer = setTimeout(async () => {
      const seq = ++renderSeq.current;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: theme === "dark" ? "dark" : "default",
        flowchart: { useMaxWidth: false, htmlLabels: true },
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
    }, 220);

    return () => clearTimeout(timer);
  }, [active?.code, active?.id, theme]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !svg) return;

    const onClick = (event) => {
      const node = event.target.closest?.("g.node");
      if (node) {
        event.stopPropagation();
        const nodeId = extractNodeId(node);
        const def = findNodeDefinition(active.code, nodeId);
        setSelected({ type: "node", id: nodeId });
        setNodeLabel(def.label || nodeId);
        setNodeShape(def.shape || "rect");
        setNodeTarget(findNodeSubgraph(active.code, nodeId));
        return;
      }

      const cluster = event.target.closest?.("g.cluster");
      if (cluster) {
        event.stopPropagation();
        const clusterId = extractClusterId(cluster);
        const group = subgraphs.find((item) => item.id === clusterId) ||
          subgraphs.find((item) => cluster.textContent?.includes(item.title));
        if (group) {
          setSelected({ type: "subgraph", id: group.id });
          setNodeTarget(group.id);
        }
        return;
      }

      setSelected(null);
    };

    canvas.addEventListener("click", onClick);
    return () => canvas.removeEventListener("click", onClick);
  }, [svg, active?.code, subgraphs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.querySelectorAll(".visual-selected").forEach((el) => el.classList.remove("visual-selected"));
    if (!selected) return;

    if (selected.type === "node") {
      canvas.querySelectorAll("g.node").forEach((el) => {
        if (extractNodeId(el) === selected.id) el.classList.add("visual-selected");
      });
    } else {
      canvas.querySelectorAll("g.cluster").forEach((el) => {
        const cid = extractClusterId(el);
        const group = subgraphs.find((item) => item.id === selected.id);
        if (cid === selected.id || (group && el.textContent?.includes(group.title))) {
          el.classList.add("visual-selected");
        }
      });
    }
  }, [selected, svg, subgraphs]);

  function updateActive(patch) {
    if (!active) return;
    setProjects((items) => items.map((p) =>
      p.id === active.id ? { ...p, ...patch, updatedAt: Date.now() } : p
    ));
  }

  function updateCode(code) {
    updateActive({ code });
  }

  function createProject() {
    const p = {
      id: uid(),
      name: `Sơ đồ ${projects.length + 1}`,
      code: "flowchart TD\n    A[Start] --> B[End]",
      updatedAt: Date.now()
    };
    setProjects((items) => [p, ...items]);
    setActiveId(p.id);
  }

  function deleteProject(projectId) {
    if (projects.length === 1) {
      const reset = { id: uid(), name: "Pipeline đầu tiên", code: SAMPLE, updatedAt: Date.now() };
      setProjects([reset]);
      setActiveId(reset.id);
      return;
    }
    const idx = projects.findIndex((p) => p.id === projectId);
    const next = projects.filter((p) => p.id !== projectId);
    setProjects(next);
    if (projectId === activeId) setActiveId(next[Math.max(0, idx - 1)]?.id ?? next[0]?.id);
  }

  async function copyCode() {
    await navigator.clipboard.writeText(active?.code || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  function exportMmd() {
    if (!active) return;
    downloadBlob(new Blob([active.code], { type: "text/plain;charset=utf-8" }), `${safeFilename(active.name)}.mmd`);
  }

  function exportSvg() {
    if (!active || !svg || error) return;
    downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(active.name)}.svg`);
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
    const p = { id: uid(), name, code, updatedAt: Date.now() };
    setProjects((items) => [p, ...items]);
    setActiveId(p.id);
  }

  function addNode(connectFromSelected = false) {
    const nodeId = nextNodeId(active.code);
    const declaration = nodeSyntax(nodeId, `Node ${nodeId}`, "rect");
    const target = selected?.type === "subgraph" ? selected.id : nodeTarget;
    let code = target
      ? insertIntoSubgraph(active.code, target, declaration)
      : insertAtRoot(active.code, `    ${declaration}`);

    if (connectFromSelected && selected?.type === "node") {
      code = `${code.trimEnd()}\n    ${selected.id} --> ${nodeId}\n`;
    }

    updateCode(code);
    setSelected({ type: "node", id: nodeId });
    setNodeLabel(`Node ${nodeId}`);
    setNodeShape("rect");
    setNodeTarget(target || "");
  }

  function applyNodeChanges() {
    if (selected?.type !== "node") return;
    let code = replaceNodeDefinition(active.code, selected.id, nodeLabel, nodeShape);
    code = moveNodeToSubgraph(code, selected.id, nodeTarget);
    updateCode(code);
  }

  function moveSelectedTo(target) {
    if (selected?.type !== "node") return;
    const code = moveNodeToSubgraph(active.code, selected.id, target);
    setNodeTarget(target);
    updateCode(code);
  }

  function addSubgraph() {
    const sgId = nextSubgraphId(active.code);
    updateCode(addSubgraphToCode(active.code, sgId, newSubgraphTitle || sgId));
    setSelected({ type: "subgraph", id: sgId });
    setNodeTarget(sgId);
    setNewSubgraphTitle("Nhóm mới");
  }

  function zoomBy(delta) {
    setView((v) => ({ ...v, scale: Math.min(3, Math.max(0.25, Number((v.scale + delta).toFixed(2)))) }));
  }

  function resetView() {
    setView({ x: 0, y: 0, scale: 1 });
  }

  function handleWheel(event) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1);
  }

  function handlePointerDown(event) {
    if (event.button !== 0) return;
    if (event.target.closest?.("g.node, g.cluster, button, input, select, textarea")) return;
    panRef.current = { startX: event.clientX, startY: event.clientY, x: view.x, y: view.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    if (!panRef.current) return;
    const p = panRef.current;
    setView((v) => ({ ...v, x: p.x + event.clientX - p.startX, y: p.y + event.clientY - p.startY }));
  }

  function handlePointerUp() {
    panRef.current = null;
  }

  if (!active) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>Mermaid Live Lite</strong><span>Visual editor + Mermaid source</span></div>
        </div>

        <div className="toolbar">
          <button onClick={() => addNode(false)}>＋ Node</button>
          <button onClick={() => addNode(true)} disabled={selected?.type !== "node"}>＋ Node nối tiếp</button>
          <button onClick={addSubgraph}>＋ Subgraph</button>
          <button onClick={copyCode}>{copied ? "Đã copy" : "Copy code"}</button>
          <button onClick={openImport}>Import .mmd</button>
          <button onClick={exportMmd}>Export .mmd</button>
          <button onClick={exportSvg} disabled={!!error || !svg}>Export SVG</button>
          <button className="icon-button" title="Đổi giao diện" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
          <input ref={fileInput} type="file" accept=".mmd,.mermaid,.txt,.md,text/plain" hidden onChange={importMmd} />
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar">
          <button className="new-project" onClick={createProject}>＋ Sơ đồ mới</button>
          <div className="project-list">
            {projects.slice().sort((a, b) => b.updatedAt - a.updatedAt).map((p) => (
              <div key={p.id} className={`project-row ${p.id === active.id ? "active" : ""}`} onClick={() => setActiveId(p.id)}>
                <div className="project-meta"><strong>{p.name}</strong><span>{new Date(p.updatedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span></div>
                <button className="delete" title="Xóa" onClick={(e) => { e.stopPropagation(); deleteProject(p.id); }}>×</button>
              </div>
            ))}
          </div>
          <div className="sidebar-note">Click node/subgraph trực tiếp trên canvas để chỉnh. Kéo vùng trống để di chuyển; Ctrl + lăn chuột để zoom.</div>
        </aside>

        <section className="editor-pane">
          <div className="pane-header">
            <input className="title-input" value={active.name} onChange={(e) => updateActive({ name: e.target.value })} aria-label="Tên sơ đồ" />
            <span className="status">{error ? "Syntax error" : "Live"}</span>
          </div>
          <textarea className="code-editor" spellCheck="false" value={active.code} onChange={(e) => updateCode(e.target.value)} aria-label="Mermaid code" />
          {error && <div className="error-box"><strong>Mermaid không render được</strong><pre>{error}</pre></div>}
        </section>

        <section className="preview-pane">
          <div className="pane-header visual-header">
            <strong>Visual Canvas</strong>
            <div className="canvas-controls">
              <button onClick={() => zoomBy(-0.1)} title="Thu nhỏ">−</button>
              <span>{Math.round(view.scale * 100)}%</span>
              <button onClick={() => zoomBy(0.1)} title="Phóng to">＋</button>
              <button onClick={resetView}>Reset view</button>
            </div>
          </div>

          <div
            className="preview-scroll visual-viewport"
            ref={viewportRef}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <div
              className="canvas-stage"
              ref={canvasRef}
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
            >
              {svg ? <div className="diagram" dangerouslySetInnerHTML={{ __html: svg }} /> : <div className="empty-state">Nhập Mermaid code để render sơ đồ.</div>}
            </div>
          </div>

          <div className="inspector">
            <div className="inspector-title">
              <strong>Inspector</strong>
              <span>{selected ? `${selected.type}: ${selected.id}` : "Chưa chọn đối tượng"}</span>
            </div>

            {selected?.type === "node" ? (
              <div className="inspector-grid">
                <label>ID<input value={selected.id} disabled /></label>
                <label>Nhãn<input value={nodeLabel} onChange={(e) => setNodeLabel(e.target.value)} /></label>
                <label>Hình dạng<select value={nodeShape} onChange={(e) => setNodeShape(e.target.value)}>{SHAPES.map((shape) => <option key={shape.value} value={shape.value}>{shape.label}</option>)}</select></label>
                <label>Thuộc subgraph<select value={nodeTarget} onChange={(e) => setNodeTarget(e.target.value)}><option value="">Root / ngoài subgraph</option>{subgraphs.map((group) => <option key={group.id} value={group.id}>{group.title} ({group.id})</option>)}</select></label>
                <div className="inspector-actions">
                  <button className="primary" onClick={applyNodeChanges}>Áp dụng</button>
                  <button onClick={() => moveSelectedTo(nodeTarget)}>Di chuyển vào nhóm</button>
                  <button onClick={() => addNode(true)}>Thêm node nối tiếp</button>
                </div>
              </div>
            ) : selected?.type === "subgraph" ? (
              <div className="subgraph-tools">
                <p>Node mới sẽ được thêm trực tiếp vào <strong>{selected.id}</strong>.</p>
                <button className="primary" onClick={() => addNode(false)}>＋ Thêm node vào subgraph</button>
              </div>
            ) : (
              <div className="subgraph-tools">
                <label>Tên subgraph mới<input value={newSubgraphTitle} onChange={(e) => setNewSubgraphTitle(e.target.value)} /></label>
                <button className="primary" onClick={addSubgraph}>＋ Tạo subgraph</button>
                <p>Chọn node trên canvas để đổi shape, đổi tên hoặc chuyển node vào subgraph.</p>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
