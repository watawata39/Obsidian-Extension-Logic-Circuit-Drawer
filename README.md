# Logic circuits

Draw digital logic circuits directly inside Markdown notes in Obsidian. The desktop plugin stores each circuit in a `logic-circuit` fenced block, with no separate diagram files, network requests, or simulation.

See [DESIGN.md](DESIGN.md) for the design and [examples/Logic circuits.md](examples/Logic%20circuits.md) for sample diagrams.

## Installation

1. Run `npm install`, then `npm run package` with Node.js 22 or newer.
2. Copy `main.js`, `manifest.json`, and `styles.css` from `dist/logic-circuits/` into `<Vault>/.obsidian/plugins/logic-circuits/`.
3. Reload Obsidian and enable **Logic circuits** in **Settings → Community plugins**.

This checkout is already in a test vault's plugin folder. Running `npm run build` places installable files directly at its root. Reload the plugin to load a new build. Generated `main.js` and `dist/` are excluded from version control.

The permanent plugin ID is `logic-circuits`; the installed folder must use that name. Obsidian 1.8.0 or newer is required. The first release supports desktop only.

If a community installation shows unstyled controls or overlapping circuit objects, check that its plugin folder contains `styles.css` alongside `main.js` and `manifest.json`. The stylesheet is required for the circuit layout. Reinstall from a release containing all three files, or copy `styles.css` from the matching release into the plugin folder and reload the plugin.

## Usage

- In an editable Markdown note, use **Cmd + Shift + L** on macOS or **Ctrl + Shift + L** on Windows/Linux, run **Logic circuits: Insert logic circuit** from the command palette, or select **Insert logic circuit** from the note's right-click menu. Change the default shortcut through **Settings → Hotkeys** if desired.
- In Live Preview, the new block opens for editing without adding an extra blank line after it. Source mode shows the JSON instead of changing your note mode.
- In Live Preview, double-click a finished circuit block, or select **Edit**, to open its inline editor.
- Select a gate, **Input**, **Output**, **Latch**, **Flip-flop**, or **Custom block** in the toolbar, then click in the block. You can also drag the toolbar item into the diagram. Each action places one object.
- Drag objects to move them on the 8-pixel grid. Gate centers, pins, and terminal markers can align exactly. The lower boundary grows and shrinks during movement or placement previews; the top stays fixed during editing. Drag between pins to connect them; the gesture works in either direction. Inputs accept one connection, while outputs can feed multiple targets.
- A gate's output can connect back to its own incoming pin to draw feedback loops. The diagram still enforces one connection per incoming pin.
- Double-click an Input, Output, or custom block center label to edit it. **Enter** or leaving the field confirms; **Esc** cancels. Logic gates have no labels.
- Input and Output use a small terminal marker with their label above it.
- Create a branch by dragging an unused incoming pin onto a wire, or dragging a wire's branch handle to an unused incoming pin. Junction dots indicate connections; wire crossings do not.
- Single-click a wire or its hover handle to select and highlight the wire for deletion. Select a placed junction dot to highlight it; deleting that dot reconnects its wires. Double-click a wire while editing to insert a junction without adding a branch. Drag the junction to shape the wire route; add several to guide a longer route. Each insertion and completed move is undoable.
- Move a junction to adjust branch or wire layout. Its wires meet the solid dot from the appropriate sides; four connection targets are available while editing. Deleting a junction reconnects its upstream source to its downstream targets. Deleting a branch removes only that branch.
- To remove an entire circuit, select **Delete circuit** at the top left while editing, or select its border or drag grip and press **Delete** or **Backspace**. You can also right-click the circuit and select **Delete circuit block**. In an editable note, the text cursor moves to the line left behind. Selecting a node in the editor continues to delete only that node.
- Right-click the circuit and select **Insert line before** or **Insert line after** to create a blank line and move the text cursor there.
- Drag the grip in the hover controls to move a circuit up or down the note. A line marks the drop position between complete Markdown blocks. The original fence lines move into that slot without adding blank lines. Normal note **Undo** restores block deletions, moves, and line insertions in Live Preview. Selection clears when focus leaves the block or its widget closes; returning to a tab does not restore a cached selection.
- Select an object or wire and press **Delete** or **Backspace** to remove it. Use **Undo** and **Redo**, or their normal keyboard shortcuts while the diagram has focus.
- The rubbish bin button removes selected diagram elements and is disabled when nothing is selected.
- Select **Done**, or click elsewhere, to return to the uncluttered inline diagram. Completed actions save automatically, including undo and redo; finishing waits for pending saves and confirms an active label or scale field.

