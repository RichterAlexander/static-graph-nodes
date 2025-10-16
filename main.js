/*
 Static Graph Nodes — Obsidian plugin (JavaScript)
 Pins selected nodes in the global graph, making them static.
*/

const { Plugin, Notice, PluginSettingTab, Setting, Menu } = require('obsidian');

const DEFAULT_SETTINGS = {
  pinned: {}, // id -> { x, y }
  autoReapply: true,
  autoTickMs: 2000
};

class StaticGraphNodesPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    // Ribbon: quick pin of selected graph nodes
    try {
      this.ribbon = this.addRibbonIcon('pin', 'Pin selected graph nodes', () => this.pinSelectedNodes());
      this.ribbon.addClass('static-graph-nodes-ribbon');
    } catch (_) {}

    // Status bar: number of pinned nodes
    try {
      this.statusBar = this.addStatusBarItem();
      this.updateStatusBar();
    } catch (_) {}

    this.addCommand({
      id: 'sgn-pin-selected',
      name: 'Pin selected graph nodes',
      callback: () => this.pinSelectedNodes()
    });
    this.addCommand({
      id: 'sgn-unpin-selected',
      name: 'Unpin selected nodes',
      callback: () => this.unpinSelectedNodes()
    });
    this.addCommand({
      id: 'sgn-pin-hovered',
      name: 'Pin hovered graph node',
      callback: () => this.pinHoveredNode()
    });
    this.addCommand({
      id: 'sgn-toggle-current-file',
      name: 'Toggle pin for current note’s node',
      callback: () => this.togglePinCurrentFileNode()
    });
    this.addCommand({
      id: 'sgn-reapply',
      name: 'Reapply pins on current graph',
      callback: () => this.reapplyPinnedNodes()
    });
    this.addCommand({
      id: 'sgn-unpin-all',
      name: 'Unpin all nodes',
      callback: () => this.unpinAll()
    });

    this.addSettingTab(new StaticGraphNodesSettingTab(this.app, this));

    // Context menu on right-click in the graph
    this.attachContextMenuToAllGraphViews();
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      this.attachContextMenuToAllGraphViews();
    }));

    // Auto reapply on open/layout change
    this.registerEvent(this.app.workspace.on('layout-change', () => {
      if (this.settings.autoReapply) {
    // Small delay to let the graph initialize
        window.setTimeout(() => this.reapplyPinnedNodes(), 500);
      }
    }));

    // Integrate into the standard file menu (graph nodes)
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file, source, leaf) => {
      try {
        // Show menu items only when invoked from Graph View
        const isGraph = leaf?.view?.getViewType && leaf.view.getViewType() === 'graph';
        if (!isGraph) return;
        const id = file?.path;
        if (!id) return;
        const renderer = this.getRenderer();
        const pinned = !!this.settings.pinned[id];

        menu.addItem((item) => item
          .setTitle(pinned ? 'Unpin node' : 'Pin node')
          .setIcon('pin')
          .onClick(() => pinned ? this.unpinNode(id, renderer) : this.pinNode(id, null, renderer))
        );

        const selected = this.getSelectedNodeIds(renderer);
        if (selected && selected.length) {
          menu.addSeparator();
          menu.addItem((item) => item
            .setTitle('Pin selected nodes')
            .setIcon('pin')
            .onClick(() => this.pinSelectedNodes())
          );
          menu.addItem((item) => item
            .setTitle('Unpin selected')
            .setIcon('pin')
            .onClick(() => this.unpinSelectedNodes())
          );
        }
      } catch (e) {
        console.error('StaticGraphNodes: file-menu integration error', e);
      }
    }));

    // Periodic tick: enforce pins and persist new positions after drags
    this.registerInterval(window.setInterval(() => {
      if (this.settings.autoReapply) {
        this.syncPinnedPositionsFromRenderer();
        this.reapplyPinnedNodes(false);
      }
    }, this.settings.autoTickMs));
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    this.updateStatusBar();
  }

  // === Graph helpers ===
  findGraphLeaf() {
    const active = this.app.workspace.activeLeaf;
    if (active && active.view && active.view.getViewType() === 'graph') return active;
    const leaves = this.app.workspace.getLeavesOfType('graph');
    if (leaves.length === 1) return leaves[0];
    if (leaves.length < 1) new Notice('No graph is open');
    else new Notice('Multiple graphs open; activate the one you need');
    return null;
  }

  getRenderer(graphLeaf) {
    const leaf = graphLeaf || this.findGraphLeaf();
    return leaf?.view?.renderer;
  }

  getSelectedNodeIds(renderer) {
    const ids = new Set();
    if (!renderer) return [];
    const nodes = renderer.nodes || [];

    // Try to find selected node indices under different property names
    const candidateIndexArrays = [
      renderer.selectedIndices,
      renderer.selectedIndicies,
      renderer.selection,
      renderer.selected,
      renderer.selectedSet,
      renderer.selectionIndices,
    ].filter(Boolean);

    for (const arr of candidateIndexArrays) {
      try {
        const iterable = Array.isArray(arr) ? arr : (arr instanceof Set ? Array.from(arr) : []);
        for (const idx of iterable) {
          const node = nodes?.[idx];
          if (node?.id) ids.add(node.id);
        }
      } catch (_) {}
    }

    // Sometimes 'selected' contains node objects themselves
    if (Array.isArray(renderer.selected)) {
      for (const item of renderer.selected) {
        const id = item?.id ?? (typeof item === 'string' ? item : null);
        if (id) ids.add(id);
      }
    }

    // Fallback: hovered node
    if (ids.size === 0 && renderer.hoveredNode?.id) ids.add(renderer.hoveredNode.id);
    return Array.from(ids);
  }

  findNodeById(renderer, id) {
    const nodes = renderer?.nodes || [];
    for (const n of nodes) if (n.id === id) return n;
    return null;
  }

  // === Pin logic ===
  pinNode(id, pos, renderer) {
    const r = renderer || this.getRenderer();
    if (!r || !id) return false;
    const node = this.findNodeById(r, id);
    if (!node && !pos) return false;
    try {
      const x = (pos?.x ?? node?.x);
      const y = (pos?.y ?? node?.y);
      // Instruct the worker to lock the node at given coordinates
      r.worker?.postMessage({ forceNode: { id, x, y } });
      // Hard lock directly in the renderer: clear velocities and fix the node
      const n = node || this.findNodeById(r, id);
      if (n) {
        try {
          n.x = x; n.y = y;
          n.fx = x; n.fy = y;
          if ('vx' in n) n.vx = 0;
          if ('vy' in n) n.vy = 0;
        } catch (_) {}
      }
      // Persist the position
      this.settings.pinned[id] = { x, y };
      this.saveSettings();
      this.updateStatusBar();
      return true;
    } catch (e) {
      console.error('StaticGraphNodes: pinNode error', e);
      return false;
    }
  }

  unpinNode(id, renderer) {
    const r = renderer || this.getRenderer();
    if (!r || !id) return false;
    try {
      r.worker?.postMessage({ forceNode: { id, x: null, y: null } });
      // Remove the lock and return the node to the simulation
      const n = this.findNodeById(r, id);
      if (n) {
        try {
          n.fx = null; n.fy = null;
        } catch (_) {}
      }
      delete this.settings.pinned[id];
      this.saveSettings();
      this.updateStatusBar();
      return true;
    } catch (e) {
      console.error('StaticGraphNodes: unpinNode error', e);
      return false;
    }
  }

  reapplyPinnedNodes(showNotice = true) {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const ids = Object.keys(this.settings.pinned);
    if (ids.length === 0) return;
    for (const id of ids) {
      const saved = this.settings.pinned[id];
      if (!saved) continue;
      // Always restore saved coordinates — the node stays where you placed it
      this.pinNode(id, { x: saved.x, y: saved.y }, renderer);
    }
    if (showNotice) new Notice(`Reapplied pins: ${ids.length}`);
  }

  // Update saved positions of pinned nodes if the user dragged them
  syncPinnedPositionsFromRenderer() {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const ids = Object.keys(this.settings.pinned || {});
    if (!ids.length) return;
    const threshold = 2; // pixels — minimal change to consider moved
    let changed = 0;
    for (const id of ids) {
      const node = this.findNodeById(renderer, id);
      if (!node) continue;
      const saved = this.settings.pinned[id];
      if (!saved) continue;
      const dx = Math.abs((node.x ?? 0) - (saved.x ?? 0));
      const dy = Math.abs((node.y ?? 0) - (saved.y ?? 0));
      if (dx > threshold || dy > threshold) {
        this.settings.pinned[id] = { x: node.x, y: node.y };
        changed++;
      }
    }
    if (changed) this.saveSettings();
  }

  unpinAll() {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const ids = Object.keys(this.settings.pinned);
    for (const id of ids) this.unpinNode(id, renderer);
    this.updateStatusBar();
    new Notice('Unpinned all nodes');
  }

  // === Context menu on right click ===
  attachContextMenuToGraphView(graphLeaf) {
    try {
      const leaf = graphLeaf || this.findGraphLeaf();
      const view = leaf?.view;
      const container = view?.containerEl;
      const content = view?.contentEl;
      const renderer = view?.renderer;
      if (!view || !container || !renderer) return;
      if (!this._ctxAttachedViews) this._ctxAttachedViews = new WeakSet();
      if (this._ctxAttachedViews.has(view)) return;
      this._ctxAttachedViews.add(view);

      // Subscribe to contentEl and canvas (if present)
      const targetEl = (content?.querySelector('canvas')) || content || container;
      this.registerDomEvent(targetEl, 'contextmenu', (evt) => {
        const r = view.renderer;
        const hoveredId = r?.hoveredNode?.id;
        const selectedIds = this.getSelectedNodeIds(r);

        // Show the menu only if a node is hovered or there is a selection
        if (!hoveredId && (!selectedIds || selectedIds.length === 0)) return;

        const menu = new Menu(this.app);

        if (hoveredId) {
          const pinned = !!this.settings.pinned[hoveredId];
          menu.addItem((item) => item
            .setTitle(pinned ? 'Unpin node' : 'Pin node')
            .setIcon('pin')
            .onClick(() => pinned ? this.unpinNode(hoveredId, r) : this.pinNode(hoveredId, null, r))
          );
        }

        if (selectedIds && selectedIds.length) {
          menu.addSeparator();
          menu.addItem((item) => item
            .setTitle('Pin selected nodes')
            .setIcon('pin')
            .onClick(() => this.pinSelectedNodes())
          );
          menu.addItem((item) => item
            .setTitle('Unpin selected')
            .setIcon('pin')
            .onClick(() => this.unpinSelectedNodes())
          );
        }

        menu.addSeparator();
        menu.addItem((item) => item
          .setTitle('Reapply pins')
          .setIcon('rotate-cw')
          .onClick(() => this.reapplyPinnedNodes())
        );
        menu.addItem((item) => item
          .setTitle('Unpin all nodes')
          .setIcon('trash')
          .onClick(() => this.unpinAll())
        );

        menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
        evt.preventDefault();
      });

      // Save changes and immediately reapply pins after mouseup
      this.registerDomEvent(targetEl, 'mouseup', () => {
        try {
          this.syncPinnedPositionsFromRenderer();
          this.reapplyPinnedNodes(false);
        } catch (_) {}
      });
    } catch (e) {
      console.error('StaticGraphNodes: attachContextMenu error', e);
    }
  }

  attachContextMenuToAllGraphViews() {
    try {
      const leaves = this.app.workspace.getLeavesOfType('graph');
      for (const leaf of leaves) this.attachContextMenuToGraphView(leaf);
    } catch (e) {
      console.error('StaticGraphNodes: attachContextMenuToAllGraphViews error', e);
    }
  }

  // (Removed) Pair forces of pinned nodes: we no longer control distance with constants.

  // === Commands ===
  pinSelectedNodes() {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const ids = this.getSelectedNodeIds(renderer);
    if (!ids.length) { new Notice('No selected nodes on the graph'); return; }
    let ok = 0;
    for (const id of ids) if (this.pinNode(id, null, renderer)) ok++;
    new Notice(`Pinned nodes: ${ok}`);
  }

  unpinSelectedNodes() {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const ids = this.getSelectedNodeIds(renderer);
    if (!ids.length) { new Notice('No selected nodes on the graph'); return; }
    let ok = 0;
    for (const id of ids) if (this.unpinNode(id, renderer)) ok++;
    new Notice(`Unpinned nodes: ${ok}`);
  }

  pinHoveredNode() {
    const renderer = this.getRenderer();
    if (!renderer) return;
    const id = renderer.hoveredNode?.id;
    if (!id) { new Notice('No hovered node'); return; }
    const ok = this.pinNode(id, null, renderer);
    new Notice(ok ? 'Node pinned' : 'Failed to pin node');
  }

  togglePinCurrentFileNode() {
    const file = this.app.workspace.getActiveFile();
    if (!file) { new Notice('No active note'); return; }
    const renderer = this.getRenderer();
    if (!renderer) return;
    const id = file.path; // Node ID — usually the file path
    if (this.settings.pinned[id]) {
      const ok = this.unpinNode(id, renderer);
      new Notice(ok ? 'Pin removed' : 'Failed to unpin');
    } else {
      const ok = this.pinNode(id, null, renderer);
      new Notice(ok ? 'Node pinned' : 'Failed to pin node');
    }
  }

  // helper: status bar
  updateStatusBar() {
    try {
      const count = Object.keys(this.settings?.pinned || {}).length;
      if (this.statusBar) this.statusBar.setText(`SGN: ${count} pinned`);
    } catch (_) {}
  }
};

module.exports = StaticGraphNodesPlugin;

class StaticGraphNodesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Static Graph Nodes — Settings' });

    new Setting(containerEl)
      .setName('Auto reapply pins')
      .setDesc('Reapply pins on graph open and periodically')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoReapply)
        .onChange((value) => { this.plugin.settings.autoReapply = value; this.plugin.saveSettings(); }));

    new Setting(containerEl)
      .setName('Auto-check period (ms)')
      .setDesc('How often to reapply pins')
      .addText(text => text
        .setPlaceholder('2000')
        .setValue(String(this.plugin.settings.autoTickMs))
        .onChange((value) => {
          const v = Number(value);
          if (!Number.isNaN(v) && v >= 250) {
            this.plugin.settings.autoTickMs = v;
            this.plugin.saveSettings();
          }
        }));

    const pinnedCount = Object.keys(this.plugin.settings.pinned || {}).length;
    new Setting(containerEl)
      .setName('Pinned nodes')
      .setDesc(`Count: ${pinnedCount}`)
      .addButton(btn => btn.setButtonText('Unpin all')
        .onClick(() => this.plugin.unpinAll()));

  }
}