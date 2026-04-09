import { app } from "../../scripts/app.js";

const TARGET_NODE_TYPES = new Set(["GoogleAIStudioImageGen", "PreviewImage"]);
const OUTPUT_PROP_KEY = "Last Time Image Output";
const FILE_PROP_KEY = "Last Time Image File";
const GOOGLE_IMAGE_NODE = "GoogleAIStudioImageGen";

function cloneOutput(output) {
    return output ? JSON.parse(JSON.stringify(output)) : null;
}

function hasImages(output) {
    return Array.isArray(output?.images) && output.images.length > 0;
}

function getNodeTypeName(node) {
    return node?.comfyClass || node?.type || "";
}

function isTargetNode(node) {
    return TARGET_NODE_TYPES.has(getNodeTypeName(node));
}

function isGoogleImageNode(node) {
    return getNodeTypeName(node) === GOOGLE_IMAGE_NODE;
}

function isPersistentOutput(output) {
    return hasImages(output) && output.images[0]?.type === "output";
}

function getGraphLink(linkId) {
    if (!linkId) {
        return null;
    }
    const links = app.graph?.links;
    return links?.[linkId] ?? null;
}

function getUpstreamNode(node, inputName) {
    const input = node?.inputs?.find((item) => item?.name === inputName);
    const link = getGraphLink(input?.link);
    const originId = link?.origin_id;
    return originId != null ? app.graph?._nodes_by_id?.[originId] ?? null : null;
}

function getPreferredOutput(node, currentOutput = null) {
    if (isPersistentOutput(currentOutput)) {
        return cloneOutput(currentOutput);
    }

    if (getNodeTypeName(node) === "PreviewImage") {
        const upstreamNode = getUpstreamNode(node, "images");
        const upstreamOutput = upstreamNode?.properties?.[OUTPUT_PROP_KEY];
        if (isGoogleImageNode(upstreamNode) && hasImages(upstreamOutput)) {
            return cloneOutput(upstreamOutput);
        }
    }

    const savedOutput = node?.properties?.[OUTPUT_PROP_KEY];
    if (hasImages(savedOutput)) {
        return cloneOutput(savedOutput);
    }

    return null;
}

function refreshCanvas(node) {
    node?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
}

function restorePreview(node) {
    const savedOutput = getPreferredOutput(node);
    if (!hasImages(savedOutput) || typeof node?.onExecuted !== "function") {
        return;
    }

    try {
        node.onExecuted(savedOutput);
        refreshCanvas(node);
    } catch (error) {
        console.warn(
            `[ComfyUI-Google-AI-Studio] Failed to restore persisted preview for node ${node?.id ?? "unknown"}.`,
            error,
        );
    }
}

app.registerExtension({
    name: "ComfyUI.GoogleAIStudio.PersistentPreview",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (!TARGET_NODE_TYPES.has(nodeData.name)) {
            return;
        }

        const originalOnExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function(output) {
            if (originalOnExecuted) {
                originalOnExecuted.apply(this, arguments);
            }

            const preferredOutput = getPreferredOutput(this, output);
            if (!hasImages(preferredOutput)) {
                return;
            }

            this.properties = this.properties || {};
            this.properties[OUTPUT_PROP_KEY] = preferredOutput;
            this.properties[FILE_PROP_KEY] = preferredOutput.images[0]?.filename || "";
            refreshCanvas(this);
        };
    },

    async afterConfigureGraph() {
        for (const node of app.graph?._nodes || []) {
            if (isTargetNode(node)) {
                restorePreview(node);
            }
        }
    },
});
