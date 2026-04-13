import {
	bracePositions,
	insertOptions,
	type BracePosition,
	type InsertOption,
	managedSettings,
} from '../constants';

export type TabPolicy = 'space' | 'tab';

export interface FormatterProfileSummary {
	profileName: string;
	indentationSize: number;
	tabSize: number;
	tabPolicy: TabPolicy;
	continuationIndentation: number;
	lineSplit: number;
	blankLinesAfterPackage: number;
	blankLinesAfterImports: number;
	blankLinesBeforeMethod: number;
	typeBracePosition: BracePosition;
	methodBracePosition: BracePosition;
	blockBracePosition: BracePosition;
	spaceBeforeTypeOpeningBrace: InsertOption;
	spaceBeforeMethodOpeningBrace: InsertOption;
	spaceBeforeBlockOpeningBrace: InsertOption;
	settings: Record<string, string>;
	settingCount: number;
	warnings: string[];
}

interface FormatterSettings extends Omit<FormatterProfileSummary, 'settingCount' | 'warnings'> {}

export interface FormatterDocumentUpdate extends Partial<Omit<FormatterSettings, 'settings'>> {
	settings?: Record<string, string | undefined>;
}

const managedSettingIds = Object.values(managedSettings);

export class FormatterXmlService {
	public createDefaultDocument(overrides?: Partial<FormatterSettings>): string {
		const summary = this.mergeDefaults(overrides);
		const settingsMarkup = Object.entries(summary.settings)
			.sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
			.map(([settingId, settingValue]) => `    <setting id="${settingId}" value="${escapeXml(settingValue)}"/>`);

		return [
			'<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
			'<profiles version="21">',
			`  <profile kind="CodeFormatterProfile" name="${escapeXml(summary.profileName)}" version="21">`,
			...settingsMarkup,
			'  </profile>',
			'</profiles>',
		].join('\n');
	}

