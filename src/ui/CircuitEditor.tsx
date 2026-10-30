import { applyNodeChanges, applyEdgeChanges, Background, BackgroundVariant, ConnectionMode, ConnectionLineType, ReactFlow, ReactFlowProvider, useReactFlow, useStoreApi, type Connection, type NodeChange, type EdgeChange } from '@xyflow/react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CircuitSession } from '../integration/session';
import { connect, branchEdge, insertJunction, deleteElements, replaceNode, MIN_SCALE, MAX_SCALE } from '../model/circuit';
import type { CircuitData, CircuitNode, NodeShape, NodeType } from '../model/types';
import { CircuitObject, type FlowNode } from './CircuitNode';
import { CircuitWire, type FlowEdge } from './CircuitWire';
import { DiagramContext } from './context';
import { boundsFor, edgeWirePoints, GRID, nearestOnWire, PADDING, pathFor, routedWirePoints, sizeFor, terminalLabel, type Point } from './geometry';
import { CircuitToolbar, PLACEMENT_MIME, PLACEMENT_TOOLS } from './Toolbar';
import { GateSymbol } from './GateSymbol';
import { useBranching } from './useBranching';
import { eventElement } from './dom';
import { ScaleControl } from './ScaleControl';
import { TerminalPreview } from './TerminalPreview';
import { createNode, isBlockType, isConfigurable, requiresV2 } from '../model/components';
import { BlockSymbol } from './BlockSymbol';
import { NodeProperties } from './NodeProperties';
import { NodeContextMenu } from './NodeContextMenu';
import { getPropertyDraftStore, previewCircuitForProperties } from './property-drafts';
import { CircuitConnection } from './CircuitConnection';
import { constrainNodePosition, scaleStep } from './canvasLayout';
import { usePlacementPreview } from './usePlacementPreview';
import { flowHandlesFor, logicalJunctionPin, normalizeFlowConnection } from './junction-connections';
import { BlockTools, type CircuitBlockActions } from './BlockTools';
import { TRANSIENT_MESSAGE_MS, useBlockSelection, useTransientMessage } from './useBlockSelection';
import { AccessibleButton, useAccessibleLabel } from './accessibility';

const nodeTypes = { circuit: CircuitObject };
const edgeTypes = { wire: CircuitWire };

export function CircuitEditor({ session, blockActions, readOnly = false, canEdit }: {
	session: CircuitSession;
	blockActions?: CircuitBlockActions;
	readOnly?: boolean;
	canEdit?: () => boolean;
}) {
	const subscription = useMemo(() => ({ subscribe: session.subscribe.bind(session), snapshot: session.getSnapshot.bind(session) }), [session]);
	const snapshot = useSyncExternalStore(subscription.subscribe, subscription.snapshot);
	if (!snapshot.circuit) return <InvalidCircuit session={session} error={snapshot.error} actions={blockActions} readOnly={readOnly} canEdit={canEdit} />;
	return <ReactFlowProvider><Diagram session={session} snapshot={snapshot} circuit={snapshot.circuit} blockActions={blockActions} readOnly={readOnly} canEdit={canEdit} /></ReactFlowProvider>;
}

function InvalidCircuit({ session, error, actions, readOnly, canEdit }: { session: CircuitSession; error: string | null; actions?: CircuitBlockActions; readOnly: boolean; canEdit?: () => boolean }) {
	const block = useBlockSelection(session, actions, !readOnly, canEdit);
	const name = useAccessibleLabel('Logic circuit');
	return <div className={`logic-circuit logic-invalid${readOnly ? ' is-read-only' : ''}${block.selected ? ' is-block-selected' : ''}`} ref={block.container} tabIndex={readOnly ? undefined : 0} role="group" aria-labelledby={name.id} onPointerDown={readOnly ? undefined : event => event.stopPropagation()} onClick={readOnly ? undefined : event => { if (canEdit && !canEdit()) return; event.stopPropagation(); block.select(true); event.currentTarget.focus({ preventScroll: true }); }} onContextMenu={readOnly ? undefined : block.contextMenu} onKeyDown={readOnly ? undefined : event => {
		if (canEdit && !canEdit()) return;
		if (block.selected && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); event.stopPropagation(); block.remove(); }
	}}>{name.label}{!readOnly && <div className="logic-block-controls"><BlockTools actions={actions} selected={block.selected} select={() => block.select(true)} disabled={block.busy} /></div>}
		<div role="alert"><strong>Could not display this circuit</strong><p>{error || 'The circuit data is invalid.'}</p><small>The original Markdown is preserved. Correct the fenced block in source mode.</small>{block.error && <p>{block.error}</p>}</div>
	</div>;
}