Each block fills the note's content width and displays its entire circuit. In Live Preview, hover over the block to reveal **−**, **+**, **Fit**, and **Edit**; keyboard focus also makes these controls available. Type a zoom percentage between **−** and **+**, then press **Enter** or leave the field to apply it. **Esc** cancels. Values from 25% to 300% are accepted, with enlargement capped to the available width. Scale changes do not rewrite object positions. Narrower panes temporarily reduce the displayed scale; each circuit keeps its saved preference.

Controls use short, delayed native tooltips. The immediate black tooltip bubbles are removed while accessible control names remain available to assistive technology.

**−** and **+** move in 10-point percentage steps (89.2% becomes 80% or 90%). **+** stops when the next whole step would exceed the width; **Fit** uses the exact scale that fits, which may include a decimal.

Set the initial scale for new blocks in **Settings → Logic circuits → Default circuit scale**. Existing circuits retain their own scales.

Reading view displays the saved circuit without editing controls, circuit menus, or selection effects. Switch to Live Preview to edit a diagram or move/delete its block. In Source mode, edit the fenced JSON as normal Markdown. Ordinary scrolling moves through the note, and note keyboard shortcuts remain available outside the diagram.

## Components and properties

Select exactly one configurable component and select **Properties** in the toolbar, or right-click it and select **Properties**. Double-clicking its body also opens properties; a custom block's center label supports direct editing. Changes update the diagram immediately as a live preview, including pin positions, symbols, and attached wires. The diagram beneath the Properties panel updates as you edit. Changes stay local until **Apply**; **Cancel** or **Esc** restores the original diagram. Each applied change is one undo step. Unapplied properties survive an editor widget refresh while the circuit session remains open.

- **AND**, **NAND**, **OR**, **NOR**, **XOR**, and **XNOR** support 2–32 inputs. **NOT** retains one input. Increasing the count grows the symbol vertically; decreasing it removes the highest-numbered pins first.
- **Latch** places a D latch. Properties offers D or SR, optional Q̅ output, and active-low enable for D latches.
- **Flip-flop** places a D flip-flop. Properties offers D, JK, or T, rising/falling clock edges, optional Q̅ output, and independently optional preset and clear/reset pins. Control pin names are fixed as **PRE** and **CLR**; active-high/active-low polarity is editable. Clock triangles and inversion bubbles show these choices.
- **Custom block** places a rectangle with a centered label, two inputs, and one output. Properties edits the center label and adds, removes, names, or reorders up to 32 pins per side. One side may be empty; at least one pin is required. Blank pin names are allowed. Center labels allow 200 characters and pin names allow 40; long text wraps automatically.

Inputs appear on the left and outputs on the right. Renaming and reordering pins preserve their wires. Removing connected pins shows the number of wires that **Apply** will remove, including any branch wires that lose their source or target; **Undo** restores the complete change. Each input accepts one wire and each output can feed multiple targets. All components are diagram symbols; there is no simulation.

Older circuits retain schema version 1 until a new component or configurable input count is used. Those features save as version 2, entirely within the same Markdown block. Both versions are supported; older plugin releases cannot display version 2 circuits.

## Saving and recovery

The plugin locates and validates the intended block again before every update. Changes to surrounding Markdown and other circuits are preserved. Copied blocks receive independent IDs when their selected occurrence can be identified safely.

