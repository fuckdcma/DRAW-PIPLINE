import { useEffect, useMemo, useRef, useState } from "react";
import mermaid from "mermaid";

const STORAGE_KEY = "mermaid-live-lite.projects.v2";
const LEGACY_STORAGE_KEY = "mermaid-live-lite.projects.v1";
const THEME_KEY = "mermaid-live-lite.theme.v1";

const SAMPLE = `flowchart TD

    subgraph PROCESS["Media Processing"]
        D["Download"]
        E["FFmpeg"]
        F["AI Processing"]
    end

    A["Nhận yêu cầu"] --> B["File đã tồn tại?"]
    B -->|Có| C["Database"]
    B -->|Không| D
    D --> E
    E --> F
    F --> G["Upload"]
    G --> C

    A@{ shape: rect}
    B@{ shape: diam}
    C@{ shape: cyl}
    D@{ shape: rect}
    E@{ shape: rect}
    F@{ shape: rect}
    G@{ shape: rect}`;

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

const SHAPE_DIRECTIVES = {
  rect: "rect",
  rounded: "rounded",
  stadium: "stadium",
  subroutine: "subroutine",
  cylinder: "cyl",
  circle: "circle",
  diamond: "diam",
  hexagon: "hex"
};

function mermaidString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
}

function decodeMermaidLabel(value) {
  const raw = String(value ?? "").trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    const inner = raw.slice(1, -1);
    if (raw.startsWith('"')) {
      try {
        return JSON.parse(`"${inner}"`);
      } catch {}
    }
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  }
  return raw;
}

function canonicalNodeDeclaration(nodeId, label) {
  return `${nodeId}["${mermaidString(safeLabel(label))}"]`;
}

function shapeValueFromDirective(raw) {
  const normalized = String(raw || "").toLowerCase();
  return (
    Object.entries(SHAPE_DIRECTIVES).find(([, value]) => value === normalized)?.[0] ||
    ({ decision: "diamond", cylinder: "cylinder" }[normalized] || "rect")
  );
}

function upsertShapeDirective(code, nodeId, shapeValue) {
  const sid = escapeRegExp(nodeId);
  const shapeCode = SHAPE_DIRECTIVES[shapeValue] || "rect";
  const directive = `${nodeId}@{ shape: ${shapeCode}}`;
  const shapeRegex = new RegExp(
    `(^|\\n)(\\s*)${sid}\\s*@\\{\\s*shape\\s*:\\s*[^}]+\\}`,
    "mi"
  );

  if (shapeRegex.test(code)) {
    return code.replace(
      shapeRegex,
      (_, prefix, indent) => `${prefix}${indent}${directive}`
    );
  }

  return `${code.trimEnd()}\n    ${directive}\n`;
}

function removeShapeDirective(code, nodeId) {
  const sid = escapeRegExp(nodeId);
  return code
    .split("\n")
    .filter(
      (line) =>
        !new RegExp(`^\\s*${sid}\\s*@\\{\\s*shape\\s*:`, "i").test(line)
    )
    .join("\n");
}

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
      const rawTitle = (match[2] || match[1]).trim();
      const title = rawTitle.replace(/^(["'])|(["'])$/g, "") || match[1];
      stack.push({ id: match[1], title, start: index });
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
  const sid = escapeRegExp(nodeId);

  // Mermaid's newer generic node syntax: n1@{ label: "Text" }
  const generic = code.match(new RegExp(`(^|\\n)\\s*${sid}\\s*@\\{([\\s\\S]*?)\\}`, "m"));
  let genericLabel = "";
  if (generic) {
    const quoted = generic[2].match(/\blabel\s*:\s*"((?:\\.|[^"\\])*)"/i);
    if (quoted) {
      try { genericLabel = JSON.parse(`"${quoted[1]}"`); } catch { genericLabel = quoted[1]; }
    }
  }

  let directiveShape = "";
  const directives = Array.from(code.matchAll(new RegExp(`(^|\\n)\\s*${sid}\\s*@\\{([^}]*)\\}`, "gmi")));
  for (const match of directives) {
    const shapeMatch = match[2].match(/\bshape\s*:\s*([A-Za-z0-9_-]+)/i);
    if (shapeMatch) {
      const raw = shapeMatch[1].toLowerCase();
      directiveShape = shapeValueFromDirective(raw);
    }
  }

  for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
    const match = code.match(shapeRegex(shape, nodeId));
    if (match) return {
      shape: directiveShape || shape.value,
      label: genericLabel || decodeMermaidLabel(match[3]),
      match
    };
  }

  if (generic) return { shape: directiveShape || "rect", label: genericLabel || nodeId, match: generic };
  return { shape: directiveShape || "rect", label: nodeId };
}

function nodeSyntax(nodeId, label, shapeValue) {
  // Keep label syntax stable and compatible with the imported Mermaid Chart source.
  // Shape is stored separately as `nodeId@{ shape: ... }`.
  return canonicalNodeDeclaration(nodeId, label);
}

