import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import { commands as extensionCommands } from '../constants';
import { managedSettings } from '../constants';
import { buildFormatterRuleEditorState, loadFormatterRuleDefinitions } from '../formatterRuleCatalog';
import { FormatterXmlService } from '../services/formatterXmlService';
import { PreviewSessionStore } from '../state/previewSessionStore';

class InMemoryMemento implements vscode.Memento {
	private readonly values = new Map<string, unknown>();

	public get<T>(key: string): T | undefined;
	public get<T>(key: string, defaultValue: T): T;
	public get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined;
	}

	public update(key: string, value: unknown): Thenable<void> {
		if (typeof value === 'undefined') {
			this.values.delete(key);
		} else {
			this.values.set(key, value);
		}

		return Promise.resolve();
	}

	public keys(): readonly string[] {
		return Array.from(this.values.keys());
	}
}

suite('Extension Test Suite', () => {
	const formatterXmlService = new FormatterXmlService();
	let extensionActivated = false;

	suiteSetup(async () => {
		const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === 'eclipse-formatter-wizard');
		assert.ok(extension, 'Expected the extension under test to be available.');

		await extension.activate();
		extensionActivated = true;
	});

	test('registers formatter commands', async () => {
		assert.ok(extensionActivated);
		const registeredCommands = await vscode.commands.getCommands(true);

		assert.ok(registeredCommands.includes(extensionCommands.openWizard));
		assert.ok(registeredCommands.includes(extensionCommands.createFormatterXml));
		assert.ok(registeredCommands.includes(extensionCommands.selectPreviewFile));
		assert.ok(registeredCommands.includes(extensionCommands.showDiffPreview));
	});

	test('creates a managed formatter xml document', () => {
		const xml = formatterXmlService.createDefaultDocument();
		const summary = formatterXmlService.parse(xml);

		assert.strictEqual(summary.profileName, 'Eclipse Formatter Wizard');
		assert.strictEqual(summary.indentationSize, 4);
		assert.strictEqual(summary.tabSize, 4);
		assert.strictEqual(summary.tabPolicy, 'space');
		assert.strictEqual(summary.continuationIndentation, 2);
		assert.strictEqual(summary.lineSplit, 120);
		assert.strictEqual(summary.blankLinesAfterPackage, 1);
		assert.strictEqual(summary.blankLinesAfterImports, 1);
		assert.strictEqual(summary.blankLinesBeforeMethod, 0);
		assert.strictEqual(summary.typeBracePosition, 'end_of_line');
		assert.strictEqual(summary.methodBracePosition, 'end_of_line');
		assert.strictEqual(summary.blockBracePosition, 'end_of_line');
		assert.strictEqual(summary.spaceBeforeTypeOpeningBrace, 'insert');
		assert.strictEqual(summary.spaceBeforeMethodOpeningBrace, 'insert');
		assert.strictEqual(summary.spaceBeforeBlockOpeningBrace, 'insert');
		assert.strictEqual(summary.warnings.length, 0);
	});

	test('updates managed settings inside xml', () => {
		const xml = formatterXmlService.createDefaultDocument();
		const updated = formatterXmlService.updateDocument(xml, {
			profileName: 'Team Formatter',
			indentationSize: 2,
			tabSize: 2,
			tabPolicy: 'tab',
			continuationIndentation: 3,
			lineSplit: 100,
			blankLinesAfterPackage: 2,
			blankLinesAfterImports: 1,
			blankLinesBeforeMethod: 1,
			typeBracePosition: 'next_line',
			methodBracePosition: 'next_line_shifted',
			blockBracePosition: 'next_line_on_wrap',
			spaceBeforeTypeOpeningBrace: 'do not insert',
			spaceBeforeMethodOpeningBrace: 'insert',
			spaceBeforeBlockOpeningBrace: 'do not insert',
		});
		const summary = formatterXmlService.parse(updated);

		assert.strictEqual(summary.profileName, 'Team Formatter');
		assert.strictEqual(summary.indentationSize, 2);
		assert.strictEqual(summary.tabSize, 2);
		assert.strictEqual(summary.tabPolicy, 'tab');
		assert.strictEqual(summary.continuationIndentation, 3);
		assert.strictEqual(summary.lineSplit, 100);
		assert.strictEqual(summary.blankLinesAfterPackage, 2);
		assert.strictEqual(summary.blankLinesAfterImports, 1);
		assert.strictEqual(summary.blankLinesBeforeMethod, 1);
		assert.strictEqual(summary.typeBracePosition, 'next_line');
		assert.strictEqual(summary.methodBracePosition, 'next_line_shifted');
		assert.strictEqual(summary.blockBracePosition, 'next_line_on_wrap');
		assert.strictEqual(summary.spaceBeforeTypeOpeningBrace, 'do not insert');
		assert.strictEqual(summary.spaceBeforeMethodOpeningBrace, 'insert');
		assert.strictEqual(summary.spaceBeforeBlockOpeningBrace, 'do not insert');
	});

	test('backfills missing wizard-managed settings when binding a partial formatter xml', () => {
		const partialXml = [
			'<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
			'<profiles version="21">',
			'  <profile kind="CodeFormatterProfile" name="Partial Formatter" version="21">',
			`    <setting id="org.eclipse.jdt.core.formatter.tabulation.char" value="space"/>`,
			'  </profile>',
			'</profiles>',
		].join('\n');

		const summary = formatterXmlService.parse(partialXml);
		const updated = formatterXmlService.updateDocument(partialXml, {
			profileName: summary.profileName,
			indentationSize: summary.indentationSize,
			tabSize: summary.tabSize,
			tabPolicy: summary.tabPolicy,
			continuationIndentation: summary.continuationIndentation,
			lineSplit: summary.lineSplit,
			blankLinesAfterPackage: summary.blankLinesAfterPackage,
			blankLinesAfterImports: summary.blankLinesAfterImports,
			blankLinesBeforeMethod: summary.blankLinesBeforeMethod,
			typeBracePosition: summary.typeBracePosition,
			methodBracePosition: summary.methodBracePosition,
			blockBracePosition: summary.blockBracePosition,
			spaceBeforeTypeOpeningBrace: summary.spaceBeforeTypeOpeningBrace,
			spaceBeforeMethodOpeningBrace: summary.spaceBeforeMethodOpeningBrace,
			spaceBeforeBlockOpeningBrace: summary.spaceBeforeBlockOpeningBrace,
		});
		const nextSummary = formatterXmlService.parse(updated);

		assert.ok(summary.warnings.some((warning) => warning.includes('Eclipse JDT defaults')));
		assert.strictEqual(nextSummary.warnings.length, 0);
		assert.strictEqual(nextSummary.blankLinesAfterPackage, 1);
		assert.strictEqual(nextSummary.blankLinesAfterImports, 1);
		assert.strictEqual(nextSummary.blankLinesBeforeMethod, 0);
		assert.strictEqual(nextSummary.typeBracePosition, 'end_of_line');
		assert.strictEqual(nextSummary.spaceBeforeBlockOpeningBrace, 'insert');
	});

	test('loads the full formatter rule catalog from the generated TypeScript list', () => {
		const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === 'eclipse-formatter-wizard');
		assert.ok(extension, 'Expected the extension under test to be available.');

		const rules = loadFormatterRuleDefinitions(vscode.Uri.file(extension.extensionPath));

		assert.strictEqual(rules.length, 415);
		assert.ok(rules.some((rule) => rule.id === 'org.eclipse.jdt.core.formatter.align_type_members_on_columns'));
		assert.ok(rules.some((rule) => rule.id === 'org.eclipse.jdt.core.formatter.wrap_outer_expressions_when_nested'));
	});

	test('builds guided editor metadata for boolean, numeric, and alignment rules', () => {
		const rules = [
			{
				id: 'org.eclipse.jdt.core.formatter.align_type_members_on_columns',
				family: 'alignment',
				familyLabel: 'Alignment',
				label: 'Align Type Members On Columns',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.alignment_for_arguments_in_method_invocation',
				family: 'alignment',
				familyLabel: 'Alignment',
				label: 'Alignment For Arguments In Method Invocation',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.blank_lines_after_package',
				family: 'blank_lines',
				familyLabel: 'Blank Lines',
				label: 'Blank Lines After Package',
			},
		];

		const state = buildFormatterRuleEditorState(rules, {
			'org.eclipse.jdt.core.formatter.alignment_for_arguments_in_method_invocation': '16',
		});

		assert.strictEqual(state[0]?.inputKind, 'select');
		assert.deepStrictEqual(state[0]?.options, ['true', 'false']);
		assert.strictEqual(state[1]?.inputKind, 'alignment');
		assert.strictEqual(state[1]?.alignmentState?.wrapStyle, 'compact');
		assert.strictEqual(state[1]?.alignmentState?.indentStyle, 'default');
		assert.strictEqual(state[1]?.alignmentState?.forceSplit, false);
		assert.strictEqual(state[2]?.inputKind, 'number');
		assert.ok(state[2]?.helpText.includes('blank lines'));
	});

	test('builds guided editor metadata for finite-value formatter rules', () => {
		const rules = [
			{
				id: 'org.eclipse.jdt.core.formatter.parentheses_positions_in_method_invocation',
				family: 'parentheses_positions',
				familyLabel: 'Parentheses Positions',
				label: 'Parentheses Positions In Method Invocation',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.parentheses_positions_in_switch_statement',
				family: 'parentheses_positions',
				familyLabel: 'Parentheses Positions',
				label: 'Parentheses Positions In Switch Statement',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.keep_code_block_on_one_line',
				family: 'keep_on_one_line',
				familyLabel: 'Keep On One Line',
				label: 'Keep Code Block On One Line',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.comment.insert_new_line_for_parameter',
				family: 'comment',
				familyLabel: 'Comment',
				label: 'Comment Insert New Line For Parameter',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.comment.format_line_comments',
				family: 'comment',
				familyLabel: 'Comment',
				label: 'Comment Format Line Comments',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.use_on_off_tags',
				family: 'on_off_tags',
				familyLabel: 'On Off Tags',
				label: 'Use On Off Tags',
			},
			{
				id: 'org.eclipse.jdt.core.formatter.text_block_indentation',
				family: 'indentation_and_wrapping',
				familyLabel: 'Indentation And Wrapping',
				label: 'Text Block Indentation',
			},
		];

		const state = buildFormatterRuleEditorState(rules, {});

		assert.strictEqual(state[0]?.inputKind, 'select');
		assert.deepStrictEqual(state[0]?.options, [
			'common_lines',
			'separate_lines_if_not_empty',
			'separate_lines_if_wrapped',
			'separate_lines',
			'preserve_positions',
		]);
		assert.strictEqual(state[1]?.inputKind, 'select');
		assert.deepStrictEqual(state[1]?.options, [
			'common_lines',
			'separate_lines_if_wrapped',
			'separate_lines',
			'preserve_positions',
		]);
		assert.strictEqual(state[2]?.inputKind, 'select');
		assert.deepStrictEqual(state[2]?.options, ['one_line_never', 'one_line_if_empty']);
		assert.strictEqual(state[3]?.inputKind, 'select');
		assert.deepStrictEqual(state[3]?.options, ['insert', 'do not insert']);
		assert.strictEqual(state[4]?.inputKind, 'select');
		assert.deepStrictEqual(state[4]?.options, ['true', 'false']);
		assert.strictEqual(state[5]?.inputKind, 'select');
		assert.deepStrictEqual(state[5]?.options, ['true', 'false']);
		assert.strictEqual(state[6]?.inputKind, 'select');
		assert.deepStrictEqual(state[6]?.options, ['0', '1', '2', '3']);
	});

	test('keeps raw text inputs only for genuinely free-form formatter rules', () => {
		const extension = vscode.extensions.all.find((candidate) => candidate.packageJSON.name === 'eclipse-formatter-wizard');
		assert.ok(extension, 'Expected the extension under test to be available.');

		const rules = loadFormatterRuleDefinitions(vscode.Uri.file(extension.extensionPath));
		const state = buildFormatterRuleEditorState(rules, {});
		const textRuleIds = state
			.filter((rule) => rule.inputKind === 'text')
			.map((rule) => rule.id)
			.sort();

		assert.deepStrictEqual(textRuleIds, [
			'org.eclipse.jdt.core.formatter.disabling_tag',
			'org.eclipse.jdt.core.formatter.enabling_tag',
		]);
	});

	test('updates and removes arbitrary formatter rules', () => {
		const arbitraryRuleId = 'org.eclipse.jdt.core.formatter.align_type_members_on_columns';
		const xml = formatterXmlService.createDefaultDocument();
		const updated = formatterXmlService.updateDocument(xml, {
			settings: {
				[arbitraryRuleId]: 'true',
			},
		});
		const updatedSummary = formatterXmlService.parse(updated);

		assert.strictEqual(updatedSummary.settings[arbitraryRuleId], 'true');
		assert.ok(updated.includes(arbitraryRuleId));

		const cleared = formatterXmlService.updateDocument(updated, {
			settings: {
				[arbitraryRuleId]: '',
			},
		});
		const clearedSummary = formatterXmlService.parse(cleared);

		assert.ok(!Object.hasOwn(clearedSummary.settings, arbitraryRuleId));
		assert.ok(!cleared.includes(arbitraryRuleId));
	});

	test('updates wizard-managed settings through raw rule edits', () => {
		const xml = formatterXmlService.createDefaultDocument();
		const updated = formatterXmlService.updateDocument(xml, {
			settings: {
				[managedSettings.tabPolicy]: 'tab',
				[managedSettings.indentationSize]: '2',
				[managedSettings.tabSize]: '2',
				[managedSettings.lineSplit]: '80',
				[managedSettings.typeBracePosition]: 'next_line',
				[managedSettings.spaceBeforeBlockOpeningBrace]: 'do not insert',
			},
		});
		const summary = formatterXmlService.parse(updated);

		assert.strictEqual(summary.tabPolicy, 'tab');
		assert.strictEqual(summary.indentationSize, 2);
		assert.strictEqual(summary.tabSize, 2);
		assert.strictEqual(summary.lineSplit, 80);
		assert.strictEqual(summary.typeBracePosition, 'next_line');
		assert.strictEqual(summary.spaceBeforeBlockOpeningBrace, 'do not insert');
		assert.strictEqual(summary.settings[managedSettings.tabPolicy], 'tab');
		assert.strictEqual(summary.settings[managedSettings.indentationSize], '2');
		assert.strictEqual(summary.settings[managedSettings.lineSplit], '80');
	});

	test('builds an indentation-based java preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
		});
		const source = [
			'public class Demo{',
			'public void test(){',
			'if(true){',
			'System.out.println("hi");',
			'}',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'public class Demo {',
			'  public void test() {',
			'    if(true) {',
			'      System.out.println("hi");',
			'    }',
			'  }',
			'}',
		].join('\n'));
	});

	test('applies blank-line settings in fallback preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
			blankLinesAfterPackage: 2,
			blankLinesAfterImports: 1,
			blankLinesBeforeMethod: 1,
		});
		const source = [
			'package demo;',
			'import java.util.List;',
			'import java.util.Map;',
			'public class Demo {',
			'public void first() {',
			'}',
			'public void second() {',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'package demo;',
			'',
			'',
			'import java.util.List;',
			'import java.util.Map;',
			'',
			'public class Demo {',
			'',
			'  public void first() {',
			'  }',
			'',
			'  public void second() {',
			'  }',
			'}',
		].join('\n'));
	});

	test('wraps long comma-separated lines in fallback preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
			continuationIndentation: 2,
			lineSplit: 28,
		});
		const source = [
			'public class Demo {',
			'public void test() {',
			'doStuff(firstArgument, secondArgument, thirdArgument, fourthArgument);',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'public class Demo {',
			'  public void test() {',
			'    doStuff(firstArgument,',
			'        secondArgument,',
			'        thirdArgument,',
			'        fourthArgument);',
			'  }',
			'}',
		].join('\n'));
	});

	test('wraps long method chains in fallback preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
			continuationIndentation: 2,
			lineSplit: 30,
		});
		const source = [
			'public class Demo {',
			'public void test() {',
			'result = service.load().filterActive().mapNames().collectResult();',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'public class Demo {',
			'  public void test() {',
			'    result = service.load()',
			'        .filterActive()',
			'        .mapNames()',
			'        .collectResult();',
			'  }',
			'}',
		].join('\n'));
	});

	test('wraps long boolean conditions in fallback preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
			continuationIndentation: 2,
			lineSplit: 34,
		});
		const source = [
			'public class Demo {',
			'public void test() {',
			'if (firstCondition && secondCondition && thirdCondition && fourthCondition) {',
			'run();',
			'}',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'public class Demo {',
			'  public void test() {',
			'    if (firstCondition',
			'        && secondCondition',
			'        && thirdCondition',
			'        && fourthCondition) {',
			'      run();',
			'    }',
			'  }',
			'}',
		].join('\n'));
	});

	test('applies brace layout settings in fallback preview', () => {
		const xml = formatterXmlService.updateDocument(formatterXmlService.createDefaultDocument(), {
			indentationSize: 2,
			tabPolicy: 'space',
			typeBracePosition: 'next_line',
			methodBracePosition: 'next_line',
			blockBracePosition: 'next_line',
			spaceBeforeTypeOpeningBrace: 'do not insert',
			spaceBeforeMethodOpeningBrace: 'do not insert',
			spaceBeforeBlockOpeningBrace: 'insert',
		});
		const source = [
			'public class Demo {',
			'public void test() {',
			'if(true){',
			'System.out.println("hi");',
			'}',
			'}',
			'}',
		].join('\n');

		const preview = formatterXmlService.buildPreview(source, xml);

		assert.strictEqual(preview, [
			'public class Demo',
			'{',
			'  public void test()',
			'  {',
			'    if(true)',
			'    {',
			'      System.out.println("hi");',
			'    }',
			'  }',
			'}',
		].join('\n'));
	});

	test('tracks preview backend status per formatter document', () => {
		const previewSessionStore = new PreviewSessionStore(new InMemoryMemento());
		const formatterDocumentUri = vscode.Uri.parse('file:///workspace/eclipse-formatter.xml');
		const sourceFileUri = vscode.Uri.parse('file:///workspace/Demo.java');

		assert.strictEqual(previewSessionStore.getPreviewStatus(formatterDocumentUri).mode, 'idle');

		previewSessionStore.setSourceFile(formatterDocumentUri, sourceFileUri);

		assert.strictEqual(previewSessionStore.getPreviewStatus(formatterDocumentUri).mode, 'idle');
		assert.strictEqual(
			previewSessionStore.getPreviewStatus(formatterDocumentUri).message,
			'Preview file selected. Rendering formatter output...',
		);

		previewSessionStore.setPreviewStatus(formatterDocumentUri, {
			mode: 'jdt',
			message: 'Preview is using the Eclipse JDT formatter backend.',
		});

		assert.deepStrictEqual(previewSessionStore.getPreviewStatus(formatterDocumentUri), {
			mode: 'jdt',
			message: 'Preview is using the Eclipse JDT formatter backend.',
		});
	});

	test('finds formatter documents that depend on a selected source file', () => {
		const previewSessionStore = new PreviewSessionStore(new InMemoryMemento());
		const formatterDocumentA = vscode.Uri.parse('file:///workspace/eclipse-formatter.xml');
		const formatterDocumentB = vscode.Uri.parse('file:///workspace/team-formatter.xml');
		const sharedSourceFile = vscode.Uri.parse('file:///workspace/src/Demo.java');
		const otherSourceFile = vscode.Uri.parse('file:///workspace/src/Other.java');

		previewSessionStore.setSourceFile(formatterDocumentA, sharedSourceFile);
		previewSessionStore.setSourceFile(formatterDocumentB, sharedSourceFile);

		assert.deepStrictEqual(
			previewSessionStore.getFormatterDocumentsForSourceFile(sharedSourceFile).map((uri) => uri.toString()),
			[formatterDocumentA.toString(), formatterDocumentB.toString()],
		);
		assert.deepStrictEqual(previewSessionStore.getFormatterDocumentsForSourceFile(otherSourceFile), []);
	});

	test('restores preview file selections from workspace state', async () => {
		const formatterDocumentUri = vscode.Uri.parse('file:///workspace/eclipse-formatter.xml');
		const sourceFileUri = vscode.Uri.parse('file:///workspace/src/Demo.java');
		const workspaceState = new InMemoryMemento();
		const firstStore = new PreviewSessionStore(workspaceState);

		firstStore.setSourceFile(formatterDocumentUri, sourceFileUri);

		const restoredStore = new PreviewSessionStore(workspaceState);
		assert.strictEqual(restoredStore.getSourceFile(formatterDocumentUri)?.toString(), sourceFileUri.toString());
		assert.strictEqual(restoredStore.getPreviewStatus(formatterDocumentUri).mode, 'idle');
		assert.strictEqual(
			restoredStore.getPreviewStatus(formatterDocumentUri).message,
			'Preview file restored from workspace state.',
		);
	});
});