If the same block changed elsewhere, or a write fails, automatic saving stops and the local draft remains available. Select **Reload from note** to explicitly discard the draft, or **Copy draft** to recover it without overwriting the note. If its original widget is gone, run **Logic circuits: Recover unsaved circuit drafts**.

The two entries in **Settings → Hotkeys** are separate commands: insertion and draft recovery. Recovery has no default shortcut.

Recovery drafts are held in memory while the plugin is loaded. Copy an unresolved draft before disabling the plugin or quitting Obsidian. Session undo history is not persisted across reopenings.

Malformed JSON and unsupported schemas produce an inline error without modifying their original content. Correct them in Source mode.

Temporary editing errors disappear after four seconds. Malformed-data errors and saving conflicts remain visible with their recovery instructions.

## Development and verification

```sh
npm install
npm run dev
npm run build
npm test
npm run lint
npm run test:ui
npm run package
```

`npm test` exercises connection rules, junction edits, history, guarded Markdown updates, block operations, and save-session conflicts. Browser tests exercise the diagram and the real CodeMirror Live Preview extension; native Obsidian mode checks complement those tests. Browser tests use a locally installed Chromium (set `PLAYWRIGHT_CHROMIUM_PATH` if needed), and write artifacts to a temporary directory.

Sources are separated into `src/model/`, `src/storage/`, `src/ui/`, and `src/integration/`. React and React Flow are bundled into `main.js`; Obsidian supplies the external CodeMirror runtime. The build combines React Flow's base stylesheet and `src/ui/styles.css` into shipped `styles.css`.

The build removes React DOM's unused script loaders and script-rendering paths, rejects dynamic script tags and raw HTML, and checks the emitted bundle for script creation. [scripts/no-runtime-scripts.mjs](scripts/no-runtime-scripts.mjs) verifies the audited React DOM source before transforming it; dependency upgrades require reviewing these paths and updating the audited hashes. Development and production builds use the same restrictions, covered by `npm run test:ui -- runtime-scripts`.

For a community release, attach `main.js`, `manifest.json`, and `styles.css` as individual GitHub release assets. Uploading a packaged folder or only the JavaScript and manifest leaves community installations without the required layout styles. The release workflow checks that all three files are nonempty and includes the stylesheet in every draft release.

## Initial limitations

- No simulation, truth tables, analog components, or nested circuits. Custom blocks have no internal circuit.
- Fixed left-to-right orientation. NOT has one input; other logic gates support 2–32. Labels are available on terminals and custom blocks.
- Stepped wires have no advanced obstacle avoidance or draggable elbows. In crowded diagrams they may cross symbols.
- Large diagrams can become small in narrow panes. There is no internal scrolling or infinite canvas.
- The circuit format supports up to 1,000 nodes and 5,000 wires, with positions between −10,000 and 10,000 model units on each axis. Larger or out-of-range data displays an inline error and preserves the original block.
- Native macOS **Insert → Logic circuit** is not provided: the installed public Obsidian API exposes no application-menu extension hook. Use the context menu or command.
- The note context-menu action is grouped with insertion actions. The public API does not expose a way to append it inside Obsidian's existing **Insert** submenu.
- The block scanner supports standalone, unindented fenced blocks, including backtick/tilde fences and CRLF notes. Circuit blocks in metadata, indented code, lists, or blockquotes are not editing targets in this release.

## Privacy

No network access, telemetry, or external services. The plugin reads and updates only relevant notes inside the vault and stores the default scale in its normal plugin settings.

## License

MIT, copyright 2026 Yinlong Zhao. See [LICENSE](LICENSE).

The original Obsidian sample-plugin notice is retained in [licenses/obsidian-sample-plugin-0BSD.txt](licenses/obsidian-sample-plugin-0BSD.txt). Bundled dependencies retain their own licenses. Every build generates `THIRD-PARTY-NOTICES.txt` from the packages actually included and embeds the complete notices in `main.js`, so normal Obsidian installation includes them automatically. Packaged downloads also include the separate license files.
