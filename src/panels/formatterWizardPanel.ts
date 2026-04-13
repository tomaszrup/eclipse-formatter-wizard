import * as vscode from 'vscode';

import {
	buildFormatterRuleEditorState,
	loadFormatterRuleDefinitions,
	type FormatterRuleDefinition,
	type FormatterRuleEditorState,
} from '../formatterRuleCatalog';
import { FormatterXmlService } from '../services/formatterXmlService';
import type { FormatterDocumentUpdate } from '../services/formatterXmlService';
import { PreviewSessionStore } from '../state/previewSessionStore';
import { getNonce } from '../utils/getNonce';

interface WizardPanelDependencies {
	formatterXmlService: FormatterXmlService;
	previewSessionStore: PreviewSessionStore;
	createFormatterDocument: () => Promise<vscode.Uri | undefined>;
	selectPreviewFile: (formatterDocumentUri: vscode.Uri) => Promise<vscode.Uri | undefined>;
	showPreview: (formatterDocumentUri: vscode.Uri) => Promise<void>;
	getPreviewText: (formatterDocumentUri: vscode.Uri) => Promise<string>;
	findActiveFormatterDocument: () => vscode.TextDocument | undefined;
}

interface WizardRuleValueMessage {
	id: string;
	value: string;
}

interface WizardMessage {
	type?: string;
	value?: string | WizardRuleValueMessage;
}

interface WizardState {
	formatterDocument?: {
		uri: string;
		label: string;
	};
	previewFile?: {
		uri: string;
		label: string;
	};
	profileName: string;
	rules: FormatterRuleEditorState[];
	settingCount: number;
	ruleCount: number;
	warnings: string[];
	previewEngineLabel: string;
	previewEngineMessage: string;
	previewEngineError?: string;
	statusMessage: string;
	previewSourceText?: string;
	previewFormattedText?: string;
}

interface SerializedWizardState {
	formatterDocument?: {
		uri?: string;
	};
}

export class FormatterWizardPanel {
	private static readonly viewType = 'eclipseFormatterWizard.panel';
	private static currentPanel: FormatterWizardPanel | undefined;
	private static currentDependencies: WizardPanelDependencies | undefined;

	public static createOrShow(
		context: vscode.ExtensionContext,
		dependencies: WizardPanelDependencies,
		initialFormatterDocumentUri?: vscode.Uri,
	): void {
		FormatterWizardPanel.currentDependencies = dependencies;
		const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

		if (FormatterWizardPanel.currentPanel) {
			FormatterWizardPanel.currentPanel.reveal(column, initialFormatterDocumentUri);
			return;
		}

		const panel = vscode.window.createWebviewPanel(
			FormatterWizardPanel.viewType,
			'Eclipse Formatter Wizard',
			column,
			FormatterWizardPanel.getWebviewPanelOptions(context),
		);

		FormatterWizardPanel.currentPanel = new FormatterWizardPanel(panel, context, dependencies, initialFormatterDocumentUri);
	}

	public static registerSerializer(
		context: vscode.ExtensionContext,
		dependencies: WizardPanelDependencies,
	): vscode.Disposable {
		FormatterWizardPanel.currentDependencies = dependencies;

		return vscode.window.registerWebviewPanelSerializer(FormatterWizardPanel.viewType, {
			async deserializeWebviewPanel(webviewPanel: vscode.WebviewPanel, state: SerializedWizardState) {
				webviewPanel.webview.options = FormatterWizardPanel.getWebviewOptions(context);

				const dependencies = FormatterWizardPanel.currentDependencies;
				if (!dependencies) {
					return;
				}

				const formatterDocumentUri = state.formatterDocument?.uri
					? vscode.Uri.parse(state.formatterDocument.uri)
					: undefined;
				FormatterWizardPanel.currentPanel = new FormatterWizardPanel(
					webviewPanel,
					context,
					dependencies,
					formatterDocumentUri,
				);
			},
		});
	}

	private static getWebviewOptions(context: vscode.ExtensionContext): vscode.WebviewOptions {
		return {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		};
	}

	private static getWebviewPanelOptions(context: vscode.ExtensionContext): vscode.WebviewPanelOptions & vscode.WebviewOptions {
		return {
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')],
		};
	}

	private formatterDocumentUri: vscode.Uri | undefined;
	private readonly formatterRuleDefinitions: readonly FormatterRuleDefinition[];
	private readonly disposables: vscode.Disposable[] = [];

