import * as vscode from 'vscode';

import { previewScheme } from '../constants';

const previewSelectionsStorageKey = 'previewSelections';

interface PreviewSession {
	formatterDocumentUri: string;
	sourceFileUri?: string;
	previewStatus?: PreviewStatus;
}

export interface PreviewStatus {
	mode: 'idle' | 'jdt' | 'fallback';
	message: string;
	errorMessage?: string;
}

export class PreviewSessionStore {
	private readonly sessions = new Map<string, PreviewSession>();
	private readonly onDidChangeStatusEmitter = new vscode.EventEmitter<vscode.Uri>();

	public constructor(private readonly workspaceState: vscode.Memento) {
		this.restoreSelections();
	}

	public readonly onDidChangeStatus = this.onDidChangeStatusEmitter.event;

	public setSourceFile(formatterDocumentUri: vscode.Uri, sourceFileUri: vscode.Uri): void {
		const key = formatterDocumentUri.toString();
		const current = this.sessions.get(key) ?? { formatterDocumentUri: key };
		current.sourceFileUri = sourceFileUri.toString();
		current.previewStatus = {
			mode: 'idle',
			message: 'Preview file selected. Rendering formatter output...',
		};
		this.sessions.set(key, current);
		void this.persistSelections();
		this.onDidChangeStatusEmitter.fire(formatterDocumentUri);
	}

	public getSourceFile(formatterDocumentUri: vscode.Uri): vscode.Uri | undefined {
		const sourceFileUri = this.sessions.get(formatterDocumentUri.toString())?.sourceFileUri;
		return sourceFileUri ? vscode.Uri.parse(sourceFileUri) : undefined;
	}

	public getFormatterDocumentsForSourceFile(sourceFileUri: vscode.Uri): vscode.Uri[] {
		const matches: vscode.Uri[] = [];

		for (const session of this.sessions.values()) {
			if (session.sourceFileUri === sourceFileUri.toString()) {
				matches.push(vscode.Uri.parse(session.formatterDocumentUri));
			}
		}

		return matches;
	}

	public setPreviewStatus(formatterDocumentUri: vscode.Uri, previewStatus: PreviewStatus): void {
		const key = formatterDocumentUri.toString();
		const current = this.sessions.get(key) ?? { formatterDocumentUri: key };

		if (isSameStatus(current.previewStatus, previewStatus)) {
			return;
		}

		current.previewStatus = previewStatus;
		this.sessions.set(key, current);
		this.onDidChangeStatusEmitter.fire(formatterDocumentUri);
	}

	public getPreviewStatus(formatterDocumentUri: vscode.Uri): PreviewStatus {
		return this.sessions.get(formatterDocumentUri.toString())?.previewStatus ?? {
			mode: 'idle',
			message: 'Select a Java file to render formatter output.',
		};
	}

	public getPreviewDocumentUri(formatterDocumentUri: vscode.Uri): vscode.Uri {
		const params = new URLSearchParams({
			formatter: formatterDocumentUri.toString(),
		});

		return vscode.Uri.from({
			scheme: previewScheme,
			path: `/${encodeURIComponent(formatterDocumentUri.path || formatterDocumentUri.toString())}`,
			query: params.toString(),
		});
	}

	public getFormatterDocumentUri(previewDocumentUri: vscode.Uri): vscode.Uri | undefined {
		const formatterValue = new URLSearchParams(previewDocumentUri.query).get('formatter');
		return formatterValue ? vscode.Uri.parse(formatterValue) : undefined;
	}

	private restoreSelections(): void {
		const savedSelections = this.workspaceState.get<Record<string, string>>(previewSelectionsStorageKey, {});

		for (const [formatterDocumentUri, sourceFileUri] of Object.entries(savedSelections)) {
			this.sessions.set(formatterDocumentUri, {
				formatterDocumentUri,
				sourceFileUri,
				previewStatus: {
					mode: 'idle',
					message: 'Preview file restored from workspace state.',
				},
			});
		}
	}

	private async persistSelections(): Promise<void> {
		const selections: Record<string, string> = {};

		for (const session of this.sessions.values()) {
			if (session.sourceFileUri) {
				selections[session.formatterDocumentUri] = session.sourceFileUri;
			}
		}

		await this.workspaceState.update(previewSelectionsStorageKey, selections);
	}
}

function isSameStatus(left: PreviewStatus | undefined, right: PreviewStatus): boolean {
	return left?.mode === right.mode
		&& left?.message === right.message
		&& left?.errorMessage === right.errorMessage;
}