	public parse(text: string): FormatterProfileSummary {
		const settings = new Map<string, string>();
		const settingPattern = /<setting\b[^>]*\bid="([^"]+)"[^>]*\bvalue="([^"]*)"[^>]*\/?>/g;
		let match: RegExpExecArray | null;

		while ((match = settingPattern.exec(text)) !== null) {
			settings.set(match[1], decodeXml(match[2]));
		}

		const warnings: string[] = [];
		const profileMatch = text.match(/<profile\b[^>]*\bname="([^"]*)"/);

		if (!profileMatch) {
			warnings.push('Could not detect a <profile> name. Using fallback values.');
		}

		const tabPolicy = parseTabPolicy(settings.get(managedSettings.tabPolicy));
		const indentationSize = toPositiveInteger(
			settings.get(managedSettings.indentationSize),
			4,
		);
		const tabSize = toPositiveInteger(settings.get(managedSettings.tabSize), indentationSize);
		const continuationIndentation = toPositiveInteger(settings.get(managedSettings.continuationIndentation), 2);
		const lineSplit = toPositiveInteger(settings.get(managedSettings.lineSplit), 120);
		const blankLinesAfterPackage = toNonNegativeInteger(settings.get(managedSettings.blankLinesAfterPackage), 1);
		const blankLinesAfterImports = toNonNegativeInteger(settings.get(managedSettings.blankLinesAfterImports), 1);
		const blankLinesBeforeMethod = toNonNegativeInteger(settings.get(managedSettings.blankLinesBeforeMethod), 0);
		const typeBracePosition = parseBracePosition(settings.get(managedSettings.typeBracePosition));
		const methodBracePosition = parseBracePosition(settings.get(managedSettings.methodBracePosition));
		const blockBracePosition = parseBracePosition(settings.get(managedSettings.blockBracePosition));
		const spaceBeforeTypeOpeningBrace = parseInsertOption(settings.get(managedSettings.spaceBeforeTypeOpeningBrace));
		const spaceBeforeMethodOpeningBrace = parseInsertOption(settings.get(managedSettings.spaceBeforeMethodOpeningBrace));
		const spaceBeforeBlockOpeningBrace = parseInsertOption(settings.get(managedSettings.spaceBeforeBlockOpeningBrace));
		const parsedSettings = Object.fromEntries(settings);

		const missingManagedSettings = managedSettingIds.filter((settingId) => !settings.has(settingId));
		if (missingManagedSettings.length > 0) {
			warnings.push('Some formatter settings are not explicit in the XML. Eclipse JDT defaults will continue to apply until you set values in the wizard or raw XML.');
		}

		return {
			profileName: decodeXml(profileMatch?.[1] ?? 'Eclipse Formatter Wizard'),
			indentationSize,
			tabSize,
			tabPolicy,
			continuationIndentation,
			lineSplit,
			blankLinesAfterPackage,
			blankLinesAfterImports,
			blankLinesBeforeMethod,
			typeBracePosition,
			methodBracePosition,
			blockBracePosition,
			spaceBeforeTypeOpeningBrace,
			spaceBeforeMethodOpeningBrace,
			spaceBeforeBlockOpeningBrace,
			settings: parsedSettings,
			settingCount: settings.size,
			warnings,
		};
	}

	public updateDocument(text: string, nextSettings: FormatterDocumentUpdate): string {
		const current = this.mergeDefaults(this.parse(text));
		const removedSettingIds = Object.entries(nextSettings.settings ?? {})
			.filter(([, value]) => typeof value !== 'string' || value.length === 0)
			.map(([settingId]) => settingId);
		const mergedSettings: Record<string, string> = Object.fromEntries(
			Object.entries({
				...current.settings,
				...nextSettings.settings,
			}).filter(([, value]) => typeof value === 'string' && value.length > 0),
		) as Record<string, string>;
		const managedSettingOverrides = this.buildManagedSettingOverrides(mergedSettings);
		const merged = this.mergeDefaults({
			...current,
			...managedSettingOverrides,
			...nextSettings,
			settings: mergedSettings,
		});

		if (!text.includes('<profiles') || !text.includes('<profile')) {
			return this.createDefaultDocument(merged);
		}

		const profileMatch = /<profile\b/.exec(text);
		const profileStart = profileMatch?.index ?? -1;
		const profileTagEnd = text.indexOf('>', profileStart);
		const profileEnd = text.indexOf('</profile>');

		if (profileStart === -1 || profileTagEnd === -1 || profileEnd === -1) {
			return this.createDefaultDocument(merged);
		}

		let updated = text;
		const profileTag = updated.slice(profileStart, profileTagEnd + 1);
		const nextProfileTag = upsertAttribute(profileTag, 'name', escapeXml(merged.profileName));
		updated = `${updated.slice(0, profileStart)}${nextProfileTag}${updated.slice(profileTagEnd + 1)}`;
		for (const settingId of removedSettingIds) {
			updated = removeSetting(updated, settingId);
		}

		for (const [settingId, settingValue] of Object.entries(merged.settings).sort(([leftId], [rightId]) => leftId.localeCompare(rightId))) {
			updated = upsertSetting(updated, settingId, settingValue);
		}

		return updated;
	}

	public buildPreview(sourceText: string, formatterXmlText: string): string {
		const settings = this.parse(formatterXmlText);
		const normalized = sourceText.replace(/\r\n/g, '\n');

		return formatJavaIndentation(normalizeBraceLayout(normalizeBlankLines(normalized, settings), settings), settings);
	}

	private mergeDefaults(overrides?: Partial<FormatterSettings>): FormatterSettings {
		const explicitSettings = Object.fromEntries(
			Object.entries(overrides?.settings ?? {}).filter(([, value]) => typeof value === 'string' && value.length > 0),
		);
		const profileName = overrides?.profileName ?? 'Eclipse Formatter Wizard';
		const indentationSize = toPositiveInteger(String(overrides?.indentationSize ?? 4), 4);
		const tabSize = toPositiveInteger(String(overrides?.tabSize ?? overrides?.indentationSize ?? 4), 4);
		const tabPolicy = overrides?.tabPolicy === 'tab' ? 'tab' : 'space';
		const continuationIndentation = toPositiveInteger(String(overrides?.continuationIndentation ?? 2), 2);
		const lineSplit = toPositiveInteger(String(overrides?.lineSplit ?? 120), 120);
		const blankLinesAfterPackage = toNonNegativeInteger(String(overrides?.blankLinesAfterPackage ?? 1), 1);
		const blankLinesAfterImports = toNonNegativeInteger(String(overrides?.blankLinesAfterImports ?? 1), 1);
		const blankLinesBeforeMethod = toNonNegativeInteger(String(overrides?.blankLinesBeforeMethod ?? 0), 0);
		const typeBracePosition = parseBracePosition(overrides?.typeBracePosition);
		const methodBracePosition = parseBracePosition(overrides?.methodBracePosition);
		const blockBracePosition = parseBracePosition(overrides?.blockBracePosition);
		const spaceBeforeTypeOpeningBrace = parseInsertOption(overrides?.spaceBeforeTypeOpeningBrace);
		const spaceBeforeMethodOpeningBrace = parseInsertOption(overrides?.spaceBeforeMethodOpeningBrace);
		const spaceBeforeBlockOpeningBrace = parseInsertOption(overrides?.spaceBeforeBlockOpeningBrace);

		return {
			profileName,
			indentationSize,
			tabSize,
			tabPolicy,
			continuationIndentation,
			lineSplit,
			blankLinesAfterPackage,
			blankLinesAfterImports,
			blankLinesBeforeMethod,
			typeBracePosition,
			methodBracePosition,
			blockBracePosition,
			spaceBeforeTypeOpeningBrace,
			spaceBeforeMethodOpeningBrace,
			spaceBeforeBlockOpeningBrace,
			settings: {
				...explicitSettings,
				[managedSettings.tabPolicy]: tabPolicy,
				[managedSettings.tabSize]: String(tabSize),
				[managedSettings.indentationSize]: String(indentationSize),
				[managedSettings.continuationIndentation]: String(continuationIndentation),
				[managedSettings.lineSplit]: String(lineSplit),
				[managedSettings.blankLinesAfterPackage]: String(blankLinesAfterPackage),
				[managedSettings.blankLinesAfterImports]: String(blankLinesAfterImports),
				[managedSettings.blankLinesBeforeMethod]: String(blankLinesBeforeMethod),
				[managedSettings.typeBracePosition]: typeBracePosition,
				[managedSettings.methodBracePosition]: methodBracePosition,
				[managedSettings.blockBracePosition]: blockBracePosition,
				[managedSettings.spaceBeforeTypeOpeningBrace]: spaceBeforeTypeOpeningBrace,
				[managedSettings.spaceBeforeMethodOpeningBrace]: spaceBeforeMethodOpeningBrace,
				[managedSettings.spaceBeforeBlockOpeningBrace]: spaceBeforeBlockOpeningBrace,
			},
		};
	}

	private buildManagedSettingOverrides(settings: Record<string, string>): Partial<FormatterSettings> {
		const overrides: Partial<FormatterSettings> = {};

		if (typeof settings[managedSettings.tabPolicy] === 'string') {
			overrides.tabPolicy = parseTabPolicy(settings[managedSettings.tabPolicy]);
		}

		if (typeof settings[managedSettings.tabSize] === 'string') {
			overrides.tabSize = toPositiveInteger(settings[managedSettings.tabSize], 4);
		}

		if (typeof settings[managedSettings.indentationSize] === 'string') {
			overrides.indentationSize = toPositiveInteger(settings[managedSettings.indentationSize], 4);
		}

		if (typeof settings[managedSettings.continuationIndentation] === 'string') {
			overrides.continuationIndentation = toPositiveInteger(settings[managedSettings.continuationIndentation], 2);
		}

		if (typeof settings[managedSettings.lineSplit] === 'string') {
			overrides.lineSplit = toPositiveInteger(settings[managedSettings.lineSplit], 120);
		}

		if (typeof settings[managedSettings.blankLinesAfterPackage] === 'string') {
			overrides.blankLinesAfterPackage = toNonNegativeInteger(settings[managedSettings.blankLinesAfterPackage], 1);
		}

		if (typeof settings[managedSettings.blankLinesAfterImports] === 'string') {
			overrides.blankLinesAfterImports = toNonNegativeInteger(settings[managedSettings.blankLinesAfterImports], 1);
		}

		if (typeof settings[managedSettings.blankLinesBeforeMethod] === 'string') {
			overrides.blankLinesBeforeMethod = toNonNegativeInteger(settings[managedSettings.blankLinesBeforeMethod], 0);
		}

		if (typeof settings[managedSettings.typeBracePosition] === 'string') {
			overrides.typeBracePosition = parseBracePosition(settings[managedSettings.typeBracePosition]);
		}

		if (typeof settings[managedSettings.methodBracePosition] === 'string') {
			overrides.methodBracePosition = parseBracePosition(settings[managedSettings.methodBracePosition]);
		}

		if (typeof settings[managedSettings.blockBracePosition] === 'string') {
			overrides.blockBracePosition = parseBracePosition(settings[managedSettings.blockBracePosition]);
		}

		if (typeof settings[managedSettings.spaceBeforeTypeOpeningBrace] === 'string') {
			overrides.spaceBeforeTypeOpeningBrace = parseInsertOption(settings[managedSettings.spaceBeforeTypeOpeningBrace]);
		}

		if (typeof settings[managedSettings.spaceBeforeMethodOpeningBrace] === 'string') {
			overrides.spaceBeforeMethodOpeningBrace = parseInsertOption(settings[managedSettings.spaceBeforeMethodOpeningBrace]);
		}

		if (typeof settings[managedSettings.spaceBeforeBlockOpeningBrace] === 'string') {
			overrides.spaceBeforeBlockOpeningBrace = parseInsertOption(settings[managedSettings.spaceBeforeBlockOpeningBrace]);
		}

		return overrides;
	}
}

