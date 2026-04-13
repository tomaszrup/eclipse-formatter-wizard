import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

interface FormatRequest {
	formatterXmlText: string;
	sourceText: string;
	sourceFileName: string;
	sourceLevel?: string;
}

export class JavaFormatterBridge implements vscode.Disposable {
	private readonly outputChannel: vscode.OutputChannel;
	private buildPromise: Promise<void> | undefined;
	private lastErrorMessage: string | undefined;

	public constructor(private readonly extensionUri: vscode.Uri) {
		this.outputChannel = vscode.window.createOutputChannel('Eclipse Formatter Wizard');
	}

	public async format(request: FormatRequest): Promise<string> {
		await this.ensureRunnerBuilt();

		const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'eclipse-formatter-wizard-'));
		const formatterXmlPath = path.join(tempDirectory, 'formatter.xml');
		const safeFileName = sanitizeFileName(request.sourceFileName || 'Preview.java');
		const sourcePath = path.join(tempDirectory, safeFileName);

		try {
			await Promise.all([
				fs.writeFile(formatterXmlPath, request.formatterXmlText, 'utf8'),
				fs.writeFile(sourcePath, request.sourceText, 'utf8'),
			]);

			const classpath = await this.resolveRuntimeClasspath();
			const args = [
				'-cp',
				classpath,
				'io.github.eclipseformatterwizard.runner.EclipseFormatterRunner',
				formatterXmlPath,
				sourcePath,
				request.sourceLevel ?? '21',
			];

			const { stdout, stderr } = await execFileAsync('java', args, {
				cwd: this.extensionUri.fsPath,
				maxBuffer: 10 * 1024 * 1024,
			});

			if (stderr.trim().length > 0) {
				this.outputChannel.appendLine(stderr.trim());
			}

			return stdout;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportError(`Java formatter bridge failed: ${message}`);
			throw error;
		} finally {
			await fs.rm(tempDirectory, { recursive: true, force: true });
		}
	}

	public dispose(): void {
		this.outputChannel.dispose();
	}

	private async ensureRunnerBuilt(): Promise<void> {
		const runnerJarPath = this.getRunnerJarPath();
		const libDirectory = this.getRunnerLibDirectory();

		if (await fileExists(runnerJarPath) && await directoryHasJarFiles(libDirectory)) {
			return;
		}

		if (!this.buildPromise) {
			this.buildPromise = this.buildRunner().finally(() => {
				this.buildPromise = undefined;
			});
		}

		await this.buildPromise;
	}

	private async buildRunner(): Promise<void> {
		if (process.platform !== 'linux') {
			throw new Error('Automatic Java runner build is currently implemented for Linux only.');
		}

		const scriptPath = path.join(this.extensionUri.fsPath, 'java-runner', 'build-runner.sh');
		this.outputChannel.appendLine('Building Eclipse JDT formatter runner...');

		try {
			const { stdout, stderr } = await execFileAsync('bash', [scriptPath], {
				cwd: this.extensionUri.fsPath,
				maxBuffer: 10 * 1024 * 1024,
			});

			if (stdout.trim().length > 0) {
				this.outputChannel.appendLine(stdout.trim());
			}

			if (stderr.trim().length > 0) {
				this.outputChannel.appendLine(stderr.trim());
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.reportError(`Building the Java formatter runner failed: ${message}`);
			throw error;
		}
	}

	private async resolveRuntimeClasspath(): Promise<string> {
		const runnerJarPath = this.getRunnerJarPath();
		const libDirectory = this.getRunnerLibDirectory();
		const entries = await fs.readdir(libDirectory);
		const jarPaths = entries
			.filter((entry) => entry.endsWith('.jar'))
			.sort()
			.map((entry) => path.join(libDirectory, entry));

		if (jarPaths.length === 0) {
			throw new Error('Java formatter runner libraries were not found after build.');
		}

		return [runnerJarPath, ...jarPaths].join(path.delimiter);
	}

	private getRunnerJarPath(): string {
		return path.join(this.extensionUri.fsPath, 'java-runner', 'build', 'eclipse-formatter-runner.jar');
	}

	private getRunnerLibDirectory(): string {
		return path.join(this.extensionUri.fsPath, 'java-runner', 'build', 'lib');
	}

	private reportError(message: string): void {
		if (this.lastErrorMessage === message) {
			return;
		}

		this.lastErrorMessage = message;
		this.outputChannel.appendLine(message);
	}
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.stat(filePath);
		return true;
	} catch {
		return false;
	}
}

async function directoryHasJarFiles(directoryPath: string): Promise<boolean> {
	try {
		const entries = await fs.readdir(directoryPath);
		return entries.some((entry) => entry.endsWith('.jar'));
	} catch {
		return false;
	}
}

function sanitizeFileName(fileName: string): string {
	return fileName.replace(/[^A-Za-z0-9._-]/g, '_');
}