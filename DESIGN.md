# Inline logic circuit plugin design

Status: implemented first-release design, extended by the component and configurable-pin update below. The update supersedes the first-release restrictions on supported objects, pin counts, labels, and schema versions.

This document records the product behavior agreed during design discussion. It is a specification for implementation, not a statement that these features already exist. Numeric layout constants and the proposed JSON field names can be refined during implementation without changing the agreed interactions.

## Purpose and scope

Create simple digital logic diagrams directly inside Markdown notes. Prioritize quick editing, readable symbols, and reliable note updates. All circuit data stays in the note; operation is local and offline.

The first release is desktop-only. Set `isDesktopOnly` to `true` in the plugin manifest.

Supported objects:

- AND, OR, NOT, NAND, NOR, XOR, and XNOR gates.
- Dedicated Input and Output terminals with editable labels.
- Explicit junctions for branching in the middle of wires.
- Plain, unlabeled wires.

Excluded from the first release: simulation, truth tables, analog components, chips, nested circuits, gate rotation, configurable gate input counts, advanced obstacle avoidance, draggable wire elbows, minimaps, and external services. Avoid additional panels and configuration beyond the default display scale.

In this document, a **node** means any placed gate, terminal, or junction. Gates and junctions do not have labels. Input and Output are distinct types with a shared visual style, rather than one type with a mode switch.

## Circuit block and display scale

### Block layout

- Each circuit occupies its own inline block with a subtle border.
- The block fills the note's content width and respects Obsidian's readable line width setting.
- The complete circuit is visible, including symbols, labels, junctions, and routed wires.
- There is no internal scrolling, panning, or freely navigable infinite canvas.
- Keep the finished block close to its content height, with 16 model-independent pixels of padding above and below. Empty editing canvases start at 128 pixels high.
- Update the lower boundary continuously during movement and placement previews, including when the pointer moves below the previous boundary. Grow when objects move down and shrink when they move up. Keep the top origin fixed throughout an editing session, including saves and widget replacement. Retain empty space above moved nodes until editing ends, then compact the finished layout; save only completed actions.
- Keep padding around the diagram so strokes, labels, and hit targets are not clipped.
- Prefer horizontal layouts: signals generally flow from inputs on the left to outputs on the right. Terminals remain freely placeable and are not locked to the block edges.

### Scale controls

Every block has **−**, **+**, **Fit**, and **Edit** controls in a compact top-right strip that appears on pointer hover or keyboard focus. It takes no permanent space in the finished diagram. The percentage between **−** and **+** is editable; Enter or blur confirms a valid value, Escape cancels, and invalid entries leave circuit data unchanged. Accept 25–300%, capping enlargement to the width that fits.

Scale changes affect the whole diagram: symbols, labels, and distances between objects. They do not rewrite node coordinates or alter circuit connectivity.

Each circuit stores a preferred display scale. Its actual displayed scale is capped by the available width:

```text
effective scale = min(preferred scale, scale that fits all content horizontally)
```

The fit calculation includes labels, junctions, wire paths, and padding, not just node positions. Empty circuits use the default layout rather than calculating a fit from empty bounds. Apply reasonable finite scale limits to prevent extreme enlargement of tiny diagrams.

- **−** and **+** move to the next whole 10-point percentage in their direction: from 89.2%, **−** gives 80% and **+** gives 90%. The minimum remains 25%.
- Disable **+** if the next step would exceed the available width. **Fit** can reach the exact maximum between those steps.
- **Fit** saves the largest allowed scale that fits the complete diagram horizontally.
- Narrowing the note pane temporarily reduces effective scale without replacing the saved preference. Widening the pane restores that preference when space permits.
- Changing a circuit's scale is a completed, undoable action and persists to its block. Resizing the note pane is not a diagram edit.
- Wire strokes remain thin and clear; invisible pin and wire hit targets remain generous at small scales.

### Horizontal bounds