type StructuralLineKind = 'package' | 'import' | 'type' | 'method' | 'other';

function normalizeBlankLines(sourceText: string, settings: FormatterProfileSummary): string {
	const normalizedLines: string[] = [];
	let indentLevel = 0;
	let pendingBlankLines = 0;
	let previousNonEmptyKind: StructuralLineKind | undefined;

	for (const rawLine of sourceText.split('\n')) {
		const trimmed = rawLine.trim();

		if (trimmed.length === 0) {
			pendingBlankLines += 1;
			continue;
		}

		const currentKind = classifyStructuralLine(trimmed, indentLevel);
		let blankLinesBefore = previousNonEmptyKind ? pendingBlankLines : 0;
		const desiredBlankLines = getDesiredBlankLines(previousNonEmptyKind, currentKind, indentLevel, settings);
		if (typeof desiredBlankLines === 'number') {
			blankLinesBefore = desiredBlankLines;
		}

		for (let index = 0; index < blankLinesBefore; index += 1) {
			normalizedLines.push('');
		}

		normalizedLines.push(trimmed);
		previousNonEmptyKind = currentKind;
		indentLevel = Math.max(0, indentLevel + measureBraceDelta(trimmed));
		pendingBlankLines = 0;
	}

	return normalizedLines.join('\n');
}

