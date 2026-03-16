const chainSummary = document.getElementById('chainSummary');

function riskColor(score) {
  if (score >= 75) return '#ff5c5c';
  if (score >= 50) return '#ffcd57';
  return '#2fd1a5';
}

function nodeRadius(node) {
  if (node.riskScore >= 75) return 16;
  if (node.riskScore >= 50) return 12;
  return 9;
}

function renderChainSummary(summary) {
  chainSummary.innerHTML = '';
  Object.values(summary).forEach((chain) => {
    const el = document.createElement('span');
    el.className = 'tag';
    el.textContent = `${chain.name}: ${chain.suspiciousEdges}/${chain.edges} suspicious`;
    chainSummary.appendChild(el);
  });
}

function renderGraph(graph) {
  const container = document.getElementById('graph');
  container.innerHTML = '';

  const width = container.clientWidth;
  const height = container.clientHeight;

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height);

  svg
    .append('defs')
    .append('marker')
    .attr('id', 'arrow')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', 14)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', '#4f5b9a');

  const simulation = d3
    .forceSimulation(graph.nodes)
    .force('link', d3.forceLink(graph.edges).id((d) => d.id).distance(120))
    .force('charge', d3.forceManyBody().strength(-280))
    .force('center', d3.forceCenter(width / 2, height / 2));

  const link = svg
    .append('g')
    .selectAll('line')
    .data(graph.edges)
    .enter()
    .append('line')
    .attr('stroke', (d) => riskColor(d.riskScore))
    .attr('stroke-width', (d) => (d.suspicious ? 2.5 : 1.2))
    .attr('marker-end', 'url(#arrow)')
    .attr('opacity', 0.8);

  const node = svg
    .append('g')
    .selectAll('circle')
    .data(graph.nodes)
    .enter()
    .append('circle')
    .attr('r', (d) => nodeRadius(d))
    .attr('fill', (d) => riskColor(d.riskScore))
    .attr('stroke', '#0c1024')
    .attr('stroke-width', 1.2)
    .call(
      d3
        .drag()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
    );

  const label = svg
    .append('g')
    .selectAll('text')
    .data(graph.nodes)
    .enter()
    .append('text')
    .text((d) => `${d.chain}:${d.label.substring(0, 6)}...`)
    .attr('font-size', '10px')
    .attr('fill', '#c7cffd')
    .attr('opacity', 0.7);

  const tooltip = d3
    .select(container)
    .append('div')
    .style('position', 'absolute')
    .style('padding', '8px 10px')
    .style('background', 'rgba(6, 8, 18, 0.9)')
    .style('border', '1px solid rgba(255,255,255,0.08)')
    .style('border-radius', '10px')
    .style('pointer-events', 'none')
    .style('font-size', '12px')
    .style('color', '#e6e9ff')
    .style('opacity', 0);

  node.on('mousemove', (event, d) => {
    tooltip
      .style('opacity', 1)
      .style('left', `${event.offsetX + 12}px`)
      .style('top', `${event.offsetY + 12}px`)
      .html(`Address: ${d.label}<br/>Risk: ${d.riskLevel}`);
  });

  node.on('mouseleave', () => {
    tooltip.style('opacity', 0);
  });

  link.on('mousemove', (event, d) => {
    tooltip
      .style('opacity', 1)
      .style('left', `${event.offsetX + 12}px`)
      .style('top', `${event.offsetY + 12}px`)
      .html(`Tx: ${d.hash}<br/>${d.amount} ${d.asset}<br/>Time: ${new Date(d.timestamp).toLocaleString()}<br/>Flags: ${d.riskFlags.join(', ') || 'none'}`);
  });

  link.on('mouseleave', () => {
    tooltip.style('opacity', 0);
  });

  simulation.on('tick', () => {
    link
      .attr('x1', (d) => d.source.x)
      .attr('y1', (d) => d.source.y)
      .attr('x2', (d) => d.target.x)
      .attr('y2', (d) => d.target.y);

    node.attr('cx', (d) => d.x).attr('cy', (d) => d.y);

    label.attr('x', (d) => d.x + 12).attr('y', (d) => d.y + 4);
  });
}

async function loadCase() {
  const params = new URLSearchParams(window.location.search);
  const caseId = params.get('id');
  if (!caseId) {
    document.getElementById('caseMeta').textContent = 'Missing case id.';
    return;
  }
  const response = await fetch(`/api/case/${caseId}`);
  const record = await response.json();
  document.getElementById('caseTitle').textContent = record.title;
  document.getElementById('caseMeta').textContent = `Case ${record.id} | Seed: ${record.seed} | Created: ${new Date(record.createdAt).toLocaleString()}`;
  document.getElementById('caseNotes').textContent = record.notes || 'No notes.';

  const anchor = document.getElementById('caseAnchor');
  anchor.innerHTML = `
    <div class="tag">Module: ${record.pactAnchor.module}</div>
    <div class="tag warning">Function: ${record.pactAnchor.function}</div>
    <div class="tag">Network: ${record.pactAnchor.networkId}</div>
    <div class="tag">Chain: ${record.pactAnchor.chainId}</div>
  `;

  renderGraph(record.graphSnapshot);
  renderChainSummary(record.chainSummary);
}

loadCase();