Placement and movement must keep objects inside the block's visible horizontal area. Show a valid or invalid placement preview and constrain drag positions to the available bounds. Never allow an action to leave hidden content beyond the block width.

Recompute fit after completed edits, including label changes and wire rerouting. Vertical growth accommodates more rows. Resizing a pane may still make a complex diagram small: fitting all content cannot guarantee readability for arbitrarily large circuits. Do not hide content or silently delete objects to address this limitation.

### Settings

Provide one initial setting: **Default circuit scale**. Validate it as a positive, finite value within the supported scale limits. A starting default of 100% is proposed.

The setting initializes newly inserted circuits only. Existing circuits keep their individual saved preferences. Store this plugin preference through Obsidian's `loadData()` and `saveData()`; store circuit contents and circuit-specific scale in the Markdown block.

## Reading and editing states

### Finished diagram

In Live Preview, show the circuit with block controls revealed on hover or keyboard focus. Hide the gate toolbar, grid, pin interaction indicators, and selection decoration. Wires, labels, and junction dots remain visible. Suppress Obsidian's additional native code-block hover controls for circuit blocks only.

Reading view is display-only. Do not reveal circuit controls on hover or focus, open the editor on double-click, select circuit elements or the whole block, or offer circuit mutation actions in its context menu. Keep ordinary note scrolling and the note's native context menu available. Editing, block movement, and block deletion belong to Live Preview; Source mode retains normal Markdown editing.

Use short native delayed tooltips where useful. Avoid Obsidian's immediate black tooltip bubbles; provide accessible names through referenced hidden labels rather than tooltip-triggering attributes.

Double-clicking the finished diagram or selecting **Edit** starts editing in the same block. Double-clicking a control retains that control's behavior. While editing, terminal-label double-clicks continue to edit the label. Do not open a separate modal or full-screen workspace.

### Whole-block selection and movement

Include a compact drag grip in the hover controls. Clicking the grip, the block border, or a finished diagram selects the entire circuit block with a distinct outer outline. Selecting a node or wire while editing clears whole-block selection. Outside focus or clicks, window blur, and final widget unmount clear the outline, including malformed circuits. Use ordinary focus and lifecycle behavior without restoring selection across closed widgets or tabs. Do not save selection to Markdown. **Delete** or **Backspace** on a selected block removes exactly its original fenced Markdown range, including malformed circuits; in an editable note the caret moves to the surviving line at the deletion position. Text fields retain ordinary deletion behavior.

Right-clicking a circuit offers **Insert line before**, **Insert line after**, and **Delete circuit block** through a menu scoped to that circuit. Each line action inserts exactly one blank line, places the caret there in an editable note, and finishes editing after pending saves succeed. Preserve existing text, newline style, and circuit content. Note Undo reverses the document change and its caret transaction. Other Markdown blocks retain their usual context menus.

Dragging the grip moves the complete fenced block vertically within the note. Show a drop line and scroll near the note pane's upper or lower edge. Accept complete root Markdown line boundaries outside properties, other code fences, lists, and blockquotes. Move the fence lines with their existing line terminator into that exact slot. Preserve existing blank lines rather than adding paragraph spacing; add a single line break only when an unterminated end-of-note line requires it. Preserve original circuit bytes and surrounding text, and apply the removal and insertion atomically as a single note edit. Dropping on the source block itself or immediately after its line terminator is a no-op. Check the note snapshot and block identity again when applying the change; reject stale or conflicting drops. Moving a uniquely identified circuit preserves its active editing session.

### Editing diagram

Show a compact toolbar containing the seven gates, **Input**, **Output**, a rubbish bin for selected elements, **Undo**, **Redo**, and **Done**. Disable the rubbish bin when nothing is selected. Use recognizable symbols with short names or tooltips. Toolbar names do not become labels on placed gates. Wrap the toolbar when necessary.