function formatJavaIndentation(sourceText: string, settings: FormatterProfileSummary): string {
	const indentUnit = settings.tabPolicy === 'tab'
		? '\t'
		: ' '.repeat(Math.max(1, settings.indentationSize));
	let indentLevel = 0;
	const output: string[] = [];

	for (const rawLine of sourceText.split('\n')) {
		const trimmed = rawLine.trim();

		if (trimmed.length === 0) {
			output.push('');
			continue;
		}

		const leadingClosers = countLeadingClosers(trimmed);
		const effectiveIndentLevel = Math.max(0, indentLevel - leadingClosers);
		output.push(...wrapFormattedLine(trimmed, effectiveIndentLevel, indentUnit, settings));

		const delta = measureBraceDelta(trimmed);
		indentLevel = Math.max(0, indentLevel + delta);
	}

	return output.join('\n');
}

function wrapFormattedLine(
	line: string,
	baseIndentLevel: number,
	indentUnit: string,
	settings: FormatterProfileSummary,
): string[] {
	const baseIndent = indentUnit.repeat(baseIndentLevel);
	if (measureDisplayWidth(line) + getIndentDisplayWidth(baseIndentLevel, settings) <= settings.lineSplit) {
		return [`${baseIndent}${line}`];
	}

	const wrappingPlan = splitWrappingPlan(line);
	if (!wrappingPlan) {
		return [`${baseIndent}${line}`];
	}

	const { segments, separator } = wrappingPlan;
	if (segments.length < 2) {
		return [`${baseIndent}${line}`];
	}

	const wrappedLines: string[] = [];
	const continuationIndentLevel = baseIndentLevel + settings.continuationIndentation;
	const continuationIndent = indentUnit.repeat(continuationIndentLevel);
	const firstLineLimit = Math.max(12, settings.lineSplit - getIndentDisplayWidth(baseIndentLevel, settings));
	const continuationLineLimit = Math.max(12, settings.lineSplit - getIndentDisplayWidth(continuationIndentLevel, settings));
	let currentLine = segments[0];
	let currentLineLimit = firstLineLimit;
	let currentIndent = baseIndent;

	for (const segment of segments.slice(1)) {
		const candidate = `${currentLine}${separator}${segment}`;
		if (measureDisplayWidth(candidate) <= currentLineLimit) {
			currentLine = candidate;
			continue;
		}

		wrappedLines.push(`${currentIndent}${currentLine}`);
		currentLine = segment;
		currentLineLimit = continuationLineLimit;
		currentIndent = continuationIndent;
	}

	wrappedLines.push(`${currentIndent}${currentLine}`);
	return wrappedLines;
}

