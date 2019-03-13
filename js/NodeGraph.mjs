import * as Node from "./Node.mjs";

import * as PerlinNoise from "../nodes/PerlinNoise.mjs";
import * as Blend from "../nodes/Blend.mjs";

const nodeDatabase = [];

let cursorWireConnection = null;
let cursorWireDirectionOnNodeSide = null;

let draggingSelection = false;
let selectionWasDragged = false;
let dragInitiationTarget;

let panningSelection = false;
let awaitingGraphViewUpdate = false;

let graphOffsetX = 0;
let graphOffsetY = 0;
let graphScale = 1;
const scaleSpeed = 0.1;

export default function initGraph() {
	const perlin1 = Node.constructNode(PerlinNoise.getBlueprint(), 50, 50, false);
	const perlin2 = Node.constructNode(PerlinNoise.getBlueprint(), 50, 500, false);
	const perlin3 = Node.constructNode(PerlinNoise.getBlueprint(), 1000, 100, false);
	const blend1 = Node.constructNode(Blend.getBlueprint(), 600, 350, false);
	const blend2 = Node.constructNode(Blend.getBlueprint(), 1400, 400, false);
	nodeDatabase.push(perlin1, perlin2, perlin3, blend1, blend2);
	
	connectWire(perlin1, "pattern", blend1, "foreground");
	connectWire(perlin2, "pattern", blend1, "background");
	connectWire(perlin3, "pattern", blend2, "foreground");
	connectWire(blend1, "composite", blend2, "background");

	updateGraphView();

	setupEvents();
}

function setupEvents() {
	document.body.addEventListener("mousedown", graphMousedownHandler);
	document.body.addEventListener("mousemove", graphMousemoveHandler);
	document.body.addEventListener("mouseup", graphMouseupHandler);
	document.body.addEventListener("click", graphClickHandler);
	document.body.addEventListener("wheel", graphWheelHandler);
	document.body.addEventListener("keydown", graphKeydownHandler);
}

function graphKeydownHandler(event) {
	if (event.key.toLowerCase() === "a" && event.ctrlKey) {
		if (event.shiftKey) deselectAllNodes();
		else selectAllNodes();
		
		event.preventDefault();
		return;
	}
}

function graphMousedownHandler(event) {
	const target = event.target;
	dragInitiationTarget = target;

	// Left mouse button
	if (event.button === 0) {
		// No nodes selected (clear selection)
		if (!target.closest("section")) {
			deselectAllNodes();
			return;
		}

		// Connector dot selected
		if (target.closest("div.connector")) {
			const connector = target.closest("div.connector");
			const mousePosition = [event.clientX, event.clientY];
			const identifier = connector.dataset["identifier"];
			const nodeElement = connector.closest("section");
			const nodeData = nodeDatabase.find(node => node.element === nodeElement);
			const connectorInput = nodeData.inConnections[identifier];
			
			let targetPath;
			let targetNode = nodeData;
			let targetIdentifier = identifier;
			cursorWireDirectionOnNodeSide = connector.dataset["direction"];
			// Creating a new connection from output to mouse
			if (cursorWireDirectionOnNodeSide === "out") {
				targetPath = createWirePath(connector, mousePosition);
			}
			// Creating a new connection from mouse to input
			else if (cursorWireDirectionOnNodeSide === "in" && connectorInput.length == 0) {
				targetPath = createWirePath(mousePosition, connector);
			}
			// Moving an existing connection
			else if (cursorWireDirectionOnNodeSide === "in" && connectorInput.length > 0) {
				const sourceSide = connectorInput[0];
				disconnectWire(sourceSide.node, sourceSide.identifier, nodeData, identifier);
				
				const connectorElement = sourceSide.node.element.querySelector(`.connector[data-identifier="${sourceSide.identifier}"]`);
				cursorWireDirectionOnNodeSide = "out";
				targetNode = sourceSide.node;
				targetIdentifier = sourceSide.identifier;
				targetPath = createWirePath(connectorElement, mousePosition);
			}

			cursorWireConnection = { node: null, identifier: null, wire: null };
			cursorWireConnection.node = targetNode;
			cursorWireConnection.identifier = targetIdentifier;
			cursorWireConnection.wire = targetPath;

			return;
		}

		if (target.closest("select")) {
			return;
		}

		if (target.closest("input")) {
			// Prevent input selection until click handler
			if (target !== document.activeElement) event.preventDefault();
			event.stopPropagation();
			return;
		}

		// Node selected
		if (target.closest("section")) {
			const nodeElement = target.closest("section");
			const nodeData = nodeDatabase.find(node => node.element === nodeElement);

			if (nodeData.selected) {
				if (event.shiftKey || event.ctrlKey) {
					deselectNode(nodeData);

					// Prevent shift-selection from highlighting text
					event.preventDefault();
				}
				else {
					draggingSelection = true;
				}
			}
			else {
				if (event.shiftKey || event.ctrlKey) {
					selectNode(nodeData);
					draggingSelection = true;

					// Prevent shift-selection from highlighting text
					event.preventDefault();
				}
				else {
					deselectAllNodes();
					selectNode(nodeData);
					draggingSelection = true;
				}
			}

			return;
		}

		// Prevent dragging the background from highlighting text
		if (dragInitiationTarget === document.body) {
			event.preventDefault();
		}
	}

	// Middle mouse button
	if (event.button === 1) {
		if (!panningSelection) {
			panningSelection = true;
			return;
		}
	}
}