Show a **Delete circuit** button at the top left only while editing. It uses the guarded whole-block deletion action, waits for pending saves, and places the caret on the surviving note line. Keep it separate from the rubbish bin for selected elements. Wrap the header controls in narrow panes so the delete button and scale controls do not overlap.

Junctions are created through wire interactions and do not need a separate placement button.

Use a subtle snapping grid and clear selection feedback. An empty block displays: “Select a gate, then click to place it.”

Only one circuit editor is active per note pane. Activating another editor finishes the previous session after pending saves succeed. Other panes may display the same circuit; conflicting edits must follow the saving rules below.

**Done**, or clicking elsewhere, waits for pending saves to succeed and returns to the finished diagram. An outside click first confirms the active label or scale field, without consuming the outside interaction. Clicking back into the circuit while that completion waits cancels the earlier close intent. Opening the block's own context menu or moving its grip does not finish prematurely. Focus changes caused by widget replacement alone must not end editing. There is no session-wide discard action. If saving fails or conflicts, keep the draft available and show recovery controls.

## Editing interactions

### Placement

Support both methods:

1. Select a toolbar item, then select an empty position in the block.
2. Drag a toolbar item directly into the block.

Show a preview at the snapped position. Moving the preview below the existing lower boundary extends the block before placement; moving it back up shrinks the preview bounds. Dropping outside the horizontal block bounds cancels placement. Successful placement creates one node, saves one action, and returns to selection mode. Do not keep the placement tool active for repeated placement.

### Movement and selection

- Select a gate, terminal, or junction to highlight it.
- Drag it to move it on an 8-pixel model grid. Gates use an 80 × 64 model box, incoming pins at y=16 and y=48, and their output at y=32. Centers, terminal markers, and all connectors share the same lattice so horizontal or vertical alignment is exact. Snap placement and movement around these reference points without rewriting existing saved coordinates on load.
- Keep attached wires connected and reroute them during movement.
- Save the final position on drag release, with the full drag forming one undo step.
- Selecting empty space clears selection unless a placement tool is active.
- Select a wire through a generous invisible hit area; highlight the selected path.
- Delete selected nodes or wires. Deleting a gate or terminal also removes its incident wires and any junctions that become invalid.

### Connections

Gates face left-to-right, with incoming pins on the left and outgoing pins on the right.

| Type | Incoming pins | Outgoing pins | Editable label |
| --- | --- | --- | --- |
| Input | None | One | Yes |
| Output | One | None | Yes |
| NOT | One | One | No |
| AND, OR, NAND, NOR, XOR, XNOR | Two | One | No |
| Junction | One | One logical output that permits multiple branches | No |

Drag between compatible pins in either gesture direction. Normalize the saved connection to output → input.

Validation rules:

- Every incoming pin accepts at most one connection.
- An outgoing pin can connect to multiple incoming pins.
- Reject input-to-input and output-to-output connections.
- Reject duplicate connections between the same source and target pins.
- Reject missing node or pin references.
- Reject a second source attempting to drive an occupied incoming pin, including a junction's incoming connection.
- Leave existing connections intact when a new connection is rejected. Give brief, generic feedback explaining the connection rule, such as “An output pin cannot be connected to an Input node” or “This input pin is already connected.” Do not include gate names, terminal labels, object numbers, or internal IDs.
- Allow feedback through gates, including a gate's output connected to its own incoming pin. Keep direction, duplicate, and incoming-pin capacity checks. Junction-only cycles remain invalid because they have no upstream driver. This is a drawing tool and does not validate simulation behavior.

### Labels

Only Input and Output terminals have editable labels. Use a small terminal marker and directional wire stem, with the label above it and no surrounding rectangle. Initialize new terminals with useful names such as **A**, **B**, and **Y**, choosing unused names when practical.

Double-click a label to edit it in place. **Enter** or leaving the field confirms the edit; **Esc** cancels the current label change. Terminal width accommodates the label within a reasonable limit. Keep long labels visible through an intentional wrapping or sizing rule; define that limit during visual refinement.

