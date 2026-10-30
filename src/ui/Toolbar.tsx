import type { DragEvent } from 'react';
import type { NodeType } from '../model/types';
import { GateSymbol } from './GateSymbol';
import { AccessibleButton, useAccessibleLabel } from './accessibility';

export const PLACEMENT_MIME = 'application/x-obsidian-logic-node';
export const PLACEMENT_TOOLS: NodeType[] = ['and', 'or', 'not', 'nand', 'nor', 'xor', 'xnor', 'input', 'output', 'd-latch', 'd-ff', 'custom'];
function toolName(type: NodeType): string {
	return ({ input: 'Input', output: 'Output', 'd-latch': 'Latch', 'd-ff': 'Flip-flop', custom: 'Custom block' } as Partial<Record<NodeType, string>>)[type] ?? type.toUpperCase();
}
export function CircuitToolbar({ tool, select, canUndo, canRedo, undo, redo, canDelete, remove, done, busy, locked, canConfigure, configure }: {
	tool: NodeType | null; select: (type: NodeType | null) => void;
	canUndo: boolean; canRedo: boolean; undo: () => void; redo: () => void;
	canDelete: boolean; remove: () => void;
	done: () => void; busy: boolean; locked: boolean;
	canConfigure: boolean; configure: () => void;
}) {
	const name = useAccessibleLabel('Circuit editing tools');
	const drag = (event: DragEvent, type: NodeType) => {
		event.dataTransfer.setData(PLACEMENT_MIME, type); event.dataTransfer.effectAllowed = 'copy'; select(type);
	};
	return <div className="logic-toolbar" role="toolbar" aria-labelledby={name.id}>
		{name.label}
		<div className="logic-tools">
			{PLACEMENT_TOOLS.map(type => <AccessibleButton key={type} type="button" className={`logic-tool${tool === type ? ' is-active' : ''}`} label={`Place ${toolName(type)}`} aria-pressed={tool === type} title={toolName(type)} disabled={locked} draggable={!locked} onDragStart={event => drag(event, type)} onDragEnd={() => select(null)} onClick={() => select(tool === type ? null : type)}>
				{type === 'input' || type === 'output' ? <span className="logic-terminal-tool">{toolName(type)}<span aria-hidden="true">{type === 'input' ? '→' : '←'}</span></span> : type === 'd-latch' || type === 'd-ff' || type === 'custom' ? <span className="logic-block-tool"><span aria-hidden="true">{type === 'd-latch' ? 'D' : type === 'd-ff' ? '▷D' : '···'}</span>{toolName(type)}</span> : <><GateSymbol type={type} /><span>{type.toUpperCase()}</span></>}
			</AccessibleButton>)}
		</div>
		<div className="logic-history-tools">
			<button type="button" className="logic-properties-button" disabled={!canConfigure || locked} onClick={configure}>Properties</button>
			<AccessibleButton type="button" className="logic-delete" label="Delete selected elements" title="Delete" disabled={!canDelete || locked} onClick={remove}>
				<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg>
			</AccessibleButton>
			<AccessibleButton type="button" label="Undo circuit edit" title="Undo" disabled={!canUndo || locked} onClick={undo}>↶</AccessibleButton>
			<AccessibleButton type="button" label="Redo circuit edit" title="Redo" disabled={!canRedo || locked} onClick={redo}>↷</AccessibleButton>
			<button type="button" className="logic-done" disabled={locked} onClick={done}>{busy ? 'Saving…' : 'Done'}</button>
		</div>
	</div>;
}