function graphMousemoveHandler(event) {
	const mousePosition = [event.clientX, event.clientY];
	const mouseDelta = [event.movementX / graphScale, event.movementY / graphScale];

	if (panningSelection && (event.movementX !== 0 || event.movementY !== 0)) {
		graphOffsetX += mouseDelta[0] * graphScale;
		graphOffsetY += mouseDelta[1] * graphScale;
		updateGraphView();
	}

	if (draggingSelection) {
		moveSelectedNodes(mouseDelta);
		
		// Prevent mouse drag from highlighting text
		event.preventDefault();
	}

	if (cursorWireConnection) {
		const attachedConnectorElement = cursorWireConnection.node.element.querySelector(`.connector[data-identifier="${cursorWireConnection.identifier}"]`);
		
		if (cursorWireDirectionOnNodeSide === "out") updateWire(cursorWireConnection.wire, attachedConnectorElement, mousePosition);
		else if (cursorWireDirectionOnNodeSide === "in") updateWire(cursorWireConnection.wire, mousePosition, attachedConnectorElement);

		// Prevent mouse drag from highlighting text
		event.preventDefault();
	}

	// Prevent dragging the background from highlighting text
	if (dragInitiationTarget === document.body) {
		event.preventDefault();
	}
}

function graphMouseupHandler(event) {
	const target = event.target;

	// Left mouse button
	if (event.button === 0) {
		dragInitiationTarget = undefined;

		if (target.closest("section")) {
			const nodeElement = target.closest("section");
			const nodeData = nodeDatabase.find(node => node.element === nodeElement);

			if (nodeData.selected && !event.shiftKey && !selectionWasDragged) {
				deselectAllNodes();
				selectNode(nodeData);
			}
		}

		if (cursorWireConnection) {
			const nodeSideData = cursorWireConnection.node;
			const nodeSideIdentifier = cursorWireConnection.identifier;

			if (target.closest(".connector")) {
				const nodeElement = target.closest("section");
				const nodeData = nodeDatabase.find(node => node.element === nodeElement);
				const nodeIdentifier = target.closest(".connector").dataset["identifier"];
				
				if (cursorWireDirectionOnNodeSide === "out") connectWire(nodeSideData, nodeSideIdentifier, nodeData, nodeIdentifier);
				else if (cursorWireDirectionOnNodeSide === "in") connectWire(nodeData, nodeIdentifier, nodeSideData, nodeSideIdentifier);
			}

			const path = cursorWireConnection.wire;
			destroyWirePath(path);

			cursorWireConnection = null;
			cursorWireDirectionOnNodeSide = null;
		}

		draggingSelection = false;
		selectionWasDragged = false;
	}

	// Middle mouse button
	if (event.button === 1) {
		if (panningSelection) {
			panningSelection = false;
			return;
		}
	}
}

