import * as vscode from 'vscode';
import * as path from 'node:path';

import { commands, previewScheme } from './constants';
import { FormatterWizardPanel } from './panels/formatterWizardPanel';
import { FormatterPreviewContentProvider } from './preview/formatterPreviewContentProvider';
import { JavaFormatterBridge } from './services/javaFormatterBridge';
import { FormatterXmlService } from './services/formatterXmlService';
import { PreviewSessionStore } from './state/previewSessionStore';

export function activate(context: vscode.ExtensionContext): void {
	const formatterXmlService = new FormatterXmlService();
	const javaFormatterBridge = new JavaFormatterBridge(context.extensionUri);
	const previewSessionStore = new PreviewSessionStore(context.workspaceState);
	const previewContentProvider = new FormatterPreviewContentProvider(previewSessionStore, formatterXmlService, javaFormatterBridge);

	const wizardDeps = {
		formatterXmlService,
		previewSessionStore,
		createFormatterDocument: async () => createFormatterDocument(formatterXmlService),
		selectPreviewFile: async (formatterDocumentUri: vscode.Uri) => selectPreviewFile(formatterDocumentUri, previewSessionStore, previewContentProvider),
		showPreview: async (formatterDocumentUri: vscode.Uri) => showDiffPreview(formatterDocumentUri, previewSessionStore, previewContentProvider),
		getPreviewText: async (formatterDocumentUri: vscode.Uri) => previewContentProvider.provideTextDocumentContent(
			previewSessionStore.getPreviewDocumentUri(formatterDocumentUri),
		),
		findActiveFormatterDocument: getActiveFormatterDocument,
	};

	context.subscriptions.push(
		javaFormatterBridge,
		FormatterWizardPanel.registerSerializer(context, wizardDeps),
		vscode.workspace.registerTextDocumentContentProvider(previewScheme, previewContentProvider),
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeTextDocument((event) => {
			if (isFormatterDocument(event.document)) {
				previewContentProvider.refresh(event.document.uri);
				return;
			}

			for (const formatterDocumentUri of previewSessionStore.getFormatterDocumentsForSourceFile(event.document.uri)) {
				previewContentProvider.refresh(formatterDocumentUri);
			}
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.openWizard, () => {
			FormatterWizardPanel.createOrShow(context, wizardDeps, getActiveFormatterDocument()?.uri);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.createFormatterXml, async () => {
			await createFormatterDocument(formatterXmlService);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.selectPreviewFile, async () => {
			const formatterDocument = getActiveFormatterDocument();
			if (!formatterDocument) {
				void vscode.window.showWarningMessage('Open a formatter XML document first.');
				return;
			}

			await selectPreviewFile(formatterDocument.uri, previewSessionStore, previewContentProvider);
		}),
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(commands.showDiffPreview, async () => {
			const formatterDocument = getActiveFormatterDocument();
			if (!formatterDocument) {
				void vscode.window.showWarningMessage('Open a formatter XML document first.');
				return;
			}

			await showDiffPreview(formatterDocument.uri, previewSessionStore, previewContentProvider);
		}),
	);

	// Auto-detect: when an Eclipse formatter XML is opened, auto-show the wizard
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((document) => {
			if (isFormatterDocument(document)) {
				FormatterWizardPanel.createOrShow(context, wizardDeps, document.uri);
			}
		}),
	);

	// Check if the currently active editor already has a formatter document
	const activeFormatter = getActiveFormatterDocument();
	if (activeFormatter) {
		FormatterWizardPanel.createOrShow(context, wizardDeps, activeFormatter.uri);
	}
}

async function createFormatterDocument(formatterXmlService: FormatterXmlService): Promise<vscode.Uri | undefined> {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		void vscode.window.showErrorMessage('Creating a formatter XML file requires an open workspace folder.');
		return undefined;
	}

	const formatterDocumentUri = vscode.Uri.joinPath(workspaceFolder.uri, 'eclipse-formatter.xml');
	const exists = await fileExists(formatterDocumentUri);

	if (!exists) {
		const content = Buffer.from(formatterXmlService.createDefaultDocument(), 'utf8');
		await vscode.workspace.fs.writeFile(formatterDocumentUri, content);
	}

	await vscode.window.showTextDocument(formatterDocumentUri, { preview: false });
	return formatterDocumentUri;
}

async function selectPreviewFile(
	formatterDocumentUri: vscode.Uri,
	previewSessionStore: PreviewSessionStore,
	previewContentProvider: FormatterPreviewContentProvider,
): Promise<vscode.Uri | undefined> {
	const files = await vscode.workspace.findFiles('**/*.java', '**/{node_modules,dist,out,target,bin}/**', 200);

	if (files.length === 0) {
		void vscode.window.showWarningMessage('No Java files were found in the current workspace.');
		return undefined;
	}

	const selection = await vscode.window.showQuickPick(
		files.map((uri) => ({
			label: path.basename(uri.fsPath),
			description: vscode.workspace.asRelativePath(uri, false),
			uri,
		})),
		{
			title: 'Select a Java file for the formatter preview',
		},
	);

	if (!selection) {
		return undefined;
	}

	previewSessionStore.setSourceFile(formatterDocumentUri, selection.uri);
	previewContentProvider.refresh(formatterDocumentUri);
	return selection.uri;
}

async function showDiffPreview(
	formatterDocumentUri: vscode.Uri,
	previewSessionStore: PreviewSessionStore,
	previewContentProvider: FormatterPreviewContentProvider,
): Promise<void> {
	let sourceFileUri = previewSessionStore.getSourceFile(formatterDocumentUri);

	if (!sourceFileUri) {
		sourceFileUri = await selectPreviewFile(formatterDocumentUri, previewSessionStore, previewContentProvider);
		if (!sourceFileUri) {
			return;
		}
	}

	previewContentProvider.refresh(formatterDocumentUri);
	const previewDocumentUri = previewSessionStore.getPreviewDocumentUri(formatterDocumentUri);
	const title = `Formatter Preview: ${path.basename(sourceFileUri.fsPath)} ↔ Preview`;

	await vscode.commands.executeCommand('vscode.diff', sourceFileUri, previewDocumentUri, title);
}

function getActiveFormatterDocument(): vscode.TextDocument | undefined {
	const document = vscode.window.activeTextEditor?.document;
	return document && isFormatterDocument(document) ? document : undefined;
}

function isFormatterDocument(document: vscode.TextDocument): boolean {
	if (!document.fileName.endsWith('.xml') && document.languageId !== 'xml') {
		return false;
	}

	const documentName = path.basename(document.fileName).toLowerCase();
	return documentName.includes('formatter') || document.getText().includes('org.eclipse.jdt.core.formatter');
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

export function deactivate(): void {}