function classifyStructuralLine(line: string, indentLevel: number): StructuralLineKind {
	if (indentLevel === 0 && /^package\b/.test(line)) {
		return 'package';
	}

	if (indentLevel === 0 && /^import\b/.test(line)) {
		return 'import';
	}

	if (/\b(class|interface|enum|record)\b/.test(line)) {
		return 'type';
	}

	if (indentLevel === 1 && isLikelyMethodDeclaration(line)) {
		return 'method';
	}

	return 'other';
}

function getDesiredBlankLines(
	previousKind: StructuralLineKind | undefined,
	currentKind: StructuralLineKind,
	indentLevel: number,
	settings: FormatterProfileSummary,
): number | undefined {
	if (previousKind === 'package') {
		return settings.blankLinesAfterPackage;
	}

	if (previousKind === 'import' && currentKind !== 'import') {
		return settings.blankLinesAfterImports;
	}

	if (currentKind === 'method' && indentLevel === 1) {
		return settings.blankLinesBeforeMethod;
	}

	return undefined;
}

function normalizeBraceLayout(sourceText: string, settings: FormatterProfileSummary): string {
	const normalizedLines: string[] = [];

	for (const rawLine of sourceText.split('\n')) {
		const trimmed = rawLine.trim();

		if (trimmed.length === 0) {
			normalizedLines.push('');
			continue;
		}

		if (!trimmed.includes('{') || trimmed === '{') {
			normalizedLines.push(trimmed);
			continue;
		}

		const braceKind = classifyBraceKind(trimmed);
		const bracePosition = braceKind === 'type'
			? settings.typeBracePosition
			: braceKind === 'method'
				? settings.methodBracePosition
				: settings.blockBracePosition;
		const insertSpaceBeforeBrace = braceKind === 'type'
			? settings.spaceBeforeTypeOpeningBrace === 'insert'
			: braceKind === 'method'
				? settings.spaceBeforeMethodOpeningBrace === 'insert'
				: settings.spaceBeforeBlockOpeningBrace === 'insert';

		normalizedLines.push(...rewriteBraceLine(trimmed, bracePosition, insertSpaceBeforeBrace));
	}

	return normalizedLines.join('\n');
}

