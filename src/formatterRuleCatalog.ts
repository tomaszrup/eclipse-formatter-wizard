import { bracePositions, insertOptions, managedSettings } from './constants';
import { supportedFormatterRuleIds } from './supportedFormatterRules';

const booleanOptions = ['true', 'false'] as const;
const keepOnOneLineOptions = ['one_line_never', 'one_line_if_empty', 'one_line_if_single_item', 'one_line_always', 'one_line_preserve'] as const;
const keepOnOneLineCodeBlockOptions = ['one_line_never', 'one_line_if_empty'] as const;
const parenthesesPositionOptions = [
	'common_lines',
	'separate_lines_if_not_empty',
	'separate_lines_if_wrapped',
	'separate_lines',
	'preserve_positions',
] as const;
const compactParenthesesPositionOptions = [
	'common_lines',
	'separate_lines_if_wrapped',
	'separate_lines',
	'preserve_positions',
] as const;
const textBlockIndentationOptions = ['0', '1', '2', '3'] as const;
const tabCharacterOptions = ['space', 'tab', 'mixed'] as const;
const alignmentWrapStyleByBits = new Map<number, AlignmentWrapStyle>([
	[0, 'no_split'],
	[16, 'compact'],
	[32, 'compact_first_break'],
	[48, 'one_per_line'],
	[64, 'next_shifted'],
	[80, 'next_per_line'],
]);

export interface FormatterRuleDefinition {
	id: string;
	family: string;
	familyLabel: string;
	label: string;
}

export interface FormatterRuleEditorState extends FormatterRuleDefinition {
	value: string;
	isExplicit: boolean;
	inputKind: 'text' | 'number' | 'select' | 'alignment';
	options?: readonly string[];
	placeholder: string;
	helpText: string;
	alignmentState?: AlignmentRuleState;
}

export interface AlignmentRuleState {
	encodedValue: string;
	wrapStyle: AlignmentWrapStyle | '';
	indentStyle: AlignmentIndentStyle;
	forceSplit: boolean;
	allowsIndentStyle: boolean;
}

type AlignmentWrapStyle = 'no_split' | 'compact' | 'compact_first_break' | 'next_per_line' | 'next_shifted' | 'one_per_line';
type AlignmentIndentStyle = 'default' | 'on_column' | 'by_one';

interface InputDescriptor {
	inputKind: 'text' | 'number' | 'select' | 'alignment';
	options?: readonly string[];
	helpText: string;
	alignmentState?: AlignmentRuleState;
}

export function loadFormatterRuleDefinitions(_extensionUri?: unknown): FormatterRuleDefinition[] {
	return supportedFormatterRuleIds.map((id) => {
		const family = inferRuleFamily(id);
		return {
			id,
			family,
			familyLabel: humanizeTokenGroup(family),
			label: humanizeTokenGroup(id.replace('org.eclipse.jdt.core.formatter.', '')),
		};
	});
}

export function buildFormatterRuleEditorState(
	ruleDefinitions: readonly FormatterRuleDefinition[],
	settings: Record<string, string>,
): FormatterRuleEditorState[] {
	return ruleDefinitions.map((rule) => {
		const explicitValue = settings[rule.id] ?? '';
		const isExplicit = typeof settings[rule.id] === 'string';
		const descriptor = inferInputDescriptor(rule, explicitValue, isExplicit);

		return {
			...rule,
			value: explicitValue,
			isExplicit,
			inputKind: descriptor.inputKind,
			options: descriptor.options,
			placeholder: isExplicit ? '' : 'Unset in XML. Eclipse JDT defaults apply until you set a value.',
			helpText: descriptor.helpText,
			alignmentState: descriptor.alignmentState,
		};
	});
}

