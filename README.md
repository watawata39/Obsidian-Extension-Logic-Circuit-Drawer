# Logic circuits

Draw digital logic diagrams directly inside your Obsidian notes. Add gates, latches, flip-flops, and custom blocks, then connect them with editable wires. Diagram editing only; no simulation.

## Install

Open [Logic circuits in the community directory](https://community.obsidian.md/plugins/logic-circuits) and select **Add to Obsidian**.

Available on desktop. Requires Obsidian 1.8.0 or newer.

## Get started

1. Open a note in **Live Preview**.
2. Select **Insert logic circuit** from the note's right-click menu to insert a circuit. You can also press **Cmd + Shift + L** on macOS or **Ctrl + Shift + L** on Windows/Linux or run **Logic circuits: Insert logic circuit** from the command palette.
3. Select a component in the toolbar, then click in the diagram to place it. You can also drag components from the toolbar.
4. Drag between pins to connect components. Drag components to reposition them.
5. Double-click terminal labels or a custom block's center label to rename them. Select a configurable component and select **Properties** to change its pins or options.
6. Select **Done**, or click outside the circuit, to finish. Edits save automatically. Double-click the finished diagram or select **Edit** to continue.

## Features

### Components

| Component | Options |
| --- | --- |
| AND, NAND, OR, NOR, XOR, XNOR | 2–32 inputs per gate |
| NOT | *Not configurable* |
| Input and Output terminals | Editable labels |
| Latches | D or SR; optional Q̅ output; active-high or active-low enable for D latches |
| Flip-flops | D, JK, or T; rising or falling clock edge; optional Q̅ output; optional preset and clear pins |
| Custom blocks | Centered label and up to 32 named inputs and 32 named outputs |

Custom blocks let you represent components such as adders, multiplexers, and registers. Add, remove, rename, or reorder their pins in **Properties**. Either side can be empty, provided the block has at least one pin. Long labels wrap automatically.

### Properties

Select a configurable component and select **Properties**, right-click it and select **Properties**, or double-click its body.

Changes preview immediately in the diagram. **Apply** saves them as one undoable change; **Cancel** or **Esc** restores the original. Renaming or reordering custom pins preserves their wires. Removing connected pins shows how many wires will be removed before you apply the change.

### Wires and junctions

- Connect pins by dragging in either direction. Each input accepts one wire; each output can feed multiple targets. Feedback loops are supported.
- Create a branch by dragging an unused input pin onto a wire, or by dragging a wire's hover handle to an unused input pin.
- Single-click a wire or its hover handle to select and highlight it. Press **Delete** or **Backspace**, or select the trash button, to remove it.
- Double-click a wire while editing to add a junction. Drag the junction to shape the route; add several for more control.
- Select a junction dot to highlight it. Deleting it reconnects its incoming wire to its downstream targets.
- Junction dots mark connections. Wire crossings alone do not connect signals.

### Editing and layout

- Components and junctions snap to a grid for easy alignment.
- Hold **Shift** to select multiple elements. Use **Undo** and **Redo**, or the usual keyboard shortcuts, while the circuit has focus.
- Hover over a circuit to reveal **−**, **+**, **Fit**, and **Edit**. You can also type a zoom percentage. The complete diagram fits the note width and adapts when you resize the pane.
- Set the starting zoom for new circuits in **Settings → Logic circuits → Default circuit scale**.
- Drag a circuit's grip to move the whole diagram within your note. Right-click the circuit to insert a line before or after it, or delete the entire circuit block.
- **Reading view** shows the finished diagram. Switch to **Live Preview** to edit it.

### Saving and privacy

Circuits are stored inside the note and work offline, with no separate diagram files, telemetry, or external services.

If a saving conflict appears, **Copy draft** copies your work to the clipboard; **Reload from note** discards the draft. The command **Logic circuits: Recover unsaved circuit drafts** finds drafts still held by the running plugin.

[MIT license](LICENSE).