Confirming a label change creates one undo step, updates layout bounds, and saves the circuit. Gate and junction labels must not be introduced by the renderer or editor.

## Junctions and branching

### Creating a junction

Support both gestures:

- Drag from an unused incoming pin onto an existing wire.
- Drag from an existing wire to an unused incoming pin.

While editing, hovering over a wire reveals a small branch handle. During a connection drag, highlight a valid target wire and show the proposed junction position. The preview lies on the wire and follows grid snapping where possible.

Completing the gesture splits the original wire at an explicit junction and adds the new branch. Preserve the original upstream-to-downstream connection. Treat creating the junction, splitting the wire, and adding the branch as one atomic action for validation, saving, and undo.

```text
Input ─────●───── AND input
           │
           └──── OR input
```

Dropping on an existing junction reuses it. Reject invalid branches without leaving a partially split wire. Single-clicking a wire or its hover handle selects and highlights the wire without a note edit. A placed junction dot is independently selectable and visibly highlighted for deletion. Distinguish a click from a drag on the hover handle, preserving drag-to-pin branch creation without treating a click as a failed drag. Double-clicking a wire while editing inserts a junction at the nearest snapped point on that wire, preserving upstream-to-downstream connectivity without adding a branch. This creates one saved undo step. A nearby endpoint junction is reused without another save. Double-clicking a finished diagram retains its editing entry behavior; Reading view remains display-only.

### Junction meaning

- A junction has one incoming connection and can feed multiple downstream targets.
- It has a stable ID and a saved position.
- It is a small filled dot with a larger invisible interaction target.
- Wires meet the dot directly and may extend from any of its four sides, chosen by the surrounding layout. Do not give the dot permanent left/right wire stubs. Four connection targets appear around it while editing; these remain UI details and do not change the saved logical pin IDs.
- Splitting a wire preserves its original two halves through the dot, including the incoming and continuation directions. A branch from a vertical trunk must not introduce an extra horizontal leg on the opposite side. Infer the continuing trunk from circuit connectivity and the junction position without rewriting schema-version-1 circuit data.
- It has no label.
- Branches are explicit graph connections, not inferred from overlapping paths.
- Do not permit merging two independent output sources at a junction.
- A crossing without an explicit junction has no dot and does not imply connectivity.

### Moving and removing junctions

| Action | Required behavior |
| --- | --- |
| Move a gate or terminal | Reroute attached wires; keep junction positions unchanged |
| Move a junction | Snap its position and reroute every attached wire |
| Delete a branch wire | Remove only that branch, plus any junction left with no outgoing connections |
| Delete a junction | Reconnect its upstream source directly to each downstream target, then remove the junction |
| Delete an upstream source | Remove its wires and junctions that lose their source; propagate cleanup through dependent junctions |

Deleting a junction preserves downstream connectivity but may change wire geometry. Treat reconnection and removal as one action; undo restores the exact previous nodes, edges, IDs, and positions.

A junction with one outgoing connection may remain as a routing anchor. A junction with no outgoing connections is removed automatically. Apply connection validation to every junction operation, including deletion and cleanup.

### Routing limits

Use simple stepped, right-angle wires. Junction positions provide manual control over branch layout. Do not provide draggable wire elbows in the first release.

Advanced obstacle avoidance is excluded. Wires may cross other wires or pass through gates in crowded diagrams; crossings must remain visually distinguishable from explicit junctions. Do not automatically turn crossings into junctions.

## Keyboard and focus behavior