function inferInputDescriptor(rule: FormatterRuleDefinition, value: string, isExplicit: boolean): InputDescriptor {
	if (isAlignmentRule(rule)) {
		return {
			inputKind: 'alignment',
			helpText: 'Use the guided wrap controls instead of editing Eclipse alignment bitmasks by hand.',
			alignmentState: decodeAlignmentState(value, allowsAlignmentIndentStyle(rule)),
		};
	}

	if (rule.id === managedSettings.tabPolicy || value === 'mixed') {
		return {
			inputKind: 'select',
			options: tabCharacterOptions,
			helpText: 'Choose whether indentation is emitted as spaces, tabs, or mixed tab-plus-space alignment.',
		};
	}

	if (bracePositions.includes(value as typeof bracePositions[number]) || rule.family === 'brace_position') {
		return {
			inputKind: 'select',
			options: bracePositions,
			helpText: 'Controls where Eclipse places the opening brace for this construct.',
		};
	}

	if (isParenthesesPositionRule(rule, value)) {
		return {
			inputKind: 'select',
			options: getParenthesesPositionOptions(rule),
			helpText: 'Controls how Eclipse places line breaks around this pair of parentheses when wrapping is needed.',
		};
	}

	if (isKeepOnOneLineRule(rule, value)) {
		return {
			inputKind: 'select',
			options: getKeepOnOneLineOptions(rule),
			helpText: 'Controls when Eclipse is allowed to keep this braced construct on a single line.',
		};
	}

	if (insertOptions.includes(value as typeof insertOptions[number]) || rule.family === 'insert_space' || rule.family === 'insert_new_line') {
		return {
			inputKind: 'select',
			options: insertOptions,
			helpText: rule.family === 'insert_new_line'
				? 'Choose whether Eclipse inserts a line break at this point.'
				: 'Choose whether Eclipse inserts whitespace at this point.',
		};
	}

	if (isInsertStyleRule(rule, value)) {
		return {
			inputKind: 'select',
			options: insertOptions,
			helpText: describeInsertStyleRule(rule),
		};
	}

	if (isBooleanRule(rule, value)) {
		return {
			inputKind: 'select',
			options: booleanOptions,
			helpText: describeBooleanRule(rule),
		};
	}

	if (isTextBlockIndentationRule(rule, value)) {
		return {
			inputKind: 'select',
			options: textBlockIndentationOptions,
			helpText: 'Choose how Eclipse indents wrapped text blocks: preserve source indentation, indent by one level, use the default continuation indent, or align on the current column.',
		};
	}

	if ((isExplicit && /^-?\d+$/u.test(value)) || isLikelyNumericRule(rule)) {
		return {
			inputKind: 'number',
			helpText: describeNumericRule(rule),
		};
	}

	return {
		inputKind: 'text',
		helpText: 'Enter the exact Eclipse formatter value to write into the XML for this rule.',
	};
}

function isAlignmentRule(rule: FormatterRuleDefinition): boolean {
	return rule.id.includes('.alignment_for_');
}

function allowsAlignmentIndentStyle(rule: FormatterRuleDefinition): boolean {
	return !/alignment_for_(?:annotations_on_|type_annotations$)/u.test(rule.id);
}

function isBooleanRule(rule: FormatterRuleDefinition, value: string): boolean {
	if (value === 'true' || value === 'false') {
		return true;
	}

	if (rule.id === 'org.eclipse.jdt.core.formatter.align_fields_grouping_blank_lines') {
		return false;
	}

	if (rule.id.startsWith('org.eclipse.jdt.core.formatter.comment.') && !rule.id.endsWith('.line_length') && !rule.id.includes('insert_new_line')) {
		return true;
	}

	if (/^org\.eclipse\.jdt\.core\.formatter\.(?:use_on_off_tags|format_line_comment_starting_on_first_column|use_tabs_only_for_leading_indentations)$/u.test(rule.id)) {
		return true;
	}

	if (/^org\.eclipse\.jdt\.core\.formatter\.(?:compact_|indent_|join_|keep_(?:empty_array_initializer|simple_|then_statement|else_statement|guardian_clause)|never_indent_|put_empty_statement_on_new_line|wrap_(?:before_|outer_))/u.test(rule.id)) {
		return true;
	}

	return /^org\.eclipse\.jdt\.core\.formatter\.align_[a-z0-9_]+$/u.test(rule.id);
}