	private constructor(
		private readonly panel: vscode.WebviewPanel,
		private readonly context: vscode.ExtensionContext,
		private readonly dependencies: WizardPanelDependencies,
		initialFormatterDocumentUri?: vscode.Uri,
	) {
		this.formatterRuleDefinitions = loadFormatterRuleDefinitions(context.extensionUri);
		this.formatterDocumentUri = initialFormatterDocumentUri ?? this.dependencies.findActiveFormatterDocument()?.uri;
		this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
		this.panel.webview.onDidReceiveMessage((message: WizardMessage) => {
			void this.handleMessage(message);
		}, null, this.disposables);

		this.disposables.push(
			vscode.workspace.onDidChangeTextDocument((event) => {
				if (event.document.uri.toString() === this.formatterDocumentUri?.toString()) {
					void this.postState();
					return;
				}

				const previewFile = this.formatterDocumentUri
					? this.dependencies.previewSessionStore.getSourceFile(this.formatterDocumentUri)
					: undefined;
				if (event.document.uri.toString() === previewFile?.toString()) {
					void this.postState();
				}
			}),
			this.dependencies.previewSessionStore.onDidChangeStatus((formatterDocumentUri) => {
				if (formatterDocumentUri.toString() === this.formatterDocumentUri?.toString()) {
					void this.postState();
				}
			}),
		);

		this.panel.webview.html = this.getHtmlForWebview(this.panel.webview);
		void this.postState();
	}

	private reveal(column: vscode.ViewColumn, formatterDocumentUri?: vscode.Uri): void {
		this.panel.reveal(column);
		if (formatterDocumentUri) {
			this.formatterDocumentUri = formatterDocumentUri;
		}
		void this.postState();
	}

	private dispose(): void {
		FormatterWizardPanel.currentPanel = undefined;
		while (this.disposables.length > 0) {
			this.disposables.pop()?.dispose();
		}
	}

	private async handleMessage(message: WizardMessage): Promise<void> {
		switch (message.type) {
			case 'ready':
				await this.postState();
				return;
			case 'createFormatterDocument':
				{
					const formatterDocumentUri = await this.dependencies.createFormatterDocument();
					if (formatterDocumentUri) {
						this.formatterDocumentUri = formatterDocumentUri;
					}
					await this.postState();
					return;
				}
case 'updateProfileName':
				if (!this.formatterDocumentUri || typeof message.value !== 'string') {
					return;
				}

				await this.applySettings({
					profileName: message.value.trim() || 'Eclipse Formatter Wizard',
				});
				return;
			case 'updateRuleValue':
				if (!this.formatterDocumentUri || !isWizardRuleValueMessage(message.value)) {
					return;
				}

				await this.applySettings({
					settings: {
						[message.value.id]: message.value.value,
					},
				});
				return;
			case 'selectPreviewFile':
				if (!this.formatterDocumentUri) {
					return;
				}

				await this.dependencies.selectPreviewFile(this.formatterDocumentUri);
				await this.postState();
				return;
			case 'showPreview':
				if (!this.formatterDocumentUri) {
					return;
				}

				await this.dependencies.showPreview(this.formatterDocumentUri);
				return;
		}
	}