function graphClickHandler(event) {
	const target = event.target;

	if (target.closest("input")) {
		if (target !== document.activeElement) target.select();
		event.stopPropagation();

		return;
	}
}

function graphWheelHandler(event) {
	const minScale = 0.1;
	const maxScale = 2.0;

	let deltaScale = graphScale * scaleSpeed * (event.deltaY / -100);
	const newScale = graphScale + deltaScale;
	const newScaleClamped = Math.min(Math.max(newScale, minScale), maxScale);
	const clampedExcess = newScale - newScaleClamped;
	const deltaScaleClamped = deltaScale - clampedExcess;

	graphScale = newScaleClamped;
	graphOffsetX -= deltaScaleClamped * event.target.closest("body").clientWidth / 2;
	graphOffsetY -= deltaScaleClamped * event.target.closest("body").clientHeight / 2;

	updateGraphView();

	event.preventDefault();
}

function moveSelectedNodes(deltaMove) {
	nodeDatabase.forEach((nodeData) => {
		if (nodeData.selected) {
			nodeData.x += deltaMove[0];
			nodeData.y += deltaMove[1];
			updateNodePosition(nodeData);
		}
	});

	if (deltaMove[0] !== 0 || deltaMove[1] !== 0) selectionWasDragged = true;
}

function selectAllNodes() {
	nodeDatabase.forEach((nodeData) => {
		selectNode(nodeData);
	});
}

function deselectAllNodes() {
	nodeDatabase.forEach((nodeData) => {
		deselectNode(nodeData);
	});
}

function selectNode(nodeData) {
	nodeData.element.classList.add("selected");
	nodeData.selected = true;
}

function deselectNode(nodeData) {
	nodeData.element.classList.remove("selected");
	nodeData.selected = false;
}

function updateGraphView() {
	if (!awaitingGraphViewUpdate) {
		requestAnimationFrame(() => {
			nodeDatabase.forEach((node) => {
				updateNodePosition(node);
			});
			awaitingGraphViewUpdate = false;
		});
	}
	awaitingGraphViewUpdate = true;
}

function updateNodePosition(nodeData) {
	nodeData.element.style.transform = `translate(${nodeData.x * graphScale + graphOffsetX}px, ${nodeData.y * graphScale + graphOffsetY}px) scale(${graphScale})`;

	// Update any wires connected to out connections
	Object.keys(nodeData.outConnections).forEach((identifier) => {
		const connections = nodeData.outConnections[identifier];

		connections.forEach((connection) => {
			const path = connection.wire;

			const outConnectorElement = nodeData.element;
			const outConnector = outConnectorElement.querySelector(`.connector[data-identifier="${identifier}"]`);

			const inConnectorElement = connection.node.element;
			const inConnector = inConnectorElement.querySelector(`.connector[data-identifier="${connection.identifier}"]`);

			updateWire(path, outConnector, inConnector);
		});
	});

	// Update any wires connected to in connections
	Object.keys(nodeData.inConnections).forEach((identifier) => {
		const connections = nodeData.inConnections[identifier];

		connections.forEach((connection) => {
			const path = connection.wire;

			const inConnectorElement = nodeData.element;
			const inConnector = inConnectorElement.querySelector(`.connector[data-identifier="${identifier}"]`);

			const outConnectorElement = connection.node.element;
			const outConnector = outConnectorElement.querySelector(`.connector[data-identifier="${connection.identifier}"]`);

			updateWire(path, outConnector, inConnector);
		});
	});
}

