import * as vscode from 'vscode';
import * as path from 'node:path';

import { JavaFormatterBridge } from '../services/javaFormatterBridge';
import { FormatterXmlService } from '../services/formatterXmlService';
import { PreviewSessionStore } from '../state/previewSessionStore';

export class FormatterPreviewContentProvider implements vscode.TextDocumentContentProvider {
	private readonly onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();

	public readonly onDidChange = this.onDidChangeEmitter.event;

	public constructor(
		private readonly previewSessionStore: PreviewSessionStore,
		private readonly formatterXmlService: FormatterXmlService,
		private readonly javaFormatterBridge: JavaFormatterBridge,
	) {}

	public refresh(formatterDocumentUri: vscode.Uri): void {
		this.onDidChangeEmitter.fire(this.previewSessionStore.getPreviewDocumentUri(formatterDocumentUri));
	}

	public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		const formatterDocumentUri = this.previewSessionStore.getFormatterDocumentUri(uri);
		if (!formatterDocumentUri) {
			return 'Unable to resolve the formatter document for this preview.';
		}

		const sourceFileUri = this.previewSessionStore.getSourceFile(formatterDocumentUri);
		if (!sourceFileUri) {
			return [
				'// No Java preview file selected yet.',
				'// Run "Eclipse Formatter: Select Preview Java File" first.',
			].join('\n');
		}

		const [formatterDocument, sourceDocument] = await Promise.all([
			vscode.workspace.openTextDocument(formatterDocumentUri),
			vscode.workspace.openTextDocument(sourceFileUri),
		]);

		try {
			const formatted = await this.javaFormatterBridge.format({
				formatterXmlText: formatterDocument.getText(),
				sourceText: sourceDocument.getText(),
				sourceFileName: path.basename(sourceFileUri.fsPath),
			});

			this.previewSessionStore.setPreviewStatus(formatterDocumentUri, {
				mode: 'jdt',
				message: 'Preview is using the Eclipse JDT formatter backend.',
			});

			return formatted;
		} catch (error) {
			const errorMessage = getErrorMessage(error);
			this.previewSessionStore.setPreviewStatus(formatterDocumentUri, {
				mode: 'fallback',
				message: 'Preview fell back to the built-in indentation formatter because the Java backend is unavailable.',
				errorMessage,
			});

			return this.formatterXmlService.buildPreview(sourceDocument.getText(), formatterDocument.getText());
		}
	}
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