	private async applySettings(nextSettings: FormatterDocumentUpdate): Promise<void> {
		if (!this.formatterDocumentUri) {
			return;
		}

		const document = await vscode.workspace.openTextDocument(this.formatterDocumentUri);
		const updatedText = this.dependencies.formatterXmlService.updateDocument(document.getText(), nextSettings);
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), updatedText);
		const didApply = await vscode.workspace.applyEdit(edit);
		if (!didApply) {
			return;
		}

		await document.save();

		const persistedDocument = await vscode.workspace.openTextDocument(this.formatterDocumentUri);
		if (persistedDocument.getText() !== updatedText) {
			await vscode.workspace.fs.writeFile(this.formatterDocumentUri, Buffer.from(updatedText, 'utf8'));
		}

		await this.postState();
	}

	private async postState(): Promise<void> {
		const state = await this.getState();
		this.panel.webview.postMessage({
			type: 'state',
			state,
		});
		this.panel.webview.postMessage({
			type: 'persist',
			state,
		});
	}

	private async getState(): Promise<WizardState> {
		const emptyRules = buildFormatterRuleEditorState(this.formatterRuleDefinitions, {});

		if (!this.formatterDocumentUri) {
			return {
				profileName: 'Eclipse Formatter Wizard',
				rules: emptyRules,
				settingCount: 0,
				ruleCount: emptyRules.length,
				warnings: [],
				previewEngineLabel: 'No preview session',
				previewEngineMessage: 'Bind a formatter XML file to start tracking preview backend status.',
				statusMessage: 'Create or bind a formatter XML file to start editing settings and previewing Java files.',
			};
		}

		const document = await vscode.workspace.openTextDocument(this.formatterDocumentUri);
		const summary = this.dependencies.formatterXmlService.parse(document.getText());
		const rules = buildFormatterRuleEditorState(this.formatterRuleDefinitions, summary.settings);
		const previewFile = this.dependencies.previewSessionStore.getSourceFile(this.formatterDocumentUri);

		let previewSourceText: string | undefined;
		let previewFormattedText: string | undefined;
		if (previewFile) {
			try {
				const sourceDoc = await vscode.workspace.openTextDocument(previewFile);
				previewSourceText = sourceDoc.getText();
				previewFormattedText = await this.dependencies.getPreviewText(this.formatterDocumentUri);
			} catch {
				previewSourceText = undefined;
				previewFormattedText = undefined;
			}

			previewFormattedText ??= previewSourceText;
		}

		const previewStatus = this.dependencies.previewSessionStore.getPreviewStatus(this.formatterDocumentUri);
		const previewEngineLabel = previewStatus.mode === 'jdt'
			? 'Eclipse JDT'
			: previewStatus.mode === 'fallback'
				? 'Fallback formatter'
				: 'Waiting for preview';

		return {
			formatterDocument: {
				uri: this.formatterDocumentUri.toString(),
				label: vscode.workspace.asRelativePath(this.formatterDocumentUri, false),
			},
			previewFile: previewFile ? {
				uri: previewFile.toString(),
				label: vscode.workspace.asRelativePath(previewFile, false),
			} : undefined,
			profileName: summary.profileName,
			rules,
			settingCount: summary.settingCount,
			ruleCount: rules.length,
			warnings: summary.warnings,
			previewEngineLabel,
			previewEngineMessage: previewStatus.message,
			previewEngineError: previewStatus.errorMessage,
			statusMessage: previewFile
				? 'Preview is active.'
				: 'Select a Java file to see a live preview.',
			previewSourceText,
			previewFormattedText,
		};
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wizard.css'));
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'wizard.js'));
		const nonce = getNonce();

		return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link rel="stylesheet" href="${stylesUri}">
	<title>Eclipse Formatter Wizard</title>
</head>
<body>
	<div class="split-layout">
		<main class="rules-pane">
			<div class="rules-header">
				<div class="rules-header-row">
					<span id="formatterDocumentLabel" class="toolbar-value">Not bound</span>
				</div>
				<div class="form-grid">
					<label>
						<span>Profile Name</span>
						<input id="profileName" type="text" />
					</label>
					<label>
						<span>Search Rules</span>
						<input id="ruleSearch" type="search" placeholder="Filter by name, family, or rule id" />
					</label>
				</div>
			</div>
			<div id="ruleSections" class="rule-sections"></div>
		</main>
		<div id="resizeHandle" class="resize-handle"></div>
		<aside class="preview-pane">
			<div class="pane-toolbar">
				<button id="selectPreviewFile">Select Preview File</button>
				<button id="showPreview">Open Diff Editor</button>
				<span id="previewFileLabel" class="toolbar-value">No file selected</span>
				<span class="toolbar-sep"></span>
				<label class="toggle-label"><input id="toggleDiff" type="checkbox" /> Diff</label>
				<label class="toggle-label"><input id="toggleGuides" type="checkbox" checked /> Guides</label>
			</div>
			<div class="preview-meta">
				<span id="previewEngineLabel" class="toolbar-badge" hidden></span>
				<span id="previewEngineError" class="toolbar-status error-text" hidden></span>
				<ul id="warnings" class="warnings"></ul>
			</div>
			<div id="previewContainer" class="preview-container">
				<pre id="previewContent" class="preview-code"><code>Select a Java file to see a live preview.</code></pre>
			</div>
			<span id="settingCount" hidden>0</span>
			<span id="ruleCount" hidden>0</span>
		</aside>
	</div>
	<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}

function isWizardRuleValueMessage(value: unknown): value is WizardRuleValueMessage {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const candidate = value as Partial<WizardRuleValueMessage>;
	return typeof candidate.id === 'string' && typeof candidate.value === 'string';
}
