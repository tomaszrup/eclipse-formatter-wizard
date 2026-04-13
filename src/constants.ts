export const extensionId = 'eclipse-formatter-wizard';

export const commands = {
	openWizard: 'eclipse-formatter-wizard.openWizard',
	createFormatterXml: 'eclipse-formatter-wizard.createFormatterXml',
	selectPreviewFile: 'eclipse-formatter-wizard.selectPreviewFile',
	showDiffPreview: 'eclipse-formatter-wizard.showDiffPreview',
} as const;

export const previewScheme = 'eclipse-formatter-wizard-preview';

export const bracePositions = [
	'end_of_line',
	'next_line',
	'next_line_shifted',
	'next_line_on_wrap',
] as const;

export type BracePosition = typeof bracePositions[number];

export const insertOptions = ['insert', 'do not insert'] as const;

export type InsertOption = typeof insertOptions[number];

export const managedSettings = {
	tabPolicy: 'org.eclipse.jdt.core.formatter.tabulation.char',
	tabSize: 'org.eclipse.jdt.core.formatter.tabulation.size',
	indentationSize: 'org.eclipse.jdt.core.formatter.indentation.size',
	continuationIndentation: 'org.eclipse.jdt.core.formatter.continuation_indentation',
	lineSplit: 'org.eclipse.jdt.core.formatter.lineSplit',
	blankLinesAfterPackage: 'org.eclipse.jdt.core.formatter.blank_lines_after_package',
	blankLinesAfterImports: 'org.eclipse.jdt.core.formatter.blank_lines_after_imports',
	blankLinesBeforeMethod: 'org.eclipse.jdt.core.formatter.blank_lines_before_method',
	typeBracePosition: 'org.eclipse.jdt.core.formatter.brace_position_for_type_declaration',
	methodBracePosition: 'org.eclipse.jdt.core.formatter.brace_position_for_method_declaration',
	blockBracePosition: 'org.eclipse.jdt.core.formatter.brace_position_for_block',
	spaceBeforeTypeOpeningBrace: 'org.eclipse.jdt.core.formatter.insert_space_before_opening_brace_in_type_declaration',
	spaceBeforeMethodOpeningBrace: 'org.eclipse.jdt.core.formatter.insert_space_before_opening_brace_in_method_declaration',
	spaceBeforeBlockOpeningBrace: 'org.eclipse.jdt.core.formatter.insert_space_before_opening_brace_in_block',
} as const;