function updateWire(path, outConnector, inConnector) {
	let outConnectorX;
	let outConnectorY;

	if (outConnector instanceof HTMLElement) {
		const outConnectorRect = outConnector.getBoundingClientRect();
		outConnectorX = outConnectorRect.left + outConnectorRect.width / 2;
		outConnectorY = outConnectorRect.top + outConnectorRect.height / 2;
	}
	else {
		outConnectorX = outConnector[0];
		outConnectorY = outConnector[1];
	}

	let inConnectorX;
	let inConnectorY;
	if (inConnector instanceof HTMLElement) {
		const inConnectorRect = inConnector.getBoundingClientRect();
		inConnectorX = inConnectorRect.left + inConnectorRect.width / 2;
		inConnectorY = inConnectorRect.top + inConnectorRect.height / 2;
	}
	else {
		inConnectorX = inConnector[0];
		inConnectorY = inConnector[1];
	}

	const horizontalGap = Math.abs(outConnectorX - inConnectorX);
	const curveLength = 200;
	const curveFalloffRate = curveLength * Math.PI * 2;
	const curveAmount = (-(2 ** (-10 * horizontalGap / curveFalloffRate)) + 1);
	const curve = curveAmount * curveLength;

	let pathString = `M${outConnectorX},${outConnectorY} C${outConnectorX + curve},${outConnectorY} ${inConnectorX - curve},${inConnectorY} ${inConnectorX},${inConnectorY}`;
	path.setAttribute("d", pathString);
}

function createWirePath(outConnector, inConnector) {
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	updateWire(path, outConnector, inConnector);
	document.querySelector("svg.wires").appendChild(path);
	return path;
}

function destroyWirePath(path) {
	document.querySelector("svg.wires").removeChild(path);
}

function connectWire(outNodeData, outNodeIdentifier, inNodeData, inNodeIdentifier) {
	// Prevent connecting nodes as input->input or output->output
	if (!(outNodeIdentifier in outNodeData.outConnections && inNodeIdentifier in inNodeData.inConnections)) return;

	// Prevent connecting a node to itself
	if (outNodeData === inNodeData) return;

	// Prevent adding duplicate identical connections
	if (connectionAlreadyExists(outNodeData, outNodeIdentifier, inNodeData, inNodeIdentifier)) return;

	// Connect the wire to the output
	const outConnection = { node: inNodeData, identifier: inNodeIdentifier, wire: null };
	outNodeData.outConnections[outNodeIdentifier].push(outConnection);

	// Clear any existing inputs because inputs are exclusive to one wire
	inNodeData.inConnections[inNodeIdentifier].forEach((inConnectionSource) => {
		const outNodeDataForConnection = inConnectionSource.node;
		const outNodeIdentifierForConnection = inConnectionSource.identifier;
		disconnectWire(outNodeDataForConnection, outNodeIdentifierForConnection, inNodeData, inNodeIdentifier);
	});

	// Connect the wire to the input
	const inConnection = { node: outNodeData, identifier: outNodeIdentifier, wire: null };
	inNodeData.inConnections[inNodeIdentifier].push(inConnection);

	const outConnector = outNodeData.element.querySelector(`.connector[data-identifier="${outNodeIdentifier}"]`);
	const inConnector = inNodeData.element.querySelector(`.connector[data-identifier="${inNodeIdentifier}"]`);
	const wire = createWirePath(outConnector, inConnector);

	outConnection.wire = wire;
	inConnection.wire = wire;
}

function disconnectWire(outNodeData, outNodeIdentifier, inNodeData, inNodeIdentifier) {
	const wirePath = outNodeData.outConnections[outNodeIdentifier].find(connection => connection.node === inNodeData && connection.identifier === inNodeIdentifier).wire;
	destroyWirePath(wirePath);

	outNodeData.outConnections[outNodeIdentifier] = outNodeData.outConnections[outNodeIdentifier].filter(connection => connection.identifier !== inNodeIdentifier);
	inNodeData.inConnections[inNodeIdentifier] = inNodeData.inConnections[inNodeIdentifier].filter(connection => connection.identifier !== outNodeIdentifier);
}

function connectionAlreadyExists(outNodeData, outNodeIdentifier, inNodeData, inNodeIdentifier) {
	const outConnector = outNodeData.outConnections[outNodeIdentifier];
	const outConnection = outConnector.find(c => c.identifier === inNodeIdentifier);
	
	const inConnector = inNodeData.inConnections[inNodeIdentifier];
	const inConnection = inConnector.find(c => c.identifier === outNodeIdentifier);

	if (!outConnection || !inConnection) return false;

	const inNodeDataConnectedToOutConnection = outConnection.node;
	const outNodeConnectedToInConnection = inConnection.node;

	return inNodeDataConnectedToOutConnection === inNodeData && outNodeConnectedToInConnection === outNodeData;
}