function rewriteBraceLine(
	line: string,
	bracePosition: BracePosition,
	insertSpaceBeforeBrace: boolean,
): string[] {
	const braceIndex = line.indexOf('{');
	if (braceIndex === -1) {
		return [line];
	}

	const beforeBrace = line.slice(0, braceIndex).replace(/\s+$/, '');
	const afterBrace = line.slice(braceIndex + 1).replace(/^\s*/, '');
	const inlineBrace = `${beforeBrace}${insertSpaceBeforeBrace ? ' {' : '{'}${afterBrace ? ` ${afterBrace}` : ''}`.trimEnd();

	if (bracePosition === 'end_of_line') {
		return [inlineBrace];
	}

	const braceLine = bracePosition === 'next_line_shifted' ? '\t{' : '{';
	if (!afterBrace) {
		return [beforeBrace, braceLine];
	}

	return [beforeBrace, braceLine, afterBrace];
}

function splitWrappingPlan(line: string): { segments: string[]; separator: string } | undefined {
	const commaSegments = splitWrappingSegments(line);
	if (commaSegments.length > 1) {
		return {
			segments: commaSegments,
			separator: ' ',
		};
	}

	const chainSegments = splitMethodChainSegments(line);
	if (chainSegments.length > 1) {
		return {
			segments: chainSegments,
			separator: '',
		};
	}

	const binarySegments = splitBinaryExpressionSegments(line);
	if (binarySegments.length > 1) {
		return {
			segments: binarySegments,
			separator: ' ',
		};
	}

	return undefined;
}

function splitWrappingSegments(line: string): string[] {
	const matches = line.match(/[^,]+(?:,|$)/g) ?? [];
	return matches
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

function splitMethodChainSegments(line: string): string[] {
	const breakIndices: number[] = [];
	let parenthesesDepth = 0;
	let stringDelimiter: '"' | "'" | undefined;
	let isEscaped = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];

		if (stringDelimiter) {
			if (isEscaped) {
				isEscaped = false;
				continue;
			}

			if (character === '\\') {
				isEscaped = true;
				continue;
			}

			if (character === stringDelimiter) {
				stringDelimiter = undefined;
			}

			continue;
		}

		if (character === '"' || character === "'") {
			stringDelimiter = character;
			continue;
		}

		if (character === '(') {
			parenthesesDepth += 1;
			continue;
		}

		if (character === ')') {
			parenthesesDepth = Math.max(0, parenthesesDepth - 1);
			continue;
		}

		if (character !== '.' || parenthesesDepth !== 0) {
			continue;
		}

		const previousCharacter = line[index - 1] ?? '';
		const nextCharacter = line[index + 1] ?? '';
		if (/\d/.test(previousCharacter) || !/[A-Za-z_$]/.test(nextCharacter)) {
			continue;
		}

		breakIndices.push(index);
	}

	if (breakIndices.length === 0) {
		return [line];
	}

	const segments: string[] = [];
	let startIndex = 0;
	for (const breakIndex of breakIndices) {
		segments.push(line.slice(startIndex, breakIndex).trimEnd());
		startIndex = breakIndex;
	}

	segments.push(line.slice(startIndex).trim());
	return segments.filter((segment) => segment.length > 0);
}

function splitBinaryExpressionSegments(line: string): string[] {
	const breakIndices: number[] = [];
	const operatorTokens = ['&&', '||', '==', '!=', '>=', '<=', '+', '-', '*', '/', '%', '>', '<'];
	let stringDelimiter: '"' | "'" | undefined;
	let isEscaped = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];

		if (stringDelimiter) {
			if (isEscaped) {
				isEscaped = false;
				continue;
			}

			if (character === '\\') {
				isEscaped = true;
				continue;
			}

			if (character === stringDelimiter) {
				stringDelimiter = undefined;
			}

			continue;
		}

		if (character === '"' || character === "'") {
			stringDelimiter = character;
			continue;
		}

		const token = operatorTokens.find((candidate) => line.startsWith(candidate, index));
		if (!token) {
			continue;
		}

		const previousCharacter = line[index - 1] ?? '';
		const nextCharacter = line[index + token.length] ?? '';
		if (!/\s/.test(previousCharacter) || !/\s/.test(nextCharacter)) {
			continue;
		}

		breakIndices.push(index);
		index += token.length - 1;
	}

	if (breakIndices.length === 0) {
		return [line];
	}

	const segments: string[] = [];
	let startIndex = 0;
	for (const breakIndex of breakIndices) {
		segments.push(line.slice(startIndex, breakIndex).trimEnd());
		startIndex = breakIndex;
	}

	segments.push(line.slice(startIndex).trim());
	return segments.filter((segment) => segment.length > 0);
}

