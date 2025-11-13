// static/topology.js
window.renderTopology = function (id, devices, links, opts = {}) {
  window.currentDevices = devices;
  window.currentLinks = links;
  const container = document.getElementById(id);
  container.innerHTML = `
    <svg id="svg" viewBox="0 0 1600 900" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#33406e" />
        </marker>
        <filter id="softGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <g id="edges"></g>
      <g id="nodes"></g>
    </svg>
    <div class="tooltip" id="tooltip"></div>
  `;

  const svg = container.querySelector("#svg");
  const gEdges = svg.querySelector("#edges");
  const gNodes = svg.querySelector("#nodes");
  const tooltip = container.querySelector("#tooltip");

  // координаты (иерархия по роли)
 // === Автоматическое красивое размещение по уровням ===
const grouped = { core: [], dist: [], access: [], endpoint: [] };
for (const d of devices) {
  if (d.type === "router") grouped.core.push(d);
  else if (d.type === "switch" && /dist/i.test(d.hostname || d.name)) grouped.dist.push(d);
  else if (d.type === "switch") grouped.access.push(d);
  else grouped.endpoint.push(d);
}

// параметры сетки
const canvasWidth = 1600;
const levelHeight = 200;
const startY = 120;

function distributeHorizontally(nodes, levelIndex) {
  const n = nodes.length;
  const step = canvasWidth / (n + 1);
  const y = startY + levelHeight * levelIndex;
  nodes.forEach((d, i) => {
    d.x = step * (i + 1);
    d.y = y;
  });
}

// применяем по уровням
distributeHorizontally(grouped.core, 0);
distributeHorizontally(grouped.dist, 1);
distributeHorizontally(grouped.access, 2);
distributeHorizontally(grouped.endpoint, 3);

// небольшие сдвиги для связи родитель–потомок (чтобы меньше пересечений)
links.forEach(l => {
  const s = devices.find(d => d.id === l.source);
  const t = devices.find(d => d.id === l.target);
  if (!s || !t) return;
  if (Math.abs(s.y - t.y) < 60) {
    t.y += 30 - Math.random() * 60;
  }
});

  const nodeById = Object.fromEntries(devices.map(n => [n.id, n]));

  function nodeColor(t) {
    return t === "router" ? "#6ea8fe" :
           t === "switch" ? "#8b9cf9" :
           "#79e4a3";
  }

  function draw() {
    gEdges.innerHTML = "";
    links.forEach(l => {
      const s = nodeById[l.source];
      const t = nodeById[l.target];
      if (!s || !t) return;
      const mx = (s.x + t.x) / 2;
      const my = (s.y + t.y) / 2 - 20;
      const d = `M ${s.x} ${s.y} Q ${mx} ${my} ${t.x} ${t.y}`;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", l.status === "down" ? "#8a3a41" : "#2d6a4f");
      path.setAttribute("stroke-width", 2);
      if (l.status === "down") path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("fill", "none");
      path.setAttribute("marker-end", "url(#arrow)");
      gEdges.appendChild(path);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", mx);
      label.setAttribute("y", my - 8);
      label.setAttribute("class", "edge-label");
      label.textContent = l.speed || "";
      gEdges.appendChild(label);
    });

    gNodes.innerHTML = "";
    devices.forEach(n => {
      const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("class", "node");
      g.dataset.id = n.id;
      g.setAttribute("transform", `translate(${n.x}, ${n.y})`);

      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("r", 18);
      c.setAttribute("fill", nodeColor(n.type));
      c.setAttribute("stroke", "#0b0f1f");
      c.setAttribute("filter", "url(#softGlow)");
      g.appendChild(c);

      const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
      txt.setAttribute("y", 28);
      txt.textContent = n.hostname || n.name || n.id;
      txt.setAttribute("text-anchor", "middle");
      txt.setAttribute("fill", "#dfe6ff");
      g.appendChild(txt);

      g.addEventListener("pointerenter", e => showTooltip(e, n));
      g.addEventListener("pointerleave", hideTooltip);
      g.addEventListener("pointerdown", startDrag);
      g.addEventListener("click", () => opts.onClick?.(n));

      gNodes.appendChild(g);
    });
  }

  function showTooltip(e, n) {
    tooltip.style.display = "block";
    tooltip.innerHTML = `<div class="ttl">${n.hostname}</div>
      <div class="row"><div>IP</div><div>${n.management_ip}</div></div>
      <div class="row"><div>Вендор</div><div>${n.vendor}</div></div>
      <div class="row"><div>Модель</div><div>${n.model || "-"}</div></div>
      <div class="row"><div>Uptime</div><div>${n.uptime || "-"}</div></div>`;
    moveTooltip(e);
  }
  function moveTooltip(e) {
    const b = svg.getBoundingClientRect();
    tooltip.style.left = e.clientX - b.left + 12 + "px";
    tooltip.style.top = e.clientY - b.top + 12 + "px";
  }
  function hideTooltip() { tooltip.style.display = "none"; }

  // drag
  let drag = null;
  function startDrag(e) {
    const id = e.currentTarget.dataset.id;
    const n = nodeById[id];
    const pt = clientToSvg(e.clientX, e.clientY);
    drag = { id, dx: n.x - pt.x, dy: n.y - pt.y };
    window.addEventListener("pointermove", onDrag);
    window.addEventListener("pointerup", endDrag, { once: true });
  }
  function onDrag(e) {
    if (!drag) return;
    const n = nodeById[drag.id];
    const pt = clientToSvg(e.clientX, e.clientY);
    n.x = pt.x + drag.dx;
    n.y = pt.y + drag.dy;
    draw();
  }
  function endDrag() {
    drag = null;
    window.removeEventListener("pointermove", onDrag);
  }
  function clientToSvg(cx, cy) {
    const pt = svg.createSVGPoint();
    pt.x = cx; pt.y = cy;
    const m = svg.getScreenCTM().inverse();
    return pt.matrixTransform(m);
  }

  // zoom & pan
  let view = { x: 0, y: 0, w: 1600, h: 900 };
  function applyView() {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  }
  container.addEventListener("wheel", e => {
    e.preventDefault();
    const scale = e.deltaY > 0 ? 1.08 : 0.92;
    const rect = svg.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const newW = Math.max(400, Math.min(4000, view.w * scale));
    const newH = Math.max(225, Math.min(2250, view.h * scale));
    view.x += (view.w - newW) * mx;
    view.y += (view.h - newH) * my;
    view.w = newW; view.h = newH;
    applyView();
  }, { passive: false });

  let panning = null;
  svg.addEventListener("contextmenu", e => e.preventDefault());
  svg.addEventListener("pointerdown", e => {
    if (e.button === 2) {
      panning = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
      svg.setPointerCapture(e.pointerId);
    }
  });
  svg.addEventListener("pointermove", e => {
    if (!panning) return;
    const dx = (e.clientX - panning.sx) * (view.w / svg.clientWidth);
    const dy = (e.clientY - panning.sy) * (view.h / svg.clientHeight);
    view.x = panning.vx - dx;
    view.y = panning.vy - dy;
    applyView();
  });
  svg.addEventListener("pointerup", () => panning = null);

  draw();
  applyView();
};

// --- Фильтрация и обновление топологии по типу и поиску ---
window.updateTopologyFilter = function (typeFilter, query) {
  const nodes = document.querySelectorAll("#nodes g.node");
  const q = (query || "").toLowerCase();
  nodes.forEach(g => {
    const id = g.dataset.id;
    const name = g.querySelector("text")?.textContent?.toLowerCase() || "";
    const d = window.currentDevices?.find(x => String(x.id) === String(id));
    const matchType = !typeFilter || d?.type === typeFilter;
    const matchQuery = !q || (d?.management_ip?.includes(q) || name.includes(q));
    g.style.opacity = (matchType && matchQuery) ? "1" : "0.25";
  });

  // Прячем/показываем линиwindow.renderTopology = function (id, devices, linkи
  const edges = document.querySelectorAll("#edges path");
  edges.forEach(p => {
    const link = window.currentLinks?.find(l => l._path === p);
    const sVisible = link && document.querySelector(`#nodes g[data-id='${link.source}']`)?.style.opacity === "1";
    const tVisible = link && document.querySelector(`#nodes g[data-id='${link.target}']`)?.style.opacity === "1";
    p.style.opacity = (sVisible && tVisible) ? "1" : "0.1";
  });
};