- **Esc** cancels placement or a pending connection. In a label field it cancels the label edit.
- **Delete** or **Backspace** removes selected diagram elements only when diagram controls have focus, outside text entry.
- **Ctrl/Cmd + Z** and redo shortcuts operate on circuit history when the circuit has focus, including after **Done**, outside text entry. Confirming or cancelling a label or percentage returns focus to the circuit without scrolling.
- Text fields retain normal text selection, deletion, and undo behavior.
- Outside the diagram editor, note editing shortcuts retain their normal behavior.
- Ordinary wheel and trackpad scrolling moves through the note, not through or around the circuit.
- Disable React Flow's free panning and wheel/pinch zoom behavior for this embedded design. Diagram scaling uses the explicit controls.
- Keep buttons keyboard reachable, provide accessible names and visible focus states, and announce validation or saving errors clearly.

Undo history is per circuit editing session and need not survive closing and reopening a note. An undo or redo operation is itself a completed edit that must be safely saved. It must not replace newer external changes without conflict checks.

## Obsidian integration

### Insertion

Register the stable command ID `insert-logic-circuit`, named **Insert logic circuit**, with default **Cmd + Shift + L** on macOS and **Ctrl + Shift + L** on Windows/Linux. Make it available through the command palette and configurable hotkeys only for a saved Markdown note in its own editable note view. Add the right-click action only in that same note context, grouped with insertion actions. Check the original note/editor again before applying a delayed menu action. Canvas text cards, PDFs, other editors, and fileless contexts must not expose this entry.

Keep **Recover unsaved circuit drafts** as a separate command without a default shortcut. The two hotkey settings entries represent these two actions.

Insert an empty fenced `logic-circuit` block at the insertion location, adding only the line breaks required to separate its fence from existing text. Do not add an extra blank line after the block or replace selected note text implicitly. Initialize a fresh circuit ID and the configured default scale, then activate its inline editor in Live Preview. In Source mode, leave the inserted code visible rather than forcing a mode change.

The desired macOS integration is **Insert → Logic circuit** in the native menu bar. The installed public Obsidian API exposes no application-menu extension hook, so this release retains the command and right-click entry points and documents that limitation.

The public menu API can assign the note context-menu action to an insertion section but cannot append to Obsidian's existing **Insert** submenu. Keep the supported grouped action rather than depending on private submenu internals.

### Note modes

| Mode | Behavior |
| --- | --- |
| Reading view | Display the saved circuit without circuit editing controls or mutation actions |
| Live Preview | Render an inline widget; interactions must not unexpectedly reveal JSON or move the Markdown cursor into the block |
| Source mode | Show the original fenced code and allow normal Markdown editing |

Use a Markdown code block processor for Reading view and an editor extension for the Live Preview widget. Mode changes and note navigation must coordinate pending saves before disposing of the active editing UI. A saving conflict must not silently discard the local draft.

## Circuit data format

Use JSON inside a fenced `logic-circuit` block. Store all circuit-specific content in the `.md` file; do not require diagram sidecar files.

The format is independent of React Flow. Persist model nodes and edges, not React Flow's runtime selection, measured sizes, component state, or event objects.

Proposed version 1 fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Integer format version, initially `1` |
| `circuitId` | Stable circuit ID |
| `nodes` | IDs, supported types, model-space positions, and labels for terminals only |
| `edges` | IDs and explicit source/target node and pin IDs |
| `view.preferredScale` | Positive finite per-circuit display scale; `1` means 100% |

Proposed node type strings: `and`, `or`, `not`, `nand`, `nor`, `xor`, `xnor`, `input`, `output`, and `junction`.

Proposed stable pin IDs: `in-1` and `in-2` for incoming gate pins, `out` for outgoing pins, and `in-1` / `out` for junctions. Input has `out`; Output has `in-1`.

Positions are in model coordinates and do not depend on the current note pane's width. Derive block height, fit bounds, and wire geometry from the model. Save additional dimensions only if visual refinement establishes that they are needed to reproduce the layout; do not save a transient viewport offset.

Example note block:

