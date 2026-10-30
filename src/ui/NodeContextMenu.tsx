import { useEffect, useRef } from 'react';
import { useAccessibleLabel } from './accessibility';

export function NodeContextMenu({ x, y, configure, close }: { x: number; y: number; configure: () => void; close: () => void }) {
	const menu = useRef<HTMLDivElement>(null);
	const name = useAccessibleLabel('Component actions');
	useEffect(() => {
		const element = menu.current;
		if (!element) return;
		element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
		const outside = (event: Event) => { if (!element.contains(event.target as Node)) close(); };
		element.ownerDocument.addEventListener('pointerdown', outside, true);
		return () => element.ownerDocument.removeEventListener('pointerdown', outside, true);
	}, [close]);
	return <div ref={menu} className="logic-node-menu" role="menu" aria-labelledby={name.id} style={{ left: x, top: y }} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }} onKeyDown={event => {
		event.stopPropagation();
		if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); close(); }
	}}>{name.label}<button type="button" role="menuitem" onClick={configure}>Properties</button></div>;
}