type Snapshot = ReturnType<CircuitSession['getSnapshot']>;
function Diagram({ session, snapshot, circuit, blockActions, readOnly, canEdit }: { session: CircuitSession; snapshot: Snapshot; circuit: CircuitData; blockActions?: CircuitBlockActions; readOnly: boolean; canEdit?: () => boolean }) {
	const writable = useCallback(() => !readOnly && (!canEdit || canEdit()), [readOnly, canEdit]);
	const block = useBlockSelection(session, blockActions, !readOnly, canEdit);
	const container = block.container;
	const name = useAccessibleLabel('Logic circuit');
	const scaleName = useAccessibleLabel('Diagram scale');
	const wireName = useAccessibleLabel('Wire');
	const canvas = useRef<HTMLDivElement>(null);
	const flow = useReactFlow<FlowNode, FlowEdge>();
	const store = useStoreApi<FlowNode, FlowEdge>();
	const [width, setWidth] = useState(600);
	const [nodes, setNodes] = useState<FlowNode[]>(() => makeNodes(circuit));
	const [edges, setEdges] = useState<FlowEdge[]>(() => makeEdges(circuit, undefined, wireName.id));
	const [tool, setTool] = useState<NodeType | null>(null);
	const propertiesStore = useMemo(() => getPropertyDraftStore(session), [session]);
	const propertiesDraft = useSyncExternalStore(propertiesStore.subscribe, propertiesStore.getSnapshot);
	const propertiesId = propertiesDraft?.nodeId ?? null;
	const [nodeMenu, setNodeMenu] = useState<{ id: string; x: number; y: number } | null>(null);
	const closeMenu = useCallback(() => { setNodeMenu(null); container.current?.focus({ preventScroll: true }); }, [container]);
	const [preview, setPreview] = useState<{ position: Point; valid: boolean } | null>(null);
	const [message, setMessage] = useTransientMessage(container);
	const [connecting, setConnecting] = useState(false);
	const connectionCancelled = useRef(false);
	const dragMoved = useRef(false);
	const [hovered, setHovered] = useState<{ edgeId: string; point: Point } | null>(null);
	const locked = snapshot.conflict || Boolean(snapshot.error) || block.busy || propertiesId !== null;
	const editorOpen = snapshot.editing && !readOnly;
	const editing = editorOpen && !locked;
	const previewingProperties = editorOpen && !snapshot.conflict && propertiesDraft !== null;
	const displayCircuit = useMemo(() => previewingProperties ? previewCircuitForProperties(circuit, propertiesDraft) : circuit, [circuit, propertiesDraft, previewingProperties]);
	// Keep model sizes and stable preview objects: rebuilding unmeasured Flow
	// nodes on dimension notifications would discard every wire's handle bounds.
	const propertyNodes = useMemo(() => makeNodes(displayCircuit), [displayCircuit]);
	const propertyEdges = useMemo(() => makeEdges(displayCircuit, undefined, wireName.id), [displayCircuit, wireName.id]);
	const displayedNodes = previewingProperties ? propertyNodes : nodes;
	const displayedEdges = previewingProperties ? propertyEdges : edges;
	const bounds = useMemo(() => boundsFor(displayCircuit), [displayCircuit]);
	// Saves can replace this entire React tree. Keep the editing origin on the
	// session so empty space above moved nodes survives until editing ends.
	const top = editorOpen ? session.getEditingOrigin(bounds.minY) : bounds.minY;
	const liveBounds = useMemo(() => previewingProperties ? bounds : boundsFor({ ...circuit, nodes: nodes.map(node => ({ ...node.data.model, position: node.position })) }), [circuit, nodes, previewingProperties, bounds]);
	const fitScale = Math.min(MAX_SCALE, Math.max(0.001, (width - PADDING * 2) / bounds.width));
	const scale = Math.min(circuit.view.preferredScale, fitScale);
	const viewport = useMemo(() => ({ x: PADDING - bounds.minX * scale, y: PADDING - top * scale, zoom: scale }), [bounds.minX, top, scale]);
	const placementNode = useMemo(() => tool ? createNode(tool, { x: 0, y: 0 }, terminalLabel(circuit, tool)) : null, [tool, circuit]);
	const previewBottom = placementNode && preview?.valid ? preview.position.y + sizeFor(placementNode).height : top;
	const bottom = Math.max(liveBounds.maxY, previewBottom);
	const height = Math.max(nodes.length || preview?.valid ? 64 : 128, Math.ceil((bottom - top) * scale + PADDING * 2));
	// Notify the note host only after React has applied the node's new bounds.
	useLayoutEffect(() => { if (writable()) blockActions?.afterResize?.(); }, [blockActions, editorOpen, height, nodes, propertiesDraft, writable]);
	const toPoint = useCallback((point: Point) => flow.screenToFlowPosition(point), [flow]);
	const commit = useCallback((data: CircuitData) => { if (!writable()) return; setMessage(''); session.commit(data); }, [session, setMessage, writable]);
	const selectWire = (edgeId: string, additive: boolean) => {
		if (!editing || tool || !writable()) return;
		block.select(false);
		if (!additive) setNodes(previous => previous.map(node => ({ ...node, selected: false })));
		setEdges(previous => previous.map(edge => edge.id === edgeId ? { ...edge, selected: additive ? !edge.selected : true } : additive ? edge : { ...edge, selected: false }));
		container.current?.focus({ preventScroll: true });
	};
	const branch = useBranching({ circuit, editing, toPoint, commit, onDragStart: () => setHovered(null), error: setMessage });
	// A branch ends at a pin. Crossing another wire must not turn that wire
	// into a connection target or leave a hover marker behind after release.
	const wireHover = branch.branch ? { edgeId: branch.branch.edgeId, point: branch.branch.origin } : hovered;
	const hoverWire = (edgeId: string, point: Point | null) => {
		if (!branch.branch) setHovered(point ? { edgeId, point } : null);
	};
	const startBranch: typeof branch.start = (edgeId, point, event) => { branch.start(edgeId, point, event); };
	const run = (action: () => void | Promise<void>) => {
		if (!writable()) return;
		setMessage('');
		try { void Promise.resolve(action()).catch(error => setMessage(error instanceof Error ? error.message : 'The action could not be completed.')); }
		catch (error) { setMessage(error instanceof Error ? error.message : 'The action could not be completed.'); }
	};
	const addJunction = (edgeId: string, point: Point) => {
		if (!editing || tool) return;
		run(() => {
			const next = insertJunction(circuit, edgeId, { x: point.x - 8, y: point.y - 8 });
			if (next === circuit) return;
			const added = new Set(next.nodes.filter(node => !circuit.nodes.some(original => original.id === node.id)).map(node => node.id));
			branch.cancel(); setHovered(null); block.select(false);
			commit(next); setNodes(makeNodes(next, added)); setEdges(makeEdges(next, undefined, wireName.id));
			container.current?.focus({ preventScroll: true });
		});
	};
	const finishEditing = () => run(() => {
		// Removing a focused Done button makes Obsidian blur and rebuild its
		// native preview. Keep focus on the persistent circuit before closing.
		container.current?.focus({ preventScroll: true });
		return session.finish();
	});
	useEffect(() => {
		if (!canvas.current) return;
		const observer = new ResizeObserver(entries => {
			for (const entry of entries) {
				if (entry.contentRect.width <= 0) continue;
				setWidth(entry.contentRect.width);
			}
		});
		observer.observe(canvas.current);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		setNodes(previous => makeNodes(circuit, new Set(previous.filter(node => node.selected).map(node => node.id))));
		setEdges(previous => makeEdges(circuit, new Set(previous.filter(edge => edge.selected).map(edge => edge.id)), wireName.id));
	}, [circuit, wireName.id, previewingProperties]);
	useEffect(() => {
		const window = container.current?.ownerDocument.defaultView;
		if (!window || !session.hasTransientError) return;
		const timeout = window.setTimeout(() => session.dismissTransientError(snapshot.actionErrorId), TRANSIENT_MESSAGE_MS);
		return () => window.clearTimeout(timeout);
	}, [container, session, snapshot.error, snapshot.actionErrorId]);
	useEffect(() => { if (!editing) { setTool(null); setPreview(null); setHovered(null); setConnecting(false); } }, [editing]);
	useEffect(() => { if (readOnly) blockActions?.cancelMove?.(); }, [readOnly, blockActions]);
	const constrain = (position: Point, node: NodeShape) => constrainNodePosition(node, position, { left: bounds.minX, top, width: (width - PADDING * 2) / scale });
	const placement = (point: Point, type: NodeType) => {
		const node = placementNode?.type === type ? placementNode : createNode(type, { x: 0, y: 0 }, terminalLabel(circuit, type));
		const size = sizeFor(node);
		const position = constrain({ x: point.x - size.width / 2, y: point.y - size.height / 2 }, node);
		const valid = position.x >= bounds.minX && position.x + size.width <= bounds.minX + (width - PADDING * 2) / scale && point.y >= top;
		return { position, valid };
	};
	usePlacementPreview({ canvas, tool, editing, toPoint, placement, update: setPreview });
	const place = (point: Point, type: NodeType) => {
		if (!writable()) return;
		const next = placement(point, type);
		if (!next.valid) { setMessage('Place the object inside the diagram bounds.'); return; }
		const node = { ...(placementNode?.type === type ? placementNode : createNode(type, next.position, terminalLabel(circuit, type))), position: next.position };
		const data: CircuitData = { ...circuit, schemaVersion: requiresV2(node) ? 2 : circuit.schemaVersion, nodes: [...circuit.nodes, node] };
		commit(data);
		if (isBlockType(type)) setNodes(makeNodes(data, new Set([node.id])));
		setTool(null); setPreview(null); container.current?.focus({ preventScroll: true });
	};
	const removeSelection = () => {
		const selectedNodes = nodes.filter(node => node.selected).map(node => node.id);
		const selectedEdges = edges.filter(edge => edge.selected).map(edge => edge.id);
		if (selectedNodes.length || selectedEdges.length) run(() => commit(deleteElements(circuit, selectedNodes, selectedEdges)));
	};
	const canDelete = nodes.some(node => node.selected) || edges.some(edge => edge.selected);
	const selectedNodes = nodes.filter(node => node.selected);
	const configurableNode = selectedNodes.length === 1 && !edges.some(edge => edge.selected) && isConfigurable(selectedNodes[0]!.data.model) ? selectedNodes[0]!.data.model : null;
	const propertiesNode = circuit.nodes.find(node => node.id === propertiesId);
	const configure = (node: CircuitNode) => {
		if (!editing || !isConfigurable(node)) return;
		block.select(false); setTool(null); setPreview(null); setNodeMenu(null); propertiesStore.open(node);
		branch.cancel(); connectionCancelled.current = true; store.getState().cancelConnection(); setConnecting(false);
	};
	const closeProperties = () => { propertiesStore.close(); container.current?.focus({ preventScroll: true }); };
	useEffect(() => { if (!editorOpen || snapshot.conflict) setNodeMenu(null); }, [editorOpen, snapshot.conflict]);
	const changeNodes = (changes: NodeChange<FlowNode>[]) => {
		if (previewingProperties) return;
		if (!writable()) changes = changes.filter(change => change.type === 'dimensions');
		const positions = changes.filter(change => change.type === 'position' && change.dragging !== undefined);
		if (positions.length) blockActions?.beforeResize?.(positions.some(change => change.type === 'position' && change.dragging));
		const constrained = changes.map(change => {
			if (change.type !== 'position' || !change.position) return change;
			const node = circuit.nodes.find(node => node.id === change.id);
			return node ? { ...change, position: constrain(change.position, node) } : change;
		});
		setNodes(previous => applyNodeChanges(constrained, previous));
	};
	const changeEdges = (changes: EdgeChange<FlowEdge>[]) => { if (writable()) setEdges(previous => applyEdgeChanges(changes, previous)); };
	const tryConnection = (connection: Pick<Connection, 'source' | 'target'> & { sourceHandle?: string | null; targetHandle?: string | null }) => {
		const normalized = normalizeFlowConnection(circuit, connection);
		return connect(circuit, normalized.sourceNodeId, normalized.sourcePinId, normalized.targetNodeId, normalized.targetPinId);
	};
	const onConnect = (connection: Connection) => { if (!connectionCancelled.current) run(() => commit(tryConnection(connection))); };
	const scaleTo = (next: number) => run(() => commit({ ...circuit, view: { ...circuit.view, preferredScale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, next)) } }));
	const decrease = scaleStep(scale, -1, fitScale);
	const increase = scaleStep(scale, 1, fitScale);
	const selectBlock = () => {
		if (!writable()) return;
		block.select(true); setNodes(previous => previous.map(node => ({ ...node, selected: false }))); setEdges(previous => previous.map(edge => ({ ...edge, selected: false })));
		setTool(null); setPreview(null); branch.cancel(); connectionCancelled.current = true; store.getState().cancelConnection(); setConnecting(false);
		container.current?.focus({ preventScroll: true });
	};
	return <div className={`logic-circuit${readOnly ? ' is-read-only' : ''}${editorOpen ? ' is-editing' : ''}${block.selected ? ' is-block-selected' : ''}`} ref={container} tabIndex={readOnly ? undefined : 0} role="group" aria-labelledby={name.id} data-circuit-id={circuit.circuitId} onContextMenu={readOnly ? undefined : event => { if (!eventElement(event.target)?.closest('.logic-properties-backdrop')) block.contextMenu(event); }} onFocusCapture={readOnly ? undefined : event => {
		if (!writable()) return;
		if (eventElement(event.target)?.closest('.react-flow__node,.react-flow__edge')) block.select(false);
	}} onPointerDown={readOnly ? undefined : event => {
		if (!writable()) return;
		// Keep Live Preview's Markdown cursor out of the widget; child Flow handlers still run.
		event.stopPropagation();
		if (snapshot.editing && event.target !== event.currentTarget && !eventElement(event.target)?.closest('.logic-block-controls,.logic-toolbar')) block.select(false);
		if (!eventElement(event.target)?.closest('button,input,textarea')) container.current?.focus({ preventScroll: true });
	}} onMouseDownCapture={readOnly ? undefined : event => {
		if (!writable()) return;
		const target = eventElement(event.target);
		const control = target?.closest('button,input,textarea,[contenteditable="true"]');
		if (event.button !== 0 || !target?.closest('.logic-canvas') || control && event.currentTarget.contains(control)) return;
		// Flow's native drag handler stops bubbling before the root sees mousedown.
		// Cancel native focus in capture so the moving node cannot scroll the note.
		// Keep propagation: cancelling pointerdown or stopping here breaks D3 drag.
		event.preventDefault(); container.current?.focus({ preventScroll: true });
	}} onMouseDown={readOnly ? undefined : event => { if (writable()) event.stopPropagation(); }} onClick={readOnly ? undefined : event => {
		if (!writable()) return;
		event.stopPropagation();
		const target = eventElement(event.target);
		if (blockActions && (event.target === event.currentTarget || !snapshot.editing && !target?.closest('button,input,textarea'))) selectBlock();
		else if (!target?.closest('.logic-block-controls,.logic-toolbar')) block.select(false);
		if (!eventElement(event.target)?.closest('button,input,textarea')) container.current?.focus({ preventScroll: true });
	}} onDoubleClick={readOnly ? undefined : event => {
		if (!writable()) return;
		event.stopPropagation();
		if (snapshot.editing || locked || eventElement(event.target)?.closest('button,input,textarea')) return;
		event.preventDefault(); block.select(false); run(() => session.startEditing());
	}} onKeyDown={readOnly ? undefined : event => {
		if (!writable() || propertiesId !== null) return;
		const editable = eventElement(event.target)?.closest('input,textarea,[contenteditable="true"]');
		if (editable && container.current?.contains(editable)) return;
		if (block.selected && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); event.stopPropagation(); block.remove(); return; }
		if (block.selected && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); block.select(false); return; }
		if (!locked && (event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
			event.preventDefault(); event.stopPropagation(); run(() => event.key.toLowerCase() === 'y' || event.shiftKey ? session.redo() : session.undo());
			return;
		}
		if (!snapshot.editing) return;
		if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setTool(null); setPreview(null); branch.cancel(); connectionCancelled.current = true; store.getState().cancelConnection(); setConnecting(false); setHovered(null); }
		if (editing && (event.key === 'Delete' || event.key === 'Backspace')) { event.preventDefault(); event.stopPropagation(); removeSelection(); }
	}}>
		{name.label}{wireName.label}
		{!readOnly && <div className="logic-block-header">
			{snapshot.editing && blockActions && <button type="button" className="logic-delete-circuit" disabled={block.busy || snapshot.conflict} onClick={block.remove}>Delete circuit</button>}
		<div className="logic-block-controls">
			<BlockTools actions={blockActions} selected={block.selected} select={selectBlock} disabled={block.busy} />
			<div className="logic-scale-controls" role="group" aria-labelledby={scaleName.id}>{scaleName.label}
				<AccessibleButton type="button" label="Decrease circuit scale" title="Zoom out" disabled={locked || decrease === null} onClick={() => { if (decrease !== null) scaleTo(decrease); }}>−</AccessibleButton>
				<ScaleControl scale={scale} maximum={fitScale} disabled={locked} commit={scaleTo} />
				<AccessibleButton type="button" label="Increase circuit scale" title="Zoom in" disabled={locked || increase === null} onClick={() => { if (increase !== null) scaleTo(increase); }}>+</AccessibleButton>
				<button type="button" disabled={locked} title="Fit" onClick={() => scaleTo(fitScale)}>Fit</button>
				{!snapshot.editing && <button type="button" className="logic-edit" disabled={locked} onClick={() => run(() => session.startEditing())}>Edit</button>}
			</div>
		</div>
		</div>}
		{editorOpen && <CircuitToolbar tool={tool} select={type => { setTool(type); setPreview(null); setMessage(''); }} canUndo={snapshot.canUndo} canRedo={snapshot.canRedo} undo={() => run(() => session.undo())} redo={() => run(() => session.redo())} canDelete={canDelete} remove={removeSelection} done={finishEditing} busy={snapshot.saving} locked={locked} canConfigure={Boolean(configurableNode)} configure={() => { if (configurableNode) configure(configurableNode); }} />}
		{(message || snapshot.error || block.error) && <div className={`logic-notice${snapshot.error || block.error ? ' is-error' : ''}`} role="alert">{block.error || snapshot.error || message}{!readOnly && snapshot.conflict && <div className="logic-recovery"><button type="button" onClick={() => run(() => session.reload())}>Reload from note</button><button type="button" onClick={() => run(() => session.copyDraft())}>Copy draft</button></div>}</div>}
		{editorOpen && !snapshot.conflict && propertiesNode && <NodeProperties key={propertiesNode.id} store={propertiesStore} node={propertiesNode} circuit={circuit} close={closeProperties} apply={node => run(() => { commit(replaceNode(circuit, node)); closeProperties(); })} />}
		<div className={`logic-canvas${tool ? ' is-placing' : ''}`} ref={canvas} style={{ height }} onDragOver={event => {
			if (!editing || !tool || !event.dataTransfer.types.includes(PLACEMENT_MIME)) return;
			event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setPreview(placement(toPoint({ x: event.clientX, y: event.clientY }), tool));
		}} onDrop={event => {
			if (!editing) return;
			const type = event.dataTransfer.getData(PLACEMENT_MIME) as NodeType;
			if (!PLACEMENT_TOOLS.includes(type)) return;
			event.preventDefault(); event.stopPropagation(); place(toPoint({ x: event.clientX, y: event.clientY }), type);
		}}>
			<DiagramContext.Provider value={{ editing, scale, wireRoutes: liveBounds.wireRoutes, connecting, hovered: wireHover, toPoint, hoverWire, startBranch, selectWire, insertJunction: addJunction, label: (node, value) => run(() => commit(replaceNode(circuit, { ...node, label: value }))) }}>
				<ReactFlow<FlowNode, FlowEdge> nodes={displayedNodes} edges={displayedEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={changeNodes} onEdgesChange={changeEdges} onNodeDoubleClick={(event, node) => { if (editing && isConfigurable(node.data.model)) { event.stopPropagation(); configure(node.data.model); } }} onNodeContextMenu={(event, node) => {
					if (!editing || !isConfigurable(node.data.model)) return;
					event.preventDefault(); event.stopPropagation();
					const rect = container.current?.getBoundingClientRect();
					if (!rect) return;
					block.select(false); setNodes(previous => previous.map(item => ({ ...item, selected: item.id === node.id }))); setEdges(previous => previous.map(item => ({ ...item, selected: false })));
					setNodeMenu({ id: node.id, x: Math.max(0, Math.min(event.clientX - rect.left, rect.width - 112)), y: Math.max(0, Math.min(event.clientY - rect.top, rect.height - 40)) });
				}} nodeDragThreshold={0} onNodeDragStart={() => { dragMoved.current = false; blockActions?.beforeResize?.(true); }} onNodeDrag={() => { dragMoved.current = true; }} onNodeDragStop={(_event, node, draggedNodes) => {
					if (!editing || !writable() || !dragMoved.current) return;
					// The stop event is authoritative even before controlled-node state flushes.
					const positions = new Map([...draggedNodes, node].map(item => [item.id, constrain(item.position, item.data.model)]));
					const next = circuit.nodes.map(node => ({ ...node, position: positions.get(node.id) ?? node.position }));
					if (next.some((node, index) => node.position.x !== circuit.nodes[index]?.position.x || node.position.y !== circuit.nodes[index]?.position.y)) run(() => commit({ ...circuit, nodes: next }));
				}} onConnect={onConnect} onConnectStart={() => { connectionCancelled.current = false; setConnecting(true); setMessage(''); }} onConnectEnd={(event, state) => {
					setConnecting(false);
					if (connectionCancelled.current) { setHovered(null); return; }
					if (state.toHandle) {
						const targetHandle = state.toHandle;
						if (!state.isValid && state.fromHandle) run(() => { tryConnection({ source: state.fromHandle.nodeId, sourceHandle: state.fromHandle.id, target: targetHandle.nodeId, targetHandle: targetHandle.id }); });
						setHovered(null); return;
					}
					const mouse = 'changedTouches' in event ? event.changedTouches[0] : event;
					if (!mouse || !state.fromHandle) { setHovered(null); return; }
					const edgeId = canvas.current?.ownerDocument.elementFromPoint(mouse.clientX, mouse.clientY)?.closest<HTMLElement>('[data-circuit-edge]')?.dataset.circuitEdge;
					const edge = circuit.edges.find(edge => edge.id === edgeId);
					const source = circuit.nodes.find(node => node.id === edge?.sourceNodeId);
					const target = circuit.nodes.find(node => node.id === edge?.targetNodeId);
					if (edge && source && target) {
						const point = nearestOnWire(liveBounds.wireRoutes.get(edge.id) ?? edgeWirePoints(source, edge.sourcePinId, target, edge.targetPinId), toPoint({ x: mouse.clientX, y: mouse.clientY }));
						run(() => commit(branchEdge(circuit, edge.id, { x: point.x - 8, y: point.y - 8 }, state.fromHandle.nodeId, logicalJunctionPin(circuit, state.fromHandle.nodeId, state.fromHandle.id ?? '', 'target'))));
					}
					setHovered(null);
				}} isValidConnection={connection => { try { tryConnection(connection); return true; } catch { return false; } }} connectionMode={ConnectionMode.Loose} connectOnClick={false} connectionLineType={ConnectionLineType.Step} connectionLineComponent={CircuitConnection} nodesDraggable={editing && !tool} nodesConnectable={editing && !tool} elementsSelectable={editing && !tool} nodesFocusable={editing} edgesFocusable={editing} deleteKeyCode={null} disableKeyboardA11y snapToGrid={false} nodeExtent={[[bounds.minX, top], [bounds.minX + (width - PADDING * 2) / scale, Infinity]]} viewport={viewport} minZoom={Math.min(.001, scale)} maxZoom={MAX_SCALE} panOnDrag={false} panOnScroll={false} autoPanOnConnect={false} autoPanOnNodeDrag={false} autoPanOnNodeFocus={false} zoomActivationKeyCode={null} zoomOnScroll={false} zoomOnPinch={false} zoomOnDoubleClick={false} preventScrolling={false} selectionOnDrag={false} selectionKeyCode={null} multiSelectionKeyCode="Shift" proOptions={{ hideAttribution: true }} onPaneClick={event => { if (editing && tool) place(toPoint({ x: event.clientX, y: event.clientY }), tool); }}>
					{editing && <Background variant={BackgroundVariant.Dots} gap={GRID} size={1} color="var(--background-modifier-border)" />}
				</ReactFlow>
			</DiagramContext.Provider>
			{!circuit.nodes.length && !tool && <div className="logic-empty">{readOnly ? 'An empty circuit.' : editorOpen ? 'Select a gate, then click to place it.' : 'An empty circuit. Double-click or select Edit to begin.'}</div>}
			{editing && tool && placementNode && preview && <div className={`logic-placement-preview${preview.valid ? '' : ' is-invalid'}`} style={{ left: viewport.x + preview.position.x * scale, top: viewport.y + preview.position.y * scale, width: sizeFor(placementNode).width * scale, height: sizeFor(placementNode).height * scale }}>{tool === 'input' || tool === 'output' ? <TerminalPreview type={tool} label={placementNode.label ?? ''} scale={scale} /> : isBlockType(tool) ? <BlockSymbol node={placementNode} /> : <GateSymbol type={tool} node={placementNode} />}</div>}
			{branch.branch && <svg className="logic-branch-preview" style={{ width, height }}><path d={pathFor(routedWirePoints(branch.branch.origin, branch.branch.pointer, 'junction').map(point => ({ x: viewport.x + point.x * scale, y: viewport.y + point.y * scale })))} /></svg>}
		</div>
		{editing && nodeMenu && <NodeContextMenu x={nodeMenu.x} y={nodeMenu.y} close={closeMenu} configure={() => { const node = circuit.nodes.find(node => node.id === nodeMenu.id); if (node) configure(node); }} />}
		{editorOpen && <div className="logic-editor-hint"><span>{previewingProperties ? 'Apply to save · Cancel to restore' : tool ? 'Click to place · Esc to cancel' : 'Drag pins to connect · Double-click wires to add junctions'}</span><span className="logic-save-status" role="status">{snapshot.conflict ? 'Draft preserved' : snapshot.saving ? 'Saving…' : previewingProperties ? 'Preview only' : 'Saved'}</span></div>}
	</div>;
}

function makeNodes(circuit: CircuitData, selected = new Set<string>()): FlowNode[] {
	return circuit.nodes.map(node => ({ id: node.id, type: 'circuit', position: node.position, selected: selected.has(node.id), data: { model: node }, measured: sizeFor(node), width: sizeFor(node).width, height: sizeFor(node).height }));
}
function makeEdges(circuit: CircuitData, selected = new Set<string>(), wireLabelId?: string): FlowEdge[] {
	const nodes = new Map(circuit.nodes.map(node => [node.id, node]));
	return circuit.edges.map(edge => {
		const source = nodes.get(edge.sourceNodeId);
		const target = nodes.get(edge.targetNodeId);
		const handles = source && target ? flowHandlesFor(source, edge.sourcePinId, target, edge.targetPinId) : { sourceHandle: edge.sourcePinId, targetHandle: edge.targetPinId };
		// Flow's default edge aria-label contains source IDs and creates an
		// Obsidian hover bubble. Later DOM attributes override that default.
		return { id: edge.id, type: 'wire', source: edge.sourceNodeId, target: edge.targetNodeId, ...handles, selected: selected.has(edge.id), domAttributes: { 'aria-label': undefined, 'aria-labelledby': wireLabelId }, data: {} };
	});
}
