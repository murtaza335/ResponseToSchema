"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const webviewProvider_1 = require("./webviewProvider");
const envResolver_1 = require("./envResolver");
const transformerEngine_1 = require("./transformerEngine");
function activate(context) {
    const disposable = vscode.commands.registerCommand('api-schema-architect.openDashboard', () => {
        const panel = webviewProvider_1.ApiSchemaArchitectPanel.createOrShow(context.extensionUri, (message) => {
            void handleWebviewMessage(message, panel);
        });
    });
    context.subscriptions.push(disposable);
}
function deactivate() {
    // No explicit teardown is required; VS Code disposes registered
    // subscriptions (including the panel's message listener) automatically.
}
async function handleWebviewMessage(message, panel) {
    if (message.type === 'executeRequest') {
        await executeRequest(message.payload, panel);
    }
}
/**
 * Runs entirely in the Extension Host so it is not subject to the Webview's
 * CORS/sandbox restrictions. Resolves `{{VAR}}` tokens against the workspace
 * `.env` file, performs the HTTP call, and — on success — pipes the raw JSON
 * body into the transformer engine and opens the generated code beside the
 * panel.
 */
async function executeRequest(payload, panel) {
    try {
        const resolvedUrl = await (0, envResolver_1.resolveEnvTokens)(payload.url);
        if (!resolvedUrl || resolvedUrl.trim().length === 0) {
            throw new Error('Request URL is empty.');
        }
        const resolvedHeaders = {};
        for (const [key, value] of Object.entries(payload.headers)) {
            resolvedHeaders[key] = await (0, envResolver_1.resolveEnvTokens)(value);
        }
        const requestInit = {
            method: payload.method,
            headers: resolvedHeaders,
        };
        if (payload.method !== 'GET' && payload.body && payload.body.trim().length > 0) {
            requestInit.body = await (0, envResolver_1.resolveEnvTokens)(payload.body);
        }
        const response = await fetch(resolvedUrl, requestInit);
        const rawText = await response.text();
        if (!response.ok) {
            panel.postMessage({ type: 'requestError', error: `HTTP ${response.status} ${response.statusText}` });
            void vscode.window.showWarningMessage(`API Schema Architect: request completed with HTTP ${response.status}. Attempting to generate types from the response body anyway.`);
        }
        else {
            panel.postMessage({ type: 'requestSuccess', status: response.status });
        }
        await openGeneratedCode(rawText);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred during the request.';
        panel.postMessage({ type: 'requestError', error: errorMessage });
        void vscode.window.showErrorMessage(`API Schema Architect: ${errorMessage}`);
    }
}
/**
 * Generates the TypeScript interface and Zod schema for the given raw JSON
 * response text, combines them into a single document, and opens it in a
 * new editor tab beside the currently active editor/panel.
 */
async function openGeneratedCode(rawJson) {
    const tsInterface = (0, transformerEngine_1.jsonToTypeScript)(rawJson);
    const zodSchema = (0, transformerEngine_1.jsonToZod)(rawJson);
    const combinedContent = ["import { z } from 'zod';", '', tsInterface.trim(), '', zodSchema.trim(), ''].join('\n');
    const document = await vscode.workspace.openTextDocument({
        content: combinedContent,
        language: 'typescript',
    });
    await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        preview: false,
    });
}
//# sourceMappingURL=extension.js.map