````markdown
```logic-circuit
{
  "schemaVersion": 1,
  "circuitId": "circuit-example",
  "nodes": [
    { "id": "input-a", "type": "input", "position": { "x": 40, "y": 40 }, "label": "A" },
    { "id": "input-b", "type": "input", "position": { "x": 40, "y": 140 }, "label": "B" },
    { "id": "gate-and", "type": "and", "position": { "x": 220, "y": 80 } },
    { "id": "output-y", "type": "output", "position": { "x": 400, "y": 80 }, "label": "Y" }
  ],
  "edges": [
    { "id": "edge-a", "sourceNodeId": "input-a", "sourcePinId": "out", "targetNodeId": "gate-and", "targetPinId": "in-1" },
    { "id": "edge-b", "sourceNodeId": "input-b", "sourcePinId": "out", "targetNodeId": "gate-and", "targetPinId": "in-2" },
    { "id": "edge-y", "sourceNodeId": "gate-and", "sourcePinId": "out", "targetNodeId": "output-y", "targetPinId": "in-1" }
  ],
  "view": { "preferredScale": 1 }
}
```
````

Validate JSON shape, supported version, IDs, finite positions, terminal labels, scale, node types, pin references, connection direction, incoming-pin capacity, and duplicate edges. Unsupported or malformed content displays a helpful inline error while preserving the original block. Do not silently repair, downgrade, or replace it with an empty diagram.

## Safe saving and conflict recovery

### Save boundaries

Save after completed actions: placement, drag release, connection creation, junction operations, deletion, label confirmation, scale changes, undo, and redo. Pointer movement and connection previews are transient and do not write to the note.

Temporary action errors disappear after four seconds; repeating an error restarts its interval. Keep malformed-source errors and failed or conflicting saves visible while recovery is required. Use concise generic messages without object IDs or numbered wires.

Serialize writes for each note so rapidly completed actions cannot overwrite each other or complete out of order. A saved action updates the baseline used for subsequent conflict checks.

### Locate and update only the intended block

Do not rely on remembered line numbers alone. Track the note, circuit ID, current block location, and exact original block content as the editing baseline.

Before each update:

1. Read the current authoritative note content, including unsaved editor text when an editor is active.
2. Locate the intended fenced block again, accounting for Markdown edits that shifted its position.
3. Confirm its identity is unambiguous and its content matches the editing baseline.
4. Replace only the block's circuit payload, preserving surrounding text, other circuits, fence syntax, and unrelated formatting.
5. Apply the update through an editor transaction or an appropriate guarded vault operation. Recheck the baseline at application time; a separate read followed by an unguarded write is insufficient.
6. Record the successfully saved block as the new baseline.

Changes outside the intended circuit block do not constitute a circuit conflict. Changes to that block, deletion of the block, or unresolved identity ambiguity do.

### Duplicate circuit IDs

Copying and pasting a block also copies its circuit ID. Do not use the ID alone to choose which duplicate to overwrite. Resolve the selected occurrence from its current editor/document context, then assign it a fresh ID through a guarded update before independent editing. If the occurrence cannot be identified safely, stop saving and explain the ambiguity. Never rewrite all duplicate blocks indiscriminately.

### Conflicts and failures

On a conflict or failed write:

- Preserve the local draft and stop automatic writes for that session.
- Show a concise inline explanation.
- Offer **Reload from note** to discard the local draft explicitly and load current note content.
- Offer **Copy draft** to recover the complete local circuit block without overwriting the note.
- Do not silently merge circuit graphs or offer an implicit overwrite.
- Keep the draft reachable if its original widget is removed or the user changes note modes; coordinate this through the editing session manager while the plugin remains loaded.

For a transient write failure, retry only with a fresh identity and baseline check. **Done** must not report success while writes remain unresolved.

Completed actions should be saved promptly so normal navigation does not lose work. Orderly session closure must await pending saves when possible. Abrupt application termination or plugin unload cannot guarantee recovery of an unsaved or conflicted in-memory draft; do not claim otherwise or rely on asynchronous unload as the primary save mechanism.

## Implementation boundaries and lifecycle

Use TypeScript, the Obsidian API, React, and `@xyflow/react`, bundled with npm and esbuild.