function classifyBraceKind(line: string): 'type' | 'method' | 'block' {
	if (/\b(class|interface|enum|record)\b/.test(line)) {
		return 'type';
	}

	if (isLikelyMethodDeclaration(line)) {
		return 'method';
	}

	return 'block';
}

function isLikelyMethodDeclaration(line: string): boolean {
	if (!line.includes('(') || !line.includes(')')) {
		return false;
	}

	if (/^@(interface)?\b/.test(line)) {
		return false;
	}

	return !/^\b(if|for|while|switch|catch|synchronized)\s*\(/.test(line);
}

function measureBraceDelta(line: string): number {
	const withoutLineComment = line.replace(/\/\/.*$/, '');
	const withoutStrings = withoutLineComment
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, "''")
		.replace(/\/\*.*?\*\//g, '');

	const opens = (withoutStrings.match(/\{/g) ?? []).length;
	const closes = (withoutStrings.match(/\}/g) ?? []).length;

	return opens - closes;
}

function countLeadingClosers(line: string): number {
	const match = line.match(/^\}+/);
	return match?.[0].length ?? 0;
}

function parseTabPolicy(value: string | undefined): TabPolicy {
	return value === 'tab' ? 'tab' : 'space';
}

function parseBracePosition(value: string | undefined): BracePosition {
	return bracePositions.includes(value as BracePosition) ? value as BracePosition : 'end_of_line';
}

function parseInsertOption(value: string | undefined): InsertOption {
	return insertOptions.includes(value as InsertOption) ? value as InsertOption : 'insert';
}

function toPositiveInteger(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toNonNegativeInteger(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? '', 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function measureDisplayWidth(value: string): number {
	return value.length;
}

function getIndentDisplayWidth(indentLevel: number, settings: FormatterProfileSummary): number {
	return settings.tabPolicy === 'tab'
		? indentLevel * settings.tabSize
		: indentLevel * settings.indentationSize;
}

function upsertAttribute(tag: string, attributeName: string, attributeValue: string): string {
	const pattern = new RegExp(`\\b${attributeName}="[^"]*"`);

	if (pattern.test(tag)) {
		return tag.replace(pattern, `${attributeName}="${attributeValue}"`);
	}

	return tag.replace(/>$/, ` ${attributeName}="${attributeValue}">`);
}

function upsertSetting(text: string, settingId: string, settingValue: string): string {
	const escapedId = escapeForRegExp(settingId);
	const pattern = new RegExp(`(<setting\\b[^>]*\\bid="${escapedId}"[^>]*\\bvalue=")([^"]*)("[^>]*\\/?>)`);

	if (pattern.test(text)) {
		return text.replace(pattern, `$1${escapeXml(settingValue)}$3`);
	}

	const profileEnd = text.indexOf('</profile>');
	if (profileEnd === -1) {
		return text;
	}

	const snippet = `    <setting id="${settingId}" value="${escapeXml(settingValue)}"/>\n`;
	return `${text.slice(0, profileEnd)}${snippet}${text.slice(profileEnd)}`;
}

function removeSetting(text: string, settingId: string): string {
	const escapedId = escapeForRegExp(settingId);
	const pattern = new RegExp(`\\s*<setting\\b[^>]*\\bid="${escapedId}"[^>]*\\/?>\\s*`, 'g');
	return text.replace(pattern, '\n');
}

function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function decodeXml(value: string): string {
	return value
		.replaceAll('&quot;', '"')
		.replaceAll('&gt;', '>')
		.replaceAll('&lt;', '<')
		.replaceAll('&amp;', '&');
}