function isInsertStyleRule(rule: FormatterRuleDefinition, value: string): boolean {
	if (insertOptions.includes(value as typeof insertOptions[number])) {
		return true;
	}

	return /^org\.eclipse\.jdt\.core\.formatter\.comment\.insert_new_line_/u.test(rule.id);
}

function describeInsertStyleRule(rule: FormatterRuleDefinition): string {
	if (rule.id.startsWith('org.eclipse.jdt.core.formatter.comment.insert_new_line_')) {
		return 'Choose whether Eclipse inserts a line break in this comment layout rule.';
	}

	return 'Choose whether Eclipse inserts a line break at this point.';
}

function describeBooleanRule(rule: FormatterRuleDefinition): string {
	if (rule.id.startsWith('org.eclipse.jdt.core.formatter.align_')) {
		return 'Turns this alignment behavior on or off.';
	}

	if (rule.id.startsWith('org.eclipse.jdt.core.formatter.comment.')) {
		return 'Choose whether Eclipse enables this comment-formatting behavior.';
	}

	return 'Choose whether Eclipse enables this formatter behavior.';
}

function isParenthesesPositionRule(rule: FormatterRuleDefinition, value: string): boolean {
	return rule.family === 'parentheses_positions'
		|| parenthesesPositionOptions.includes(value as typeof parenthesesPositionOptions[number]);
}

function getParenthesesPositionOptions(rule: FormatterRuleDefinition): readonly string[] {
	if (/parentheses_positions_in_(?:if_while_statement|for_statment|switch_statement|try_clause|catch_clause)$/u.test(rule.id)) {
		return compactParenthesesPositionOptions;
	}

	return parenthesesPositionOptions;
}

function isKeepOnOneLineRule(rule: FormatterRuleDefinition, value: string): boolean {
	return rule.family === 'keep_on_one_line'
		|| keepOnOneLineOptions.includes(value as typeof keepOnOneLineOptions[number]);
}

function getKeepOnOneLineOptions(rule: FormatterRuleDefinition): readonly string[] {
	if (rule.id === 'org.eclipse.jdt.core.formatter.keep_code_block_on_one_line') {
		return keepOnOneLineCodeBlockOptions;
	}

	return keepOnOneLineOptions;
}

function isTextBlockIndentationRule(rule: FormatterRuleDefinition, value: string): boolean {
	if (rule.id !== 'org.eclipse.jdt.core.formatter.text_block_indentation') {
		return false;
	}

	return value.length === 0 || textBlockIndentationOptions.includes(value as typeof textBlockIndentationOptions[number]);
}

function isLikelyNumericRule(rule: FormatterRuleDefinition): boolean {
	if (rule.family === 'blank_lines') {
		return true;
	}

	return /(?:lineSplit|line_length|continuation_indentation(?:_for_array_initializer)?|indentation\.size|tabulation\.size|number_of_(?:empty_lines_to_preserve|)|blank_lines_|text_block_indentation|grouping_blank_lines)$/u.test(rule.id);
}

function describeNumericRule(rule: FormatterRuleDefinition): string {
	if (rule.id.endsWith('tabulation.size')) {
		return 'Tab width in spaces. Eclipse uses this to measure indentation and wrapping width.';
	}

	if (rule.id.endsWith('indentation.size')) {
		return 'Indent width in spaces for one logical indentation level.';
	}

	if (/continuation_indentation/u.test(rule.id)) {
		return 'How many indentation levels Eclipse adds when a statement or expression wraps.';
	}

	if (/lineSplit|line_length/u.test(rule.id)) {
		return 'Preferred maximum line width, in characters, before Eclipse starts wrapping.';
	}

	if (/blank_lines|grouping_blank_lines|number_of_blank_lines/u.test(rule.id)) {
		return 'Number of blank lines Eclipse should insert, keep, or treat as part of the same group.';
	}

	if (/number_of_empty_lines_to_preserve/u.test(rule.id)) {
		return 'Maximum number of consecutive blank lines Eclipse preserves from the source.';
	}

	if (/text_block_indentation/u.test(rule.id)) {
		return 'Numeric text-block indentation mode used by Eclipse for multi-line string literals.';
	}

	return 'Numeric Eclipse formatter setting. The value is written directly into the XML for this rule.';
}