Keep these responsibilities separate:

- **Circuit model:** schema, parsing, validation, connection rules, junction operations, and reversible edit actions. No React Flow or Obsidian dependency.
- **Diagram UI:** SVG symbols, terminals, junctions, wire rendering, placement, selection, focus, and React Flow adapters.
- **Editing sessions:** drafts, action history, save queues, baselines, and conflict recovery.
- **Obsidian integration:** commands, context menu, Reading view rendering, Live Preview widgets, note updates, settings, and lifecycle registration.

Keep `src/main.ts` focused on lifecycle and registration. Split large modules into focused files. Bundle runtime dependencies into the root `main.js`; do not introduce network loading.

React Flow provides selection, dragging, connection interactions, and coordinate conversion. Configure its viewport behavior to enforce the embedded, fully visible block design.

Use Obsidian theme colors and fonts in both light and dark themes. Keep gate dimensions and stroke weights consistent, selection distinguishable, and pins easy to target.

Create UI instances lazily. Avoid whole-vault scans and duplicate roots for the same widget. Unmount React roots and dispose of observers, editor extensions, event listeners, and session references when their owners are removed. Use Obsidian registration helpers for plugin-owned listeners and cleanup. Ignore obsolete asynchronous results after disposal.

## Delivery sequence

1. Create the plugin skeleton and independent model, including junction types and connection validation.
2. Render a sample circuit with custom SVG gates, Input/Output terminals, junction dots, and stepped wires.
3. Add placement by click and drag, movement, connections, branching, labels, deletion, and undo/redo.
4. Implement insertion, Reading view and Live Preview rendering, block identity, guarded saving, and conflict recovery.
5. Refine full-width layout, fit/scale behavior, themes, keyboard focus, accessibility, and usability. Verify native macOS menu feasibility.

## Acceptance and verification

The core acceptance flow is: insert a circuit, place two labeled inputs, connect both to an AND gate, connect the gate to a labeled output, select **Done**, and see the complete diagram inline. Closing and reopening the note preserves the circuit and its preferred scale.

Meaningful automated tests must cover:

- Direction validation, incoming-pin capacity, output fan-out, duplicate connections, and invalid references.
- Atomic wire splitting and branching, reuse of existing junctions, invalid-branch rollback, junction deletion with reconnection, and dependent-junction cleanup.
- Undo/redo restoring complete model state for compound actions.
- Guarded block updates with multiple circuits, shifted blocks, surrounding note edits, modified/deleted target blocks, duplicate IDs, and intervening edits during saving.
- Parsing malformed data and rejecting unsupported schema versions without changing the source.

Manual verification must cover:

- Reading view, Live Preview, and Source mode.
- Light and dark themes and narrow/wide note panes.
- Per-circuit scale, default scale, Fit, disabled enlargement, full visibility, and vertical growth.
- Click placement, drag-and-drop placement, snapping, wire hit targets, junction gestures, labels, and keyboard focus.
- Moving gates keeps wires attached; deleting nodes removes invalid connections.
- Ordinary scrolling continues through the note.
- Multiple circuits save independently without changing surrounding Markdown.
- Conflicts preserve local drafts and expose recovery actions; rapid edits and multiple panes do not silently overwrite changes.
- Widget removal, mode changes, reopening notes, and plugin reload clean up UI instances and listeners.

## Deliverables and remaining limits

Deliver installable `main.js`, `manifest.json`, and `styles.css`, source code, a sample note demonstrating basic gates and branching, and concise installation and usage instructions. Build artifacts are release deliverables and must not be committed to source control.

Document these initial limits: desktop-only support, fixed gate orientation and pin counts, no simulation, automatic routing without obstacle avoidance or movable elbows, potentially small diagrams in narrow panes, session-only undo history, and native macOS Insert-menu availability if unsupported.