function replaceNodeDefinition(code, nodeId, label, shapeValue) {
  const sid = escapeRegExp(nodeId);
  const cleanLabel = safeLabel(label);
  let output = code;

  // Preserve a generic `@{ label: "..." }` declaration if the imported
  // source already uses it (usually for complex HTML labels).
  const genericLabelRegex = new RegExp(
    `(^|\\n)(\\s*)${sid}\\s*@\\{([\\s\\S]*?\\blabel\\s*:[\\s\\S]*?)\\}`,
    "m"
  );
  const genericMatch = output.match(genericLabelRegex);

  if (genericMatch) {
    const body = genericMatch[3].replace(
      /\blabel\s*:\s*"((?:\\.|[^"\\])*)"/i,
      `label: "${mermaidString(cleanLabel)}"`
    );
    output = output.replace(
      genericLabelRegex,
      (_, prefix, indent) => `${prefix}${indent}${nodeId}@{${body}}`
    );
  } else {
    // Normalize any old shape-encoded declaration such as:
    // n1([Text]), n1{Text}, n1((Text)) -> n1["Text"]
    let replaced = false;
    for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
      const regex = shapeRegex(shape, nodeId);
      if (regex.test(output)) {
        output = output.replace(
          regex,
          (_, prefix) => `${prefix}${canonicalNodeDeclaration(nodeId, cleanLabel)}`
        );
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      output = insertAtRoot(
        output,
        `    ${canonicalNodeDeclaration(nodeId, cleanLabel)}`
      );
    }
  }

  // Shape is always a separate Mermaid directive, matching the source style:
  // n64["List Movies"]
  // n64@{ shape: rect}
  return upsertShapeDirective(output, nodeId, shapeValue);
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
  let output = code;

  // Remove only the declaration from its current location. Keep connections.
  for (const shape of SHAPES.slice().sort((a, b) => b.open.length - a.open.length)) {
    const sid = escapeRegExp(nodeId);
    const open = escapeRegExp(shape.open);
    const close = escapeRegExp(shape.close);
    const standalone = new RegExp(
      `^\\s*${sid}\\s*${open}[^\\n]*?${close}\\s*$`
    );
    output = output
      .split("\n")
      .filter((line) => !standalone.test(line))
      .join("\n");
  }

  // Generic label declarations are also valid standalone node declarations.
  const sid = escapeRegExp(nodeId);
  output = output
    .split("\n")
    .filter(
      (line) =>
        !new RegExp(
          `^\\s*${sid}\\s*@\\{[^}]*\\blabel\\s*:`,
          "i"
        ).test(line)
    )
    .join("\n");

  const declaration = canonicalNodeDeclaration(
    nodeId,
    def.label || nodeId
  );

  output = targetSubgraphId
    ? insertIntoSubgraph(output, targetSubgraphId, declaration)
    : insertAtRoot(output, `    ${declaration}`);

  return upsertShapeDirective(output, nodeId, def.shape || "rect");
}

function addSubgraphToCode(code, subgraphId, title, defaultNodeId) {
  const nodeId = defaultNodeId || "N1";
  const block =
    `\n    subgraph ${subgraphId}["${mermaidString(safeLabel(title))}"]` +
    `\n        ${canonicalNodeDeclaration(nodeId, "Untitled Node")}` +
    `\n    end`;
  return upsertShapeDirective(`${code.trimEnd()}${block}\n`, nodeId, "rect");
}

function addEdgeToCode(code, sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return code;
  const edgePattern = new RegExp(`(^|\\n)\\s*${escapeRegExp(sourceId)}\\s*--+>\\s*${escapeRegExp(targetId)}(?:\\s|$)`, "m");
  if (edgePattern.test(code)) return code;
  return `${code.trimEnd()}\n    ${sourceId} --> ${targetId}\n`;
}

function removeTargetFromEdgeLine(line, sourceId, targetId) {
  const sid = escapeRegExp(sourceId);
  const tid = escapeRegExp(targetId);
  if (!new RegExp(`^\\s*${sid}\\b`).test(line) || !/-->|==>|-.->|---/.test(line)) return line;

  // Remove one destination from Mermaid fan-out syntax: A --> B & C & D
  const arrowMatch = line.match(/^(\s*[^=\n]*?)(-->|==>|-.->|---)([\s\S]*)$/);
  if (!arrowMatch) return line;
  const prefix = arrowMatch[1];
  const arrow = arrowMatch[2];
  const rhs = arrowMatch[3];
  const parts = rhs.split(/\s*&\s*/);
  const kept = parts.filter((part) => !new RegExp(`^\\s*${tid}(?:\\b|\\s*[\\[({@])`).test(part));
  if (kept.length === parts.length) return line;
  if (!kept.length) return "";
  return `${prefix}${arrow} ${kept.map((p) => p.trim()).join(" & ")}`;
}

function removeNodeFromCode(code, nodeId) {
  const sid = escapeRegExp(nodeId);
  const lines = code.split("\n");
  const out = [];

  for (const original of lines) {
    let line = original;
    const trimmed = line.trim();

    // Dedicated declaration / style line for this node.
    if (new RegExp(`^${sid}\\s*(?:@\\{|\\[|\\(|\\{)`, "i").test(trimmed)) continue;

    // If the deleted node is the source of an edge, remove that edge statement.
    if (new RegExp(`^${sid}\\b`, "i").test(trimmed) && /-->|==>|-.->|---/.test(trimmed)) continue;

    // Remove it when it is one member of a fan-out destination list.
    const sourceMatch = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\b/);
    if (sourceMatch && /-->|==>|-.->|---/.test(line)) {
      line = removeTargetFromEdgeLine(line, sourceMatch[1], nodeId);
      if (!line.trim()) continue;
    }

    // Conservative fallback for one-to-one edge statements where the target is the deleted node.
    if (/-->|==>|-.->|---/.test(line) && new RegExp(`(?:-->|==>|-.->|---)\\s*${sid}(?:\\b|\\s*[\\[({@])`, "i").test(line)) continue;

    out.push(line);
  }

  return out.join("\n");
}

function collectNumberedIds(code, prefix) {
  const regex = new RegExp(`\\b${escapeRegExp(prefix)}(\\d+)\\b`, "gi");
  let max = 0;
  for (const match of code.matchAll(regex)) max = Math.max(max, Number(match[1]) || 0);
  return max;
}

function nextNodeId(code) {
  // Continue after the highest existing n/N number instead of filling gaps.
  // Example: n1 ... n64 => n65. This avoids collisions in imported diagrams.
  const max = collectNumberedIds(code, "n");
  return `n${max + 1}`;
}

function nextSubgraphId(code) {
  const max = Math.max(
    collectNumberedIds(code, "s"),
    collectNumberedIds(code, "SG")
  );
  return `s${max + 1}`;
}