function decodeAlignmentState(value: string, allowsIndentStyle: boolean): AlignmentRuleState {
	const encodedValue = value.trim();
	if (encodedValue.length === 0 || !/^-?\d+$/u.test(encodedValue)) {
		return {
			encodedValue,
			wrapStyle: '',
			indentStyle: 'default',
			forceSplit: false,
			allowsIndentStyle,
		};
	}

	const parsedValue = Number.parseInt(encodedValue, 10);
	const wrapStyle = alignmentWrapStyleByBits.get(parsedValue & 112) ?? 'no_split';
	const indentStyle = resolveAlignmentIndentStyle(parsedValue, allowsIndentStyle);

	return {
		encodedValue,
		wrapStyle,
		indentStyle,
		forceSplit: (parsedValue & 1) !== 0,
		allowsIndentStyle,
	};
}

function resolveAlignmentIndentStyle(parsedValue: number, allowsIndentStyle: boolean): AlignmentIndentStyle {
	if (!allowsIndentStyle) {
		return 'default';
	}

	if ((parsedValue & 4) !== 0) {
		return 'by_one';
	}

	if ((parsedValue & 2) !== 0) {
		return 'on_column';
	}

	return 'default';
}

function humanizeTokenGroup(value: string): string {
	return value
		.replaceAll(/([a-z0-9])([A-Z])/gu, '$1 $2')
		.replaceAll(/[._]/gu, ' ')
		.split(/\s+/u)
		.filter((token) => token.length > 0)
		.map(capitalizeToken)
		.join(' ');
}

function capitalizeToken(token: string): string {
	return token.charAt(0).toUpperCase() + token.slice(1);
}

function inferRuleFamily(id: string): string {
	const normalizedId = id.replace('org.eclipse.jdt.core.formatter.', '');

	if (normalizedId.startsWith('comment.')) {
		return 'comment';
	}

	if (normalizedId.startsWith('alignment_for_') || normalizedId.startsWith('align_')) {
		return 'alignment';
	}

	if (normalizedId.startsWith('blank_lines_') || normalizedId.startsWith('number_of_blank_lines_')) {
		return 'blank_lines';
	}

	if (normalizedId.startsWith('brace_position_for_')) {
		return 'brace_position';
	}

	if (normalizedId.startsWith('parentheses_positions_')) {
		return 'parentheses_positions';
	}

	if (normalizedId.startsWith('insert_space_')) {
		return 'insert_space';
	}

	if (normalizedId.startsWith('insert_new_line_')) {
		return 'insert_new_line';
	}

	if (normalizedId.startsWith('keep_') || normalizedId === 'format_guardian_clause_on_one_line') {
		return 'keep_on_one_line';
	}

	if (normalizedId === 'disabling_tag' || normalizedId === 'enabling_tag' || normalizedId === 'use_on_off_tags') {
		return 'on_off_tags';
	}

	if (
		normalizedId === 'lineSplit'
		|| normalizedId === 'text_block_indentation'
		|| normalizedId.startsWith('continuation_indentation')
		|| normalizedId.startsWith('indent')
		|| normalizedId.startsWith('tabulation.')
		|| normalizedId === 'use_tabs_only_for_leading_indentations'
	) {
		return 'indentation_and_wrapping';
	}

	if (normalizedId.startsWith('wrap_')) {
		return 'wrapping';
	}

	if (normalizedId.startsWith('never_indent_')) {
		return 'comment';
	}

	if (normalizedId === 'compact_else_if' || normalizedId === 'put_empty_statement_on_new_line') {
		return 'control_statements';
	}

	return normalizedId.split(/[._]/u, 1)[0] ?? 'other';
}