The grid, dimensions, live lower-boundary behavior, and 10-point scale steps are specified above. Further refinement may adjust label wrapping or symbol proportions without changing the data format. The macOS menu integration remains unavailable through the public API.

## References

- [Obsidian editor API](https://docs.obsidian.md/Plugins/Editor/Editor)
- [Obsidian API documentation](https://docs.obsidian.md)
- [Obsidian developer policies](https://docs.obsidian.md/Developer+policies)
- [Obsidian plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- Project conventions: [AGENTS.md](AGENTS.md)


## Component and configurable-pin update

The editor remains diagram-only. Add SR and D latches, D/JK/T flip-flops, and custom rectangular blocks without nested circuits or simulation. Keep existing gates and terminals visually unchanged at their original pin counts.

### Shared properties interaction

A single selected configurable component exposes **Properties** in the toolbar and its element context menu. Double-clicking a configurable component body opens the same in-flow dialog. Custom center labels retain direct double-click editing. The dialog keeps a local draft with **Cancel**, **Apply**, and Escape cancellation. Valid changes update the visible circuit immediately, including connections, bounds, scale, symbols, and pin locations. Keep the original centered properties panel above the full-width diagram, with the input/output pin lists in columns where space permits. Update that diagram live without a separate preview title. Previews do not mutate the saved circuit, Markdown, or undo history. Invalid drafts display the original circuit. Cancel restores the original diagram; applying creates one undoable, saved action. Keep keyboard focus within the dialog while open and disable other circuit editing controls. Retain unapplied properties with the in-memory circuit session so native widget replacement cannot discard them; do not write these drafts to Markdown.

### Gate input counts

AND, NAND, OR, NOR, XOR, and XNOR accept 2–32 inputs; NOT stays at one. Keep existing input IDs (`in-1`, `in-2`, etc.) and append new IDs as counts grow. Removing inputs removes the highest-numbered pins. Grow symbols vertically using 32 model-unit pin spacing, with the output centered; redraw outlines without stretching stroke widths or inversion bubbles.

### Sequential symbols

Render rectangular presets with labeled inputs on the left and Q/Q̅ outputs on the right. Latch choices are SR and D; the D latch supports active-high/active-low enable. Flip-flop choices are D, JK, and T with rising/falling clock edge selection. A triangle marks a clock input; an inversion bubble marks active-low pins. Q̅ is visible by default and can be hidden.

Flip-flops have independently optional preset and clear/reset inputs, hidden by default. Their names are fixed as PRE and CLR, with an active-high/active-low choice. Retain legacy saved label fields for schema compatibility, but do not expose name editing or use legacy text to override these fixed names. Preset and clear are placed on the left. Labels and marks document the symbol only.

### Custom blocks

A custom block is a rectangle with a center label and ordered input/output lists. New blocks start with label Block, inputs A and B, and output Y. Each side accepts up to 32 pins; at least one total pin is required. Pin names may be blank. Pin names allow 40 characters and center labels allow 200. Derive dimensions and intentional text wrapping from the pin lists and label so names and center text never overlap. Align all connector ends with the existing grid.

Pin IDs are stable and independent of names or list order. Renaming/reordering preserves wires. The properties dialog displays the number of wires that will be removed by a pin deletion or type change, including orphaned junction connections. Apply performs pin changes, wire deletion, and junction cleanup atomically; Undo restores the full previous circuit.

### Format compatibility

Continue reading schema 1 without rewriting it on load. Schema 2 adds node types `sr-latch`, `d-latch`, `d-ff`, `jk-ff`, `t-ff`, and `custom`; optional `inputCount` for configurable gates; `pins: { inputs, outputs }` lists of `{ id, label }` for custom nodes; and `sequential` options for sequential symbols. Promote a circuit to schema 2 when it first uses an extended field or node. An unchanged properties application must not change its schema or create history. Preserve explicit source/target pin IDs and all existing safe-save, conflict-recovery, scale, and undo behavior. Reject malformed options and unsupported versions without modifying source.