function replaceSubgraphTitle(code, subgraphId, title) {
  const sid = escapeRegExp(subgraphId);
  const re = new RegExp(`(^|\\n)(\\s*)subgraph\\s+${sid}(?:\\s*\\[[^\\]]*\\])?`, "mi");
  return code.replace(re, (_, prefix, indent) => `${prefix}${indent}subgraph ${subgraphId}["${mermaidString(safeLabel(title))}"]`);
}

function nodeIdsInsideSubgraph(code, subgraphId) {
  const group = parseSubgraphs(code).find((item) => item.id === subgraphId);
  if (!group) return [];
  const lines = code.split("\n").slice(group.start + 1, group.end);
  const ids = new Set();
  for (const line of lines) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_-]*)\s*(?=@\{|\[|\(|\{)/);
    if (match) ids.add(match[1]);
  }
  return [...ids];
}

function deleteSubgraphFromCode(code, subgraphId) {
  const groups = parseSubgraphs(code);
  const group = groups.find((item) => item.id === subgraphId);
  if (!group) return code;
  const nodeIds = nodeIdsInsideSubgraph(code, subgraphId);
  const lines = code.split("\n");
  lines.splice(group.start, group.end - group.start + 1);
  let output = lines.join("\n");
  for (const nodeId of nodeIds) output = removeNodeFromCode(output, nodeId);
  return output;
}

function removeEdgeFromCode(code, sourceId, targetId) {
  const lines = code.split("\n");
  let removed = false;
  const out = [];
  for (let line of lines) {
    if (!removed) {
      const next = removeTargetFromEdgeLine(line, sourceId, targetId);
      if (next !== line) {
        removed = true;
        line = next;
      } else {
        const sid = escapeRegExp(sourceId);
        const tid = escapeRegExp(targetId);
        if (new RegExp(`^\\s*${sid}\\b[\\s\\S]*?(?:-->|==>|-.->|---)\\s*${tid}(?:\\b|\\s*[\\[({@])`, "i").test(line)) {
          removed = true;
          continue;
        }
      }
    }
    if (line.trim()) out.push(line);
  }
  return out.join("\n");
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
  const explicit =
    element.getAttribute("data-id") ||
    element.getAttribute("data-node-id") ||
    element.getAttribute("data-node") ||
    element.dataset?.id;
  if (explicit) return explicit;

  const raw = element.id || "";
  // Mermaid may prefix generated SVG ids with the render id. We only want
  // the logical id between `flowchart-` and the final numeric occurrence id.
  const flowchartMatch = raw.match(/(?:^|-)flowchart-(.+?)-\d+$/);
  if (flowchartMatch) return flowchartMatch[1];
  return raw;
}

function extractClusterId(element) {
  const explicit = element.getAttribute("data-id") || element.dataset?.id;
  if (explicit) return explicit;
  const raw = element.id || "";
  const match = raw.match(/(?:^|-)cluster-(.+)$/);
  return match ? match[1] : raw;
}

function extractEdgeInfo(element) {
  const candidate = element.closest?.("g.edgePath, g.edgePaths, g") || element;
  const classText = `${candidate?.getAttribute?.("class") || ""} ${element?.getAttribute?.("class") || ""}`;
  const sourceClass = classText.match(/(?:^|\s)LS-([^\s]+)/);
  const targetClass = classText.match(/(?:^|\s)LE-([^\s]+)/);
  if (sourceClass && targetClass) return { source: sourceClass[1], target: targetClass[1] };

  const attrs = [candidate, element];
  for (const el of attrs) {
    if (!el?.getAttribute) continue;
    const source = el.getAttribute("data-source") || el.getAttribute("data-from");
    const target = el.getAttribute("data-target") || el.getAttribute("data-to");
    if (source && target) return { source, target };
    const raw = el.id || "";
    const match = raw.match(/(?:^|-)L_([A-Za-z0-9_-]+)_([A-Za-z0-9_-]+)_\d+$/);
    if (match) return { source: match[1], target: match[2] };
  }
  return null;
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function highlightMermaidLine(line) {
  const tokenRe = /%%.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|https?:\/\/[^\s"']+|-->|==>|-\.->|---|@\{|\b(?:flowchart|graph|subgraph|end|direction|config|layout|classDef|class|style|linkStyle)\b|\b[A-Za-z_][A-Za-z0-9_-]*(?=\s*(?:@\{|\[|\(|\{|-->|==>|-\.->|&))|[\[\]{}()&]/g;
  let out = "";
  let last = 0;
  for (const match of line.matchAll(tokenRe)) {
    out += escapeHtml(line.slice(last, match.index));
    const token = match[0];
    let cls = "tok-punc";
    if (token.startsWith("%%")) cls = "tok-comment";
    else if (token.startsWith('"') || token.startsWith("'")) cls = "tok-string";
    else if (/^https?:\/\//.test(token)) cls = "tok-url";
    else if (/^(-->|==>|-\.->)$/.test(token)) cls = "tok-arrow";
    else if (/^(flowchart|graph|subgraph|end|direction|config|layout|classDef|class|style|linkStyle)$/.test(token)) cls = "tok-keyword";
    else if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(token)) cls = "tok-id";
    else if (token === "@{") cls = "tok-directive";
    out += `<span class="${cls}">${escapeHtml(token)}</span>`;
    last = match.index + token.length;
  }
  out += escapeHtml(line.slice(last));
  return out || " ";
}

function highlightMermaid(code) {
  return String(code ?? "").split("\n").map(highlightMermaidLine).join("\n");
}

function organizeMermaidCode(code) {
  const original = String(code ?? "").replace(/\r\n/g, "\n");
  const all = original.split("\n");
  let index = 0;
  const front = [];

  while (index < all.length && !all[index].trim()) index += 1;
  if (all[index]?.trim() === "---") {
    front.push(all[index++]);
    while (index < all.length) {
      front.push(all[index]);
      if (all[index].trim() === "---" && front.length > 1) {
        index += 1;
        break;
      }
      index += 1;
    }
  }

  while (index < all.length && !all[index].trim()) index += 1;
  const headerIndex = all.slice(index).findIndex((line) => /^\s*(flowchart|graph)\b/i.test(line));
  if (headerIndex < 0) return original;
  const actualHeader = index + headerIndex;
  const prefix = all.slice(index, actualHeader).filter((line) => line.trim());
  const header = all[actualHeader].trim();
  const body = all.slice(actualHeader + 1);

  const subgraphs = [];
  const remaining = [];
  for (let i = 0; i < body.length;) {
    if (/^\s*subgraph\b/i.test(body[i])) {
      const block = [body[i]];
      let depth = 1;
      i += 1;
      while (i < body.length && depth > 0) {
        const line = body[i];
        if (/^\s*subgraph\b/i.test(line)) depth += 1;
        if (/^\s*end\s*$/i.test(line)) depth -= 1;
        block.push(line);
        i += 1;
      }
      subgraphs.push(block.join("\n").trimEnd());
      continue;
    }
    remaining.push(body[i]);
    i += 1;
  }

  const nodes = [];
  const connections = [];
  const shapes = [];
  const other = [];
  for (const raw of remaining) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) continue;
    if (/^[A-Za-z_][A-Za-z0-9_-]*\s*@\{\s*shape\s*:/i.test(t)) shapes.push(`    ${t}`);
    else if (/(-->|==>|-\.->|---)/.test(t)) connections.push(`    ${t}`);
    else if (/^[A-Za-z_][A-Za-z0-9_-]*\s*(?:@\{|\[|\(|\{)/.test(t)) nodes.push(`    ${t}`);
    else other.push(`    ${t}`);
  }

  const sections = [];
  if (front.length) sections.push(front.join("\n"));
  if (prefix.length) sections.push(prefix.join("\n"));
  sections.push(header);
  if (subgraphs.length) sections.push(subgraphs.join("\n\n"));
  if (nodes.length) sections.push(nodes.join("\n"));
  if (connections.length) sections.push(connections.join("\n"));
  if (shapes.length) sections.push(shapes.join("\n"));
  if (other.length) sections.push(other.join("\n"));
  return `${sections.filter(Boolean).join("\n\n").trimEnd()}\n`;
}

function HighlightedCodeEditor({ value, onChange, onBlur, editorRef }) {
  const backdropRef = useRef(null);
  const lineNumberRef = useRef(null);
  const lineCount = Math.max(1, String(value ?? "").split("\n").length);

  const syncScroll = (event) => {
    const el = event.currentTarget;
    if (backdropRef.current) {
      backdropRef.current.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    }
    if (lineNumberRef.current) {
      lineNumberRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
    }
  };

  return (
    <div className="code-editor-shell">
      <div className="code-line-gutter" aria-hidden="true">
        <div ref={lineNumberRef} className="code-line-numbers">
          {Array.from({ length: lineCount }, (_, i) => <span key={i}>{i + 1}</span>)}
        </div>
      </div>
      <div className="code-highlight-viewport" aria-hidden="true">
        <pre ref={backdropRef} className="code-highlight" dangerouslySetInnerHTML={{ __html: highlightMermaid(value) }} />
      </div>
      <textarea
        ref={editorRef}
        className="code-editor code-editor-overlay"
        spellCheck="false"
        wrap="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        onScroll={syncScroll}
        aria-label="Mermaid code"
      />
    </div>
  );
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
  const [newNodeLabel, setNewNodeLabel] = useState("Node mới");
  const [newNodeShape, setNewNodeShape] = useState("rect");
  const [newNodeSubgraph, setNewNodeSubgraph] = useState("");
  const [inlineEdit, setInlineEdit] = useState(null);
  const [inlineSubgraphEdit, setInlineSubgraphEdit] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [editorWidth, setEditorWidth] = useState(430);
  const [connectionDrag, setConnectionDrag] = useState(null);
  const renderSeq = useRef(0);
  const fileInput = useRef(null);
  const viewportRef = useRef(null);
  const canvasRef = useRef(null);
  const panRef = useRef(null);
  const splitterRef = useRef(null);
  const codeEditorRef = useRef(null);

  const active = useMemo(
    () => projects.find((p) => p.id === activeId) ?? projects[0],
    [projects, activeId]
  );
  const subgraphs = useMemo(() => parseSubgraphs(active?.code || ""), [active?.code]);
  const selectedNodeSize = selected?.type === "node"
    ? active?.visual?.nodeSizes?.[selected.id] ?? 100
    : 100;

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
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onWheel = (event) => {
      // Native non-passive handler is required so Ctrl+wheel never reaches
      // Chrome's page zoom while the pointer is inside the canvas.
      event.preventDefault();
      event.stopPropagation();

      if (event.ctrlKey || event.metaKey) {
        const rect = viewport.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        setView((v) => {
          const nextScale = Math.min(3, Math.max(0.25, v.scale * factor));
          const worldX = (mouseX - v.x) / v.scale;
          const worldY = (mouseY - v.y) / v.scale;
          return {
            scale: nextScale,
            x: mouseX - worldX * nextScale,
            y: mouseY - worldY * nextScale
          };
        });
        return;
      }

      if (event.shiftKey) {
        const amount = event.deltaY || event.deltaX;
        setView((v) => ({ ...v, x: v.x - amount }));
        return;
      }

      setView((v) => ({ ...v, y: v.y - event.deltaY }));
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [active?.id]);

  useEffect(() => {
    const editor = codeEditorRef.current;
    if (!editor) return;
    const onEditorWheel = (event) => {
      // Keep wheel scrolling inside the source editor and prevent scroll chaining to the page.
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) editor.scrollLeft += event.deltaY || event.deltaX;
      else editor.scrollTop += event.deltaY;
    };
    editor.addEventListener("wheel", onEditorWheel, { passive: false });
    return () => editor.removeEventListener("wheel", onEditorWheel);
  }, [active?.id]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || !svg) return;

    const selectNode = (node) => {
      const nodeId = extractNodeId(node);
      const def = findNodeDefinition(active.code, nodeId);
      setSelected({ type: "node", id: nodeId });
      setNodeLabel(def.label || nodeId);
      setNodeShape(def.shape || "rect");
      setNodeTarget(findNodeSubgraph(active.code, nodeId));
      return { nodeId, def };
    };

    const findCluster = (target) => {
      const cluster = target.closest?.("g.cluster");
      if (!cluster) return null;
      const clusterId = extractClusterId(cluster);
      return subgraphs.find((item) => item.id === clusterId) ||
        subgraphs.find((item) => cluster.textContent?.includes(item.title)) || null;
    };

    const onClick = (event) => {
      if (event.target.closest?.("g.visual-subgraph-add")) return;
      const node = event.target.closest?.("g.node");
      if (node) {
        event.stopPropagation();
        viewport.focus({ preventScroll: true });
        selectNode(node);
        return;
      }

      const edgeElement = event.target.closest?.("g.edgePath, path.flowchart-link, .edgePaths path, .edgePath path");
      const edgeInfo = edgeElement ? extractEdgeInfo(edgeElement) : null;
      if (edgeInfo) {
        event.stopPropagation();
        viewport.focus({ preventScroll: true });
        setSelected({ type: "edge", source: edgeInfo.source, target: edgeInfo.target, id: `${edgeInfo.source}→${edgeInfo.target}` });
        return;
      }

      const group = findCluster(event.target);
      if (group) {
        event.stopPropagation();
        viewport.focus({ preventScroll: true });
        setSelected({ type: "subgraph", id: group.id });
        setNodeTarget(group.id);
        return;
      }

      setSelected(null);
    };

    const onDoubleClick = (event) => {
      const node = event.target.closest?.("g.node");
      const bounds = viewport.getBoundingClientRect();
      if (node) {
        event.preventDefault();
        event.stopPropagation();
        const { nodeId, def } = selectNode(node);
        const nodeRect = node.getBoundingClientRect();
        setInlineEdit({
          id: nodeId,
          value: def.label || nodeId,
          x: Math.max(2, nodeRect.left - bounds.left),
          y: Math.max(2, nodeRect.top - bounds.top),
          width: Math.max(90, nodeRect.width),
          height: Math.max(36, nodeRect.height)
        });
        return;
      }

      const group = findCluster(event.target);
      if (group) {
        event.preventDefault();
        event.stopPropagation();
        setSelected({ type: "subgraph", id: group.id });
        const cluster = event.target.closest?.("g.cluster");
        const labelEl = cluster?.querySelector?.(".cluster-label") || cluster;
        const labelRect = labelEl?.getBoundingClientRect?.() || cluster?.getBoundingClientRect?.();
        setInlineSubgraphEdit({
          id: group.id,
          value: group.title,
          x: Math.max(2, (labelRect?.left || event.clientX) - bounds.left),
          y: Math.max(2, (labelRect?.top || event.clientY) - bounds.top),
          width: Math.max(120, labelRect?.width || 220),
          height: Math.max(32, labelRect?.height || 38)
        });
      }
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }, [svg, active?.code, subgraphs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.querySelectorAll(".visual-selected").forEach((el) => el.classList.remove("visual-selected"));
    canvas.querySelectorAll(".visual-edge-selected").forEach((el) => el.classList.remove("visual-edge-selected"));
    if (!selected) return;

    if (selected.type === "node") {
      canvas.querySelectorAll("g.node").forEach((el) => {
        if (extractNodeId(el) === selected.id) el.classList.add("visual-selected");
      });
    } else if (selected.type === "subgraph") {
      canvas.querySelectorAll("g.cluster").forEach((el) => {
        const cid = extractClusterId(el);
        const group = subgraphs.find((item) => item.id === selected.id);
        if (cid === selected.id || (group && el.textContent?.includes(group.title))) {
          el.classList.add("visual-selected");
        }
      });
    } else if (selected.type === "edge") {
      canvas.querySelectorAll("g.edgePath, path.flowchart-link, .edgePaths path, .edgePath path").forEach((el) => {
        const info = extractEdgeInfo(el);
        if (info?.source === selected.source && info?.target === selected.target) {
          (el.closest?.("g.edgePath") || el).classList.add("visual-edge-selected");
        }
      });
    }
  }, [selected, svg, subgraphs]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const viewport = viewportRef.current;
    if (!canvas || !viewport || !svg) return;

    canvas.querySelectorAll("g.visual-connect-handle").forEach((el) => el.remove());
    if (selected?.type !== "node") return;

    const node = Array.from(canvas.querySelectorAll("g.node")).find(
      (el) => extractNodeId(el) === selected.id
    );
    if (!node) return;

    let box;
    try {
      box = node.getBBox();
    } catch {
      return;
    }

    const ns = "http://www.w3.org/2000/svg";
    const handle = document.createElementNS(ns, "g");
    handle.setAttribute("class", "visual-connect-handle");
    handle.setAttribute("transform", `translate(${box.x + box.width / 2}, ${box.y + box.height + 13})`);
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", "Click để thêm node nối tiếp, hoặc kéo tới node khác để nối");

    const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", "10");
    const plus = document.createElementNS(ns, "text");
    plus.setAttribute("x", "0");
    plus.setAttribute("y", "4");
    plus.setAttribute("text-anchor", "middle");
    plus.textContent = "+";
    handle.append(circle, plus);

    const stopClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    handle.addEventListener("click", stopClick);
    handle.addEventListener("dblclick", stopClick);

    const onPointerDown = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();

      const viewportRect = viewport.getBoundingClientRect();
      const handleRect = handle.getBoundingClientRect();
      const x1 = handleRect.left + handleRect.width / 2 - viewportRect.left;
      const y1 = handleRect.top + handleRect.height / 2 - viewportRect.top;
      const startClientX = event.clientX;
      const startClientY = event.clientY;

      setConnectionDrag({ sourceId: selected.id, x1, y1, x2: x1, y2: y1 });

      const onMove = (moveEvent) => {
        setConnectionDrag((current) => current ? {
          ...current,
          x2: moveEvent.clientX - viewportRect.left,
          y2: moveEvent.clientY - viewportRect.top
        } : current);
      };

      const onUp = (upEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        setConnectionDrag(null);

        const distance = Math.hypot(upEvent.clientX - startClientX, upEvent.clientY - startClientY);
        const hit = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetNode = hit?.closest?.("g.node");
        const targetId = targetNode ? extractNodeId(targetNode) : "";

        if (targetId && targetId !== selected.id) {
          updateCode(addEdgeToCode(active.code, selected.id, targetId));
          return;
        }

        // A simple click on the + handle creates a new connected node.
        if (distance < 8) addNode(true, "rect");
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    };

    handle.addEventListener("pointerdown", onPointerDown);
    node.appendChild(handle);

    return () => {
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.remove();
    };
  }, [selected, svg, active?.code]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !svg) return;

    canvas.querySelectorAll("g.node").forEach((el) => {
      const id = extractNodeId(el);
      const percent = active?.visual?.nodeSizes?.[id] ?? 100;
      const scale = Math.max(0.6, Math.min(1.8, percent / 100));
      const baseTransform = el.getAttribute("data-base-transform") || el.getAttribute("transform") || "";
      el.setAttribute("data-base-transform", baseTransform.replace(/\s+scale\([^)]*\)\s*$/, ""));
      el.setAttribute("transform", `${el.getAttribute("data-base-transform")} scale(${scale})`.trim());
    });

    canvas.querySelectorAll("g.cluster").forEach((cluster) => {
      cluster.querySelectorAll(":scope > g.visual-subgraph-add").forEach((el) => el.remove());
      const cid = extractClusterId(cluster);
      const group = subgraphs.find((item) => item.id === cid) ||
        subgraphs.find((item) => cluster.textContent?.includes(item.title));
      if (!group) return;
      const rect = cluster.querySelector(":scope > rect");
      if (!rect) return;
      const x = Number(rect.getAttribute("x") || 0);
      const y = Number(rect.getAttribute("y") || 0);
      const width = Number(rect.getAttribute("width") || 0);
      if (!Number.isFinite(width) || width < 90) return;

      const ns = "http://www.w3.org/2000/svg";
      const btn = document.createElementNS(ns, "g");
      btn.setAttribute("class", "visual-subgraph-add");
      btn.setAttribute("transform", `translate(${x + width - 78}, ${y + 7})`);
      btn.setAttribute("role", "button");
      btn.setAttribute("tabindex", "0");
      btn.setAttribute("aria-label", `Thêm node vào ${group.title}`);

      const bg = document.createElementNS(ns, "rect");
      bg.setAttribute("width", "70");
      bg.setAttribute("height", "24");
      bg.setAttribute("rx", "6");
      bg.setAttribute("class", "visual-subgraph-add-bg");
      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", "35");
      text.setAttribute("y", "16");
      text.setAttribute("text-anchor", "middle");
      text.setAttribute("class", "visual-subgraph-add-text");
      text.textContent = "+ Node";
      btn.append(bg, text);

      const run = (event) => {
        event.preventDefault();
        event.stopPropagation();
        addNodeToSubgraph(group.id, "rect");
      };
      btn.addEventListener("click", run);
      btn.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") run(event);
      });
      cluster.appendChild(btn);
    });
  }, [svg, active?.visual, active?.code, subgraphs]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const tag = event.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selected) return;
        event.preventDefault();
        event.stopPropagation();
        deleteSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, active?.code]);

  function updateActive(patch) {
    if (!active) return;
    setProjects((items) => items.map((p) =>
      p.id === active.id ? { ...p, ...patch, updatedAt: Date.now() } : p
    ));
  }

  function updateCode(code, organize = true) {
    updateActive({ code: organize ? organizeMermaidCode(code) : code });
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
    const rendered = canvasRef.current?.querySelector(".diagram svg")?.outerHTML || svg;
    downloadBlob(new Blob([rendered], { type: "image/svg+xml;charset=utf-8" }), `${safeFilename(active.name)}.svg`);
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

  function createNodeFromSidebar() {
    const label = safeLabel(newNodeLabel || "Node mới");
    const target = newNodeSubgraph || "";
    addNode(false, newNodeShape, target, label);
    setNewNodeLabel("Node mới");
  }

  function addNode(connectFromSelected = false, shapeValue = "rect", forcedTarget = null, forcedLabel = null) {
    const nodeId = nextNodeId(active.code);
    const label = forcedLabel || `Node ${nodeId}`;
    const declaration = canonicalNodeDeclaration(nodeId, label);
    const target = forcedTarget ?? (selected?.type === "subgraph" ? selected.id : "");
    let code = target
      ? insertIntoSubgraph(active.code, target, declaration)
      : insertAtRoot(active.code, `    ${declaration}`);

    code = upsertShapeDirective(code, nodeId, shapeValue);

    if (connectFromSelected && selected?.type === "node") {
      code = `${code.trimEnd()}
    ${selected.id} --> ${nodeId}
`;
    }

    updateCode(code);
    setSelected({ type: "node", id: nodeId });
    setNodeLabel(label);
    setNodeShape(shapeValue);
    setNodeTarget(target || "");
  }

  function addNodeToSubgraph(subgraphId, shapeValue = "rect") {
    addNode(false, shapeValue, subgraphId);
  }

  function applyNodeChanges() {
    if (selected?.type !== "node") return;
    let code = replaceNodeDefinition(active.code, selected.id, nodeLabel, nodeShape);
    code = moveNodeToSubgraph(code, selected.id, nodeTarget);
    updateCode(code);
  }

  function commitInlineEdit() {
    if (!inlineEdit?.id) return;
    const def = findNodeDefinition(active.code, inlineEdit.id);
    const code = replaceNodeDefinition(active.code, inlineEdit.id, inlineEdit.value, def.shape);
    updateCode(code);
    setNodeLabel(safeLabel(inlineEdit.value));
    setInlineEdit(null);
  }

  function setNodeSize(percent) {
    if (selected?.type !== "node") return;
    const size = Math.max(60, Math.min(180, Number(percent) || 100));
    const visual = active.visual || {};
    const nodeSizes = { ...(visual.nodeSizes || {}), [selected.id]: size };
    updateActive({ visual: { ...visual, nodeSizes } });
  }

  function moveSelectedTo(target) {
    if (selected?.type !== "node") return;
    const code = moveNodeToSubgraph(active.code, selected.id, target);
    setNodeTarget(target);
    updateCode(code);
  }

  function deleteSelectedNode() {
    if (selected?.type !== "node") return;
    const nodeId = selected.id;
    const code = removeNodeFromCode(active.code, nodeId);
    const visual = active.visual || {};
    const nodeSizes = { ...(visual.nodeSizes || {}) };
    delete nodeSizes[nodeId];
    updateActive({ code, visual: { ...visual, nodeSizes } });
    setSelected(null);
    setInlineEdit(null);
  }

  function deleteSelectedSubgraph() {
    if (selected?.type !== "subgraph") return;
    updateCode(deleteSubgraphFromCode(active.code, selected.id));
    setSelected(null);
    setInlineSubgraphEdit(null);
  }

  function deleteSelectedEdge() {
    if (selected?.type !== "edge") return;
    updateCode(removeEdgeFromCode(active.code, selected.source, selected.target));
    setSelected(null);
  }

  function deleteSelection() {
    if (selected?.type === "node") deleteSelectedNode();
    else if (selected?.type === "subgraph") deleteSelectedSubgraph();
    else if (selected?.type === "edge") deleteSelectedEdge();
  }

  function commitSubgraphInlineEdit() {
    if (!inlineSubgraphEdit?.id) return;
    updateCode(replaceSubgraphTitle(active.code, inlineSubgraphEdit.id, inlineSubgraphEdit.value));
    setInlineSubgraphEdit(null);
  }

  function addSubgraph() {
    const sgId = nextSubgraphId(active.code);
    const nodeId = nextNodeId(active.code);
    updateCode(addSubgraphToCode(active.code, sgId, newSubgraphTitle || sgId, nodeId));
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

  function handlePointerDown(event) {
    if (event.button !== 2) return;
    if (event.target.closest?.("button, input, select, textarea")) return;
    event.preventDefault();
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

  function handleSplitterPointerDown(event) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = editorWidth;
    const target = event.currentTarget;
    target.setPointerCapture?.(event.pointerId);

    const onMove = (moveEvent) => {
      const width = Math.max(280, Math.min(900, startWidth + moveEvent.clientX - startX));
      setEditorWidth(width);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  if (!active) return null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">M</div>
          <div><strong>Mermaid Live Lite v7</strong><span>Visual editor + Mermaid source</span></div>
        </div>

        <div className="toolbar">
          <button onClick={() => addNode(false, "rect")}>＋ Node</button>
          <button onClick={() => addNode(true, "rect")} disabled={selected?.type !== "node"}>＋ Node nối tiếp</button>
          <button onClick={addSubgraph}>＋ Subgraph</button>
          <button onClick={copyCode}>{copied ? "Đã copy" : "Copy code"}</button>
          <button onClick={openImport}>Import .mmd</button>
          <button onClick={exportMmd}>Export .mmd</button>
          <button onClick={exportSvg} disabled={!!error || !svg}>Export SVG</button>
          <button className="icon-button" title="Đổi giao diện" onClick={() => setTheme((t) => t === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
          <input ref={fileInput} type="file" accept=".mmd,.mermaid,.txt,.md,text/plain" hidden onChange={importMmd} />
        </div>
      </header>

      <main className="workspace" style={{ "--editor-width": `${editorWidth}px` }}>
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
          <div className="palette-section add-node-panel">
            <div className="palette-title-row">
              <div>
                <div className="palette-title">Thêm node mới</div>
                <small>Chọn hình dạng, tên và vùng chứa trước khi tạo.</small>
              </div>
            </div>
            <label className="sidebar-field">Tên node
              <input className="sidebar-input" value={newNodeLabel} onChange={(e) => setNewNodeLabel(e.target.value)} placeholder="Ví dụ: Kiểm tra API" />
            </label>
            <div className="shape-palette compact-shapes">
              {SHAPES.map((shape) => (
                <button
                  key={shape.value}
                  className={`shape-button ${newNodeShape === shape.value ? "selected" : ""}`}
                  onClick={() => setNewNodeShape(shape.value)}
                  title={shape.label}
                  type="button"
                >
                  <span className={`shape-preview shape-${shape.value}`}></span>
                  <small>{shape.label}</small>
                </button>
              ))}
            </div>
            <label className="sidebar-field">Thêm vào
              <select className="sidebar-input" value={newNodeSubgraph} onChange={(e) => setNewNodeSubgraph(e.target.value)}>
                <option value="">Canvas chính</option>
                {subgraphs.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
              </select>
            </label>
            <button className="primary create-node-button" onClick={createNodeFromSidebar}>＋ Tạo node</button>
          </div>
          <div className="palette-section">
            <div className="palette-title">Subgraph</div>
            <input className="sidebar-input" value={newSubgraphTitle} onChange={(e) => setNewSubgraphTitle(e.target.value)} placeholder="Tên subgraph" />
            <button className="new-subgraph-button" onClick={addSubgraph}>＋ Thêm subgraph</button>
          </div>
          <div className="sidebar-note">Chuột phải + kéo: PAN · Cuộn: lên/xuống · Shift + cuộn: trái/phải · Ctrl + cuộn: zoom tại con trỏ · Double click node/subgraph: sửa tên · Click line + Delete: xóa kết nối.</div>
        </aside>

        <section className="editor-pane">
          <div className="pane-header">
            <input className="title-input" value={active.name} onChange={(e) => updateActive({ name: e.target.value })} aria-label="Tên sơ đồ" />
            <div className="code-header-actions">
              <button className="organize-code-button" onClick={() => updateCode(active.code, true)} title="Gom subgraph, node, connections và shape theo từng vùng">Sắp xếp code</button>
              <span className="status">{error ? "Syntax error" : "Live"}</span>
            </div>
          </div>
          <HighlightedCodeEditor
            value={active.code}
            editorRef={codeEditorRef}
            onChange={(code) => updateCode(code, false)}
            onBlur={() => updateCode(active.code, true)}
          />
          {error && <div className="error-box"><strong>Mermaid không render được</strong><pre>{error}</pre></div>}
        </section>

        <div
          className="pane-splitter"
          ref={splitterRef}
          onPointerDown={handleSplitterPointerDown}
          title="Kéo để thay đổi chiều rộng vùng code"
          aria-label="Resize code editor"
        />

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
            tabIndex={0}
            onContextMenu={(e) => e.preventDefault()}
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

            {connectionDrag && (
              <svg className="connection-preview" aria-hidden="true">
                <line
                  x1={connectionDrag.x1}
                  y1={connectionDrag.y1}
                  x2={connectionDrag.x2}
                  y2={connectionDrag.y2}
                />
              </svg>
            )}

            {selected?.type === "node" && (
              <div className="node-popover" onPointerDown={(e) => e.stopPropagation()}>
                <div className="node-popover-head">
                  <strong>{selected.id}</strong>
                  <button className="delete-node-button" onClick={deleteSelectedNode} title="Xóa node">×</button>
                </div>
                <label>Hình dạng
                  <select value={nodeShape} onChange={(e) => setNodeShape(e.target.value)}>
                    {SHAPES.map((shape) => <option key={shape.value} value={shape.value}>{shape.label}</option>)}
                  </select>
                </label>
                <label>Subgraph
                  <select value={nodeTarget} onChange={(e) => setNodeTarget(e.target.value)}>
                    <option value="">Ngoài subgraph</option>
                    {subgraphs.map((group) => <option key={group.id} value={group.id}>{group.title}</option>)}
                  </select>
                </label>
                <div className="node-popover-actions">
                  <button className="primary" onClick={applyNodeChanges}>Áp dụng</button>
                  {nodeTarget && <button onClick={() => moveSelectedTo(nodeTarget)}>ADD</button>}
                  {findNodeSubgraph(active.code, selected.id) && <button onClick={() => moveSelectedTo("")}>Remove</button>}
                  <button className="danger-soft" onClick={deleteSelectedNode}>Delete</button>
                </div>
                <small>Double click node để sửa nội dung. Click dấu + để thêm node; kéo dấu + sang node khác để nối.</small>
              </div>
            )}

            {selected?.type === "edge" && (
              <div className="node-popover edge-popover" onPointerDown={(e) => e.stopPropagation()}>
                <div className="node-popover-head">
                  <strong>{selected.source} → {selected.target}</strong>
                  <button className="delete-node-button" onClick={deleteSelectedEdge} title="Xóa kết nối">×</button>
                </div>
                <button className="danger-soft" onClick={deleteSelectedEdge}>Delete connection</button>
                <small>Click đường nối rồi bấm Delete/Backspace cũng có thể xóa kết nối.</small>
              </div>
            )}

            {inlineEdit && (
              <div
                className="inline-direct-editor"
                style={{ left: inlineEdit.x, top: inlineEdit.y, width: inlineEdit.width, height: inlineEdit.height }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={inlineEdit.value}
                  onChange={(e) => setInlineEdit((v) => ({ ...v, value: e.target.value }))}
                  onBlur={commitInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setInlineEdit(null);
                  }}
                />
              </div>
            )}

            {inlineSubgraphEdit && (
              <div
                className="inline-direct-editor inline-subgraph-title-editor"
                style={{ left: inlineSubgraphEdit.x, top: inlineSubgraphEdit.y, width: inlineSubgraphEdit.width, height: inlineSubgraphEdit.height }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  autoFocus
                  value={inlineSubgraphEdit.value}
                  onChange={(e) => setInlineSubgraphEdit((v) => ({ ...v, value: e.target.value }))}
                  onBlur={commitSubgraphInlineEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setInlineSubgraphEdit(null);
                  }}
                />
              </div>
            )}
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
                <label>ADD vào subgraph<select value={nodeTarget} onChange={(e) => setNodeTarget(e.target.value)}><option value="">Chọn subgraph…</option>{subgraphs.map((group) => <option key={group.id} value={group.id}>{group.title} ({group.id})</option>)}</select></label>
                <label className="size-control">Kích cỡ: {selectedNodeSize}%<input type="range" min="60" max="180" step="5" value={selectedNodeSize} onChange={(e) => setNodeSize(e.target.value)} /></label>
                <div className="inspector-actions">
                  <button className="primary" onClick={applyNodeChanges}>Áp dụng tên / shape</button>
                  <button onClick={() => moveSelectedTo(nodeTarget)} disabled={!nodeTarget}>ADD vào subgraph</button>
                  {findNodeSubgraph(active.code, selected.id) && <button className="danger-soft" onClick={() => moveSelectedTo("")}>Remove khỏi subgraph</button>}
                  <button onClick={() => addNode(true, "rect")}>Thêm node nối tiếp</button>
                  <button className="danger-soft" onClick={deleteSelectedNode}>Delete node</button>
                </div>
              </div>
            ) : selected?.type === "subgraph" ? (
              <div className="subgraph-tools">
                <p>Node mới sẽ được thêm trực tiếp vào <strong>{selected.id}</strong>. Double click khung subgraph để sửa tên.</p>
                <button className="primary" onClick={() => addNodeToSubgraph(selected.id, "rect")}>＋ Thêm node vào subgraph</button>
                <button className="danger-soft" onClick={deleteSelectedSubgraph}>Delete subgraph</button>
              </div>
            ) : selected?.type === "edge" ? (
              <div className="subgraph-tools">
                <p>Kết nối <strong>{selected.source}</strong> → <strong>{selected.target}</strong></p>
                <button className="danger-soft" onClick={deleteSelectedEdge}>Delete connection</button>
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
