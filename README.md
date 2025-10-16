# Static Graph Nodes

Pins selected nodes in the global graph, making them static.

- Version: `0.1.0`
- Requires: Obsidian `>= 0.12.0`
- Main files: `main.js`, `manifest.json`

## Features

- Pin/unpin: selected nodes, the hovered node, and the current note’s node.
- Reapply pins: manually and automatically on layout changes (`layout-change`) and on a timer.
- Ribbon icon for quick pin of selected nodes.
- Integration into Graph View context menu and the standard file menu (when invoked from Graph View).
- Status bar indicator showing how many nodes are pinned.

## Commands

- `Pin selected graph nodes`
- `Unpin selected nodes`
- `Pin hovered graph node`
- `Toggle pin for current note’s node`
- `Reapply pins on current graph`
- `Unpin all nodes`

## Ribbon

- A `pin` icon that runs `Pin selected graph nodes`.

## Graph Context Menu

- `Pin node` / `Unpin node` — for the hovered node.
- `Pin selected nodes` — pin the current selection.
- `Unpin selected` — unpin the current selection.
- `Reapply pins` — reapply all saved pins.
- `Unpin all nodes` — remove all pins.

## File Menu (Graph View)

- Shows `Pin node` / `Unpin node`, `Pin selected nodes`, `Unpin selected` when opened from Graph View.

## Status Bar

- Displays `SGN: {count} pinned` — number of pinned nodes.

## Settings

- `Auto reapply pins` — reapply pins on graph open and periodically.
- `Auto-check period (ms)` — how often to reapply pins.
- `Pinned nodes` — shows `Count: {n}` and a button `Unpin all`.

## Installation

1. Create the folder `.obsidian/plugins/static-graph-nodes/` in your vault.
2. Put `main.js` and `manifest.json` into that folder.
3. Restart Obsidian or enable the plugin in Settings → Community Plugins.

## How it works

- The plugin locates the active Graph View and accesses its `renderer`.
- Pinning fixes the node position, posts a `forceNode` message to the worker, sets `fx/fy`, and zeroes velocities.
- Coordinates of pinned nodes are stored in the plugin settings and synchronized after drags.
- Pins are reapplied on `layout-change` and at the configured interval.

## Notices

- `No graph is open`
- `Multiple graphs open; activate the one you need`
- `No selected nodes on the graph`
- `Pinned nodes: {n}` / `Unpinned nodes: {n}`
- `No hovered node` / `Node pinned` / `Failed to pin node`
- `No active note` / `Pin removed` / `Failed to unpin`
- `Unpinned all nodes` / `Reapplied pins: {n}`