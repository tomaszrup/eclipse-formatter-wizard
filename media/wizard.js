(function () {
	// @ts-ignore
	const vscode = acquireVsCodeApi();

	const alignmentWrapOptions = [
		{ value: 'no_split', label: 'No Wrapping' },
		{ value: 'compact', label: 'Compact' },
		{ value: 'compact_first_break', label: 'Compact, Break Before First Element' },
		{ value: 'next_per_line', label: 'Next Elements One Per Line' },
		{ value: 'next_shifted', label: 'Next Elements Shifted' },
		{ value: 'one_per_line', label: 'One Element Per Line' },
	];
	const alignmentIndentOptions = [
		{ value: 'default', label: 'Use Continuation Indent' },
		{ value: 'on_column', label: 'Align On Current Column' },
		{ value: 'by_one', label: 'Indent One Level' },
	];

	const elements = {
		formatterDocumentLabel: document.getElementById('formatterDocumentLabel'),
		previewFileLabel: document.getElementById('previewFileLabel'),
		previewEngineLabel: document.getElementById('previewEngineLabel'),
		settingCount: document.getElementById('settingCount'),
		ruleCount: document.getElementById('ruleCount'),
		profileName: document.getElementById('profileName'),
		ruleSearch: document.getElementById('ruleSearch'),
		ruleSections: document.getElementById('ruleSections'),
		selectPreviewFile: document.getElementById('selectPreviewFile'),
		showPreview: document.getElementById('showPreview'),
		previewEngineError: document.getElementById('previewEngineError'),
		warnings: document.getElementById('warnings'),
		previewContent: document.getElementById('previewContent'),
		toggleDiff: document.getElementById('toggleDiff'),
		toggleGuides: document.getElementById('toggleGuides'),
		resizeHandle: document.getElementById('resizeHandle'),
		splitLayout: document.querySelector('.split-layout'),
	};

	const profileNameFallback = 'Eclipse Formatter Wizard';
	const profileUpdateDelay = 250;
	const ruleUpdateDelay = 250;
	const alignmentWrapBitsByStyle = {
		no_split: 0,
		compact: 16,
		compact_first_break: 32,
		one_per_line: 48,
		next_shifted: 64,
		next_per_line: 80,
	};
	const ruleInputs = new Map();
	const ruleCards = new Map();
	const ruleSections = new Map();
	const ruleTimers = new Map();
	const pendingRuleValues = new Map();
	let profileTimer;
	let pendingProfileValue;
	let hydrating = false;
	let rulesDisabled = true;
	let renderedRuleKey = '';
	let showDiffMode = false;
	let showIndentGuides = Boolean(elements.toggleGuides?.checked);
	let lastSourceText = '';
	let lastFormattedText = '';

	elements.selectPreviewFile.addEventListener('click', () => {
		vscode.postMessage({ type: 'selectPreviewFile' });
	});

	elements.showPreview.addEventListener('click', () => {
		vscode.postMessage({ type: 'showPreview' });
	});

	elements.toggleDiff.addEventListener('change', () => {
		showDiffMode = elements.toggleDiff.checked;
		renderPreview(lastSourceText, lastFormattedText);
	});

	elements.toggleGuides.addEventListener('change', () => {
		showIndentGuides = elements.toggleGuides.checked;
		renderPreview(lastSourceText, lastFormattedText);
	});

	// ── Resize handle ───────────────────────────────────
	{
		let dragging = false;
		const handle = elements.resizeHandle;
		const layout = elements.splitLayout;

		handle.addEventListener('mousedown', (event) => {
			event.preventDefault();
			dragging = true;
			document.body.style.cursor = 'col-resize';
			document.body.style.userSelect = 'none';
		});

		globalThis.addEventListener('mousemove', (event) => {
			if (!dragging) {
				return;
			}
			const rect = layout.getBoundingClientRect();
			const fraction = (event.clientX - rect.left) / rect.width;
			const clamped = Math.max(0.2, Math.min(0.8, fraction));
			layout.style.gridTemplateColumns = `${clamped}fr 4px ${1 - clamped}fr`;
		});

		globalThis.addEventListener('mouseup', () => {
			if (dragging) {
				dragging = false;
				document.body.style.cursor = '';
				document.body.style.userSelect = '';
			}
		});
	}

	elements.profileName.addEventListener('input', () => {
		if (hydrating) {
			return;
		}

		globalThis.clearTimeout(profileTimer);
		pendingProfileValue = elements.profileName.value.trim() || profileNameFallback;
		profileTimer = globalThis.setTimeout(() => {
			vscode.postMessage({
				type: 'updateProfileName',
				value: pendingProfileValue,
			});
		}, profileUpdateDelay);
	});

	elements.ruleSearch.addEventListener('input', applyRuleFilter);
	elements.ruleSections.addEventListener('input', handleRuleInputEvent);
	elements.ruleSections.addEventListener('change', handleRuleInputEvent);

	globalThis.addEventListener('message', (event) => {
		if (event.origin !== globalThis.location.origin) {
			return;
		}

		const message = event.data;
		if (message.type === 'persist') {
			vscode.setState(message.state);
			return;
		}

		if (message.type !== 'state') {
			return;
		}

		const state = message.state;
		hydrating = true;

		renderRules(state.rules);
		elements.formatterDocumentLabel.textContent = state.formatterDocument?.label ?? 'Not bound';
		elements.previewFileLabel.textContent = state.previewFile?.label ?? 'Not selected';
		elements.previewEngineLabel.textContent = state.previewEngineLabel;
		elements.settingCount.textContent = String(state.settingCount);
		elements.ruleCount.textContent = String(state.ruleCount);
		if (pendingProfileValue === undefined || pendingProfileValue === state.profileName) {
			pendingProfileValue = undefined;
			elements.profileName.value = state.profileName;
		}
		elements.previewEngineError.textContent = state.previewEngineError ?? '';
		elements.previewEngineError.hidden = !state.previewEngineError;
		elements.warnings.innerHTML = '';

		for (const rule of state.rules) {
			const pendingValue = pendingRuleValues.get(rule.id);
			if (pendingValue !== undefined && pendingValue !== rule.value) {
				continue;
			}
			if (pendingValue === rule.value) {
				pendingRuleValues.delete(rule.id);
			}
			syncRuleInput(rule);
		}

		(state.warnings ?? []).forEach((warning) => {
			const item = document.createElement('li');
			item.textContent = warning;
			elements.warnings.appendChild(item);
		});

		renderPreview(state.previewSourceText, state.previewFormattedText);

		rulesDisabled = !state.formatterDocument;
		elements.profileName.disabled = rulesDisabled;
		elements.selectPreviewFile.disabled = rulesDisabled;
		elements.showPreview.disabled = rulesDisabled;
		for (const control of ruleInputs.values()) {
			setControlDisabled(control, rulesDisabled);
		}

		hydrating = false;
		applyRuleFilter();
	});

	vscode.postMessage({ type: 'ready' });

	function handleRuleInputEvent(event) {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLSelectElement)) {
			return;
		}

		if (hydrating) {
			return;
		}

		const ruleId = target.dataset.ruleId;
		if (!ruleId) {
			return;
		}

		const value = target.dataset.alignmentField ? getAlignmentRuleValue(target) : target.value;
		if (target.dataset.alignmentField) {
			syncAlignmentSummary(target.closest('.alignment-editor'));
		}
		pendingRuleValues.set(ruleId, value);

		globalThis.clearTimeout(ruleTimers.get(ruleId));
		ruleTimers.set(ruleId, globalThis.setTimeout(() => {
			vscode.postMessage({
				type: 'updateRuleValue',
				value: {
					id: ruleId,
					value,
				},
			});
		}, ruleUpdateDelay));
	}

	function renderRules(rules) {
		const nextRuleKey = rules.map((rule) => `${rule.family}:${rule.id}:${rule.inputKind}`).join('|');
		if (nextRuleKey === renderedRuleKey) {
			return;
		}

		renderedRuleKey = nextRuleKey;
		ruleInputs.clear();
		ruleCards.clear();
		ruleSections.clear();

		const fragment = document.createDocumentFragment();
		const groups = new Map();

		for (const rule of rules) {
			const group = groups.get(rule.family) ?? {
				familyLabel: rule.familyLabel,
				rules: [],
			};
			group.rules.push(rule);
			groups.set(rule.family, group);
		}

		let sectionIndex = 0;
		for (const [family, group] of groups.entries()) {
			const section = document.createElement('details');
			section.className = 'rule-section';
			section.open = false;
			section.dataset.family = family;
			section.dataset.sortOrder = String(sectionIndex);

			const summary = document.createElement('summary');
			summary.className = 'rule-section-summary';
			const title = document.createElement('span');
			title.textContent = group.familyLabel;
			const count = document.createElement('span');
			count.className = 'rule-section-count';
			count.textContent = `${group.rules.length} rules`;
			summary.append(title, count);

			const grid = document.createElement('div');
			grid.className = 'rule-grid';

			for (const rule of group.rules) {
				const card = document.createElement('div');
				card.className = 'rule-card';
				card.dataset.ruleId = rule.id;
				card.dataset.search = `${rule.label} ${rule.familyLabel} ${rule.id}`.toLowerCase();
				card.dataset.sortLength = String(rule.label.length);

				const title = document.createElement('span');
				title.className = 'rule-card-title';
				title.textContent = rule.label;
				title.title = rule.id;

				const input = createRuleInput(rule);
				attachRuleId(input, rule.id);

				card.append(title, input);
				grid.appendChild(card);
				ruleInputs.set(rule.id, input);
				ruleCards.set(rule.id, card);
			}

			section.append(summary, grid);
			fragment.appendChild(section);
			ruleSections.set(family, {
				section,
				count,
			});
			sectionIndex += 1;
		}

		elements.ruleSections.replaceChildren(fragment);
	}

	function attachRuleId(control, ruleId) {
		control.dataset.ruleId = ruleId;
		for (const nestedControl of control.querySelectorAll('input, select')) {
			nestedControl.dataset.ruleId = ruleId;
		}
	}

	function createRuleInput(rule) {
		if (rule.inputKind === 'alignment') {
			const container = document.createElement('div');
			container.className = 'alignment-editor';
			container.dataset.controlKind = 'alignment';

			const wrapSelect = document.createElement('select');
			wrapSelect.className = 'rule-input';
			wrapSelect.dataset.alignmentField = 'wrapStyle';
			wrapSelect.appendChild(createOption('', 'Use Eclipse JDT Default (unset)'));
			for (const option of alignmentWrapOptions) {
				wrapSelect.appendChild(createOption(option.value, option.label));
			}

			const indentSelect = document.createElement('select');
			indentSelect.className = 'rule-input';
			indentSelect.dataset.alignmentField = 'indentStyle';
			for (const option of alignmentIndentOptions) {
				indentSelect.appendChild(createOption(option.value, option.label));
			}

			const footer = document.createElement('div');
			footer.className = 'alignment-footer';

			const forceLabel = document.createElement('label');
			forceLabel.className = 'alignment-checkbox';
			const forceCheckbox = document.createElement('input');
			forceCheckbox.type = 'checkbox';
			forceCheckbox.dataset.alignmentField = 'forceSplit';
			const forceText = document.createElement('span');
			forceText.textContent = 'Force wrapping';
			forceLabel.append(forceCheckbox, forceText);

			const summary = document.createElement('p');
			summary.className = 'alignment-summary';
			summary.dataset.role = 'alignment-summary';

			footer.append(forceLabel, summary);
			container.append(wrapSelect, indentSelect, footer);
			return container;
		}

		if (rule.inputKind === 'select') {
			const select = document.createElement('select');
			select.className = 'rule-input';
			return select;
		}

		const input = document.createElement('input');
		input.className = 'rule-input';
		input.type = rule.inputKind === 'number' ? 'number' : 'text';

		if (rule.inputKind === 'number') {
			const wrapper = document.createElement('span');
			wrapper.className = 'rule-input-number-wrapper';
			input.min = '0';
			const badge = document.createElement('span');
			badge.className = 'rule-input-number-badge';
			badge.textContent = '123';
			wrapper.append(input, badge);
			return wrapper;
		}

		return input;
	}

	function syncRuleInput(rule) {
		const control = ruleInputs.get(rule.id);
		if (!control) {
			return;
		}

		const card = ruleCards.get(rule.id);
		if (card) {
			card.dataset.search = `${rule.label} ${rule.familyLabel} ${rule.id}`.toLowerCase();
			card.dataset.sortLength = String(rule.label.length);
			card.dataset.explicit = String(rule.isExplicit);
		}

		if (control instanceof HTMLSelectElement) {
			syncRuleSelect(control, rule);
			control.value = rule.value;
			return;
		}

		if (control instanceof HTMLInputElement) {
			control.type = rule.inputKind === 'number' ? 'number' : 'text';
			control.placeholder = rule.placeholder;
			control.value = rule.value;
			return;
		}

		if (control instanceof HTMLElement && control.dataset.controlKind === 'alignment') {
			syncAlignmentControl(control, rule);
			return;
		}

		// Number wrapper (span.rule-input-number-wrapper)
		const wrappedInput = control.querySelector?.('input');
		if (wrappedInput instanceof HTMLInputElement) {
			wrappedInput.type = 'number';
			wrappedInput.placeholder = rule.placeholder;
			wrappedInput.value = rule.value;
			return;
		}
	}

	function setControlDisabled(control, disabled) {
		if (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLButtonElement) {
			control.disabled = disabled;
			return;
		}

		for (const nestedControl of control.querySelectorAll('input, select, button')) {
			nestedControl.disabled = disabled;
		}
	}

	function syncAlignmentControl(container, rule) {
		const wrapSelect = container.querySelector('[data-alignment-field="wrapStyle"]');
		const indentSelect = container.querySelector('[data-alignment-field="indentStyle"]');
		const forceCheckbox = container.querySelector('[data-alignment-field="forceSplit"]');
		if (!(wrapSelect instanceof HTMLSelectElement) || !(indentSelect instanceof HTMLSelectElement) || !(forceCheckbox instanceof HTMLInputElement)) {
			return;
		}

		const alignment = rule.alignmentState ?? {
			encodedValue: '',
			wrapStyle: '',
			indentStyle: 'default',
			forceSplit: false,
			allowsIndentStyle: true,
		};

		container.dataset.allowsIndentStyle = String(alignment.allowsIndentStyle);
		wrapSelect.value = alignment.wrapStyle;
		indentSelect.value = alignment.indentStyle;
		indentSelect.hidden = !alignment.allowsIndentStyle;
		indentSelect.disabled = rulesDisabled || alignment.wrapStyle === '' || !alignment.allowsIndentStyle;
		forceCheckbox.checked = alignment.forceSplit;
		forceCheckbox.disabled = rulesDisabled || alignment.wrapStyle === '';
		syncAlignmentSummary(container);
	}

	function syncRuleSelect(select, rule) {
		const optionValues = ['', ...(rule.options ?? [])];
		const needsCustomOption = rule.value && !optionValues.includes(rule.value);
		const renderedOptions = Array.from(select.options).map((option) => option.value);
		const nextOptions = needsCustomOption ? [...optionValues, rule.value] : optionValues;
		if (renderedOptions.join('|') === nextOptions.join('|')) {
			return;
		}

		select.innerHTML = '';
		select.appendChild(createOption('', 'Use Eclipse JDT Default (unset)'));
		for (const optionValue of rule.options ?? []) {
			select.appendChild(createOption(optionValue, formatOptionLabel(rule, optionValue)));
		}
		if (needsCustomOption) {
			select.appendChild(createOption(rule.value, `Custom: ${rule.value}`));
		}
	}

	function createOption(value, label) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = label;
		return option;
	}

	function formatOptionLabel(rule, optionValue) {
		if (rule.id === 'org.eclipse.jdt.core.formatter.tabulation.char') {
			if (optionValue === 'space') {
				return 'Spaces';
			}
			if (optionValue === 'tab') {
				return 'Tabs';
			}
			if (optionValue === 'mixed') {
				return 'Mixed';
			}
		}

		if (optionValue === 'insert') {
			return 'Insert';
		}

		if (optionValue === 'do not insert') {
			return 'Do Not Insert';
		}

		if (optionValue === 'true') {
			return 'True';
		}

		if (optionValue === 'false') {
			return 'False';
		}

		return optionValue
			.replaceAll('_', ' ')
			.replaceAll(/\b\w/g, (character) => character.toUpperCase());
	}

	function getAlignmentRuleValue(target) {
		const container = target.closest('.alignment-editor');
		if (!container) {
			return '';
		}

		const wrapStyle = getAlignmentSelectValue(container, 'wrapStyle');
		if (!wrapStyle) {
			return '';
		}

		const indentStyle = getAlignmentSelectValue(container, 'indentStyle') || 'default';
		const forceSplit = getAlignmentCheckboxValue(container, 'forceSplit');
		const allowsIndentStyle = container.dataset.allowsIndentStyle !== 'false';
		return encodeAlignmentValue(wrapStyle, forceSplit, indentStyle, allowsIndentStyle);
	}

	function syncAlignmentSummary(container) {
		if (!(container instanceof HTMLElement)) {
			return;
		}

		const summary = container.querySelector('[data-role="alignment-summary"]');
		const wrapStyle = getAlignmentSelectValue(container, 'wrapStyle');
		const indentStyle = getAlignmentSelectValue(container, 'indentStyle') || 'default';
		const forceSplit = getAlignmentCheckboxValue(container, 'forceSplit');
		const allowsIndentStyle = container.dataset.allowsIndentStyle !== 'false';
		const indentSelect = container.querySelector('[data-alignment-field="indentStyle"]');
		const forceCheckbox = container.querySelector('[data-alignment-field="forceSplit"]');

		if (indentSelect instanceof HTMLSelectElement) {
			indentSelect.hidden = !allowsIndentStyle;
			indentSelect.disabled = rulesDisabled || wrapStyle === '' || !allowsIndentStyle;
		}
		if (forceCheckbox instanceof HTMLInputElement) {
			forceCheckbox.disabled = rulesDisabled || wrapStyle === '';
		}

		if (!(summary instanceof HTMLElement)) {
			return;
		}

		if (!wrapStyle) {
			summary.textContent = 'Unset — Eclipse JDT default applies.';
			return;
		}

		const encodedValue = encodeAlignmentValue(wrapStyle, forceSplit, indentStyle, allowsIndentStyle);
		const parts = [
			`Stored value: ${encodedValue}`,
			`Wrap: ${alignmentWrapOptions.find((option) => option.value === wrapStyle)?.label ?? wrapStyle}`,
		];
		if (allowsIndentStyle) {
			parts.push(`Indent: ${alignmentIndentOptions.find((option) => option.value === indentStyle)?.label ?? indentStyle}`);
		}
		parts.push(forceSplit ? 'Force split on.' : 'Force split off.');
		summary.textContent = parts.join('  ');
	}

	function getAlignmentSelectValue(container, field) {
		const input = container.querySelector(`[data-alignment-field="${field}"]`);
		return input instanceof HTMLSelectElement ? input.value : '';
	}

	function getAlignmentCheckboxValue(container, field) {
		const input = container.querySelector(`[data-alignment-field="${field}"]`);
		return input instanceof HTMLInputElement ? input.checked : false;
	}

	function encodeAlignmentValue(wrapStyle, forceSplit, indentStyle, allowsIndentStyle) {
		const wrapBits = alignmentWrapBitsByStyle[wrapStyle] ?? 0;
		let value = wrapBits;
		if (forceSplit) {
			value |= 1;
		}
		if (allowsIndentStyle) {
			if (indentStyle === 'on_column') {
				value |= 2;
			} else if (indentStyle === 'by_one') {
				value |= 4;
			}
		}
		return String(value);
	}

	function applyRuleFilter() {
		const query = elements.ruleSearch.value.trim().toLowerCase();
		const sectionStates = Array.from(ruleSections.values());

		for (const card of ruleCards.values()) {
			const matches = query.length === 0 || card.dataset.search.includes(query);
			card.hidden = !matches;
		}

		for (const familyState of sectionStates) {
			const grid = familyState.section.querySelector('.rule-grid');
			const cards = Array.from(familyState.section.querySelectorAll('.rule-card'));
			const visibleCards = cards.filter((card) => !card.hidden);

			if (grid instanceof HTMLElement) {
				const orderedCards = query.length === 0
					? cards
					: cards.slice().sort((left, right) => {
						const leftLength = Number.parseInt(left.dataset.sortLength ?? '', 10) || Number.MAX_SAFE_INTEGER;
						const rightLength = Number.parseInt(right.dataset.sortLength ?? '', 10) || Number.MAX_SAFE_INTEGER;
						if (left.hidden !== right.hidden) {
							return left.hidden ? 1 : -1;
						}
						if (leftLength !== rightLength) {
							return leftLength - rightLength;
						}
						return (left.dataset.search ?? '').localeCompare(right.dataset.search ?? '');
					});
				grid.append(...orderedCards);
			}

			familyState.section.hidden = visibleCards.length === 0;
			familyState.count.textContent = `${visibleCards.length} visible`;
			if (query.length > 0 && visibleCards.length > 0) {
				familyState.section.open = true;
			}
		}

		const orderedSections = query.length === 0
			? sectionStates.slice().sort((left, right) => {
				const leftOrder = Number.parseInt(left.section.dataset.sortOrder ?? '', 10) || 0;
				const rightOrder = Number.parseInt(right.section.dataset.sortOrder ?? '', 10) || 0;
				return leftOrder - rightOrder;
			})
			: sectionStates.slice().sort((left, right) => {
				const leftCards = Array.from(left.section.querySelectorAll('.rule-card:not([hidden])'));
				const rightCards = Array.from(right.section.querySelectorAll('.rule-card:not([hidden])'));
				const leftMin = leftCards.reduce((min, card) => {
					const length = Number.parseInt(card.dataset.sortLength ?? '', 10) || Number.MAX_SAFE_INTEGER;
					return Math.min(min, length);
				}, Number.MAX_SAFE_INTEGER);
				const rightMin = rightCards.reduce((min, card) => {
					const length = Number.parseInt(card.dataset.sortLength ?? '', 10) || Number.MAX_SAFE_INTEGER;
					return Math.min(min, length);
				}, Number.MAX_SAFE_INTEGER);
				if (left.section.hidden !== right.section.hidden) {
					return left.section.hidden ? 1 : -1;
				}
				if (leftMin !== rightMin) {
					return leftMin - rightMin;
				}
				return (left.section.dataset.family ?? '').localeCompare(right.section.dataset.family ?? '');
			});

		elements.ruleSections.append(...orderedSections.map((state) => state.section));
	}

	// ── Preview rendering ───────────────────────────────

	function renderPreview(sourceText, formattedText) {
		lastSourceText = sourceText || '';
		lastFormattedText = formattedText || lastSourceText;

		const codeEl = elements.previewContent;
		if (!codeEl) {
			return;
		}

		if (!lastSourceText) {
			codeEl.innerHTML = '<code>Select a Java file to see a live preview.</code>';
			return;
		}

		if (showDiffMode) {
			const sourceLines = lastSourceText.split('\n');
			const formattedLines = lastFormattedText.split('\n');
			codeEl.innerHTML = buildSimpleDiff(sourceLines, formattedLines);
		} else {
			codeEl.innerHTML = buildHighlightedOutput(lastFormattedText);
		}
	}

	function buildHighlightedOutput(text) {
		const lines = text.split('\n');
		const highlightedLines = highlightJavaLines(lines);
		const indentGuideUnit = detectIndentGuideUnit(lines);
		const parts = [];
		for (let i = 0; i < lines.length; i++) {
			parts.push(renderPreviewLine(lines[i], highlightedLines[i], i + 1, '', '', indentGuideUnit));
		}
		return parts.join('');
	}

	function renderPreviewLine(rawLine, highlightedLine, lineNumber, prefix, className, indentGuideUnit) {
		const leadingWhitespaceLength = getLeadingWhitespaceLength(rawLine);
		const leadingWhitespace = rawLine.slice(0, leadingWhitespaceLength);
		const highlightedContent = highlightedLine.slice(leadingWhitespaceLength);
		const guideClassName = showIndentGuides && leadingWhitespaceLength > 0 ? ' preview-line-indent-guides' : '';
		const cls = className ? ` ${className}` : '';
		const numStr = String(lineNumber).padStart(4, ' ');
		const prefixMarkup = prefix ? `${prefix} ` : ' ';
		const indentMarkup = leadingWhitespaceLength > 0
			? `<span class="preview-line-indent${guideClassName}" style="--indent-guide-size:${indentGuideUnit}ch;">${escapeHtml(leadingWhitespace)}</span>`
			: '';
		return `<span class="diff-line${cls}"><span class="diff-line-number">${numStr}</span>${prefixMarkup}${indentMarkup}<span class="preview-line-content">${highlightedContent}</span>\n</span>`;
	}

	function detectIndentGuideUnit(lines) {
		const indentColumns = lines
			.map((line) => measureIndentColumns(line))
			.filter((indent) => indent > 0);

		if (indentColumns.length === 0) {
			return 4;
		}

		let unit = indentColumns[0];
		for (let i = 1; i < indentColumns.length; i++) {
			unit = greatestCommonDivisor(unit, indentColumns[i]);
		}

		return Math.max(1, Math.min(unit || 4, 8));
	}

	function measureIndentColumns(line) {
		let columns = 0;
		for (let i = 0; i < line.length; i++) {
			const char = line[i];
			if (char === ' ') {
				columns += 1;
				continue;
			}
			if (char === '\t') {
				columns += 4;
				continue;
			}
			break;
		}
		return columns;
	}

	function getLeadingWhitespaceLength(line) {
		let count = 0;
		while (count < line.length && (line[count] === ' ' || line[count] === '\t')) {
			count += 1;
		}
		return count;
	}

	function greatestCommonDivisor(left, right) {
		let a = Math.abs(left);
		let b = Math.abs(right);
		while (b !== 0) {
			const next = a % b;
			a = b;
			b = next;
		}
		return a;
	}

	// ── Java syntax highlighting ────────────────────────

	const javaKeywords = new Set([
		'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
		'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
		'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
		'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
		'package', 'private', 'protected', 'public', 'record', 'return', 'sealed',
		'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this',
		'throw', 'throws', 'transient', 'try', 'var', 'void', 'volatile', 'while',
		'yield', 'permits', 'non-sealed',
	]);

	const javaLiterals = new Set(['true', 'false', 'null']);
	const javaContextKeywords = new Set([
		'class', 'enum', 'extends', 'implements', 'import', 'interface', 'new',
		'package', 'permits', 'record', 'throws',
	]);

	function highlightJavaLines(lines) {
		const state = {
			inBlockComment: false,
			inTextBlock: false,
		};

		return lines.map((line) => highlightJavaLine(line, state));
	}

	function highlightJavaLine(line, state = { inBlockComment: false, inTextBlock: false }) {
		const parts = [];
		let cursor = 0;
		let previousIdentifier = '';

		while (cursor < line.length) {
			if (state.inBlockComment) {
				const end = line.indexOf('*/', cursor);
				if (end === -1) {
					parts.push(wrapToken('syn-comment', line.slice(cursor)));
					cursor = line.length;
					continue;
				}
				parts.push(wrapToken('syn-comment', line.slice(cursor, end + 2)));
				cursor = end + 2;
				state.inBlockComment = false;
				continue;
			}

			if (state.inTextBlock) {
				const end = line.indexOf('"""', cursor);
				if (end === -1) {
					parts.push(wrapToken('syn-string', line.slice(cursor)));
					cursor = line.length;
					continue;
				}
				parts.push(wrapToken('syn-string', line.slice(cursor, end + 3)));
				cursor = end + 3;
				state.inTextBlock = false;
				continue;
			}

			const char = line[cursor];

			if (isWhitespace(char)) {
				const end = consumeWhile(line, cursor, isWhitespace);
				parts.push(escapeHtml(line.slice(cursor, end)));
				cursor = end;
				continue;
			}

			if (line.startsWith('//', cursor)) {
				parts.push(wrapToken('syn-comment', line.slice(cursor)));
				break;
			}

			if (line.startsWith('/*', cursor)) {
				const end = line.indexOf('*/', cursor + 2);
				if (end === -1) {
					parts.push(wrapToken('syn-comment', line.slice(cursor)));
					state.inBlockComment = true;
					break;
				}
				parts.push(wrapToken('syn-comment', line.slice(cursor, end + 2)));
				cursor = end + 2;
				continue;
			}

			if (line.startsWith('"""', cursor)) {
				const end = line.indexOf('"""', cursor + 3);
				if (end === -1) {
					parts.push(wrapToken('syn-string', line.slice(cursor)));
					state.inTextBlock = true;
					break;
				}
				parts.push(wrapToken('syn-string', line.slice(cursor, end + 3)));
				cursor = end + 3;
				continue;
			}

			if (char === '"' || char === "'") {
				const end = consumeQuotedLiteral(line, cursor, char);
				parts.push(wrapToken('syn-string', line.slice(cursor, end)));
				cursor = end;
				continue;
			}

			if (char === '@') {
				const end = consumeWhile(line, cursor + 1, isIdentifierPart);
				parts.push(wrapToken('syn-annotation', line.slice(cursor, end)));
				cursor = end;
				continue;
			}

			if (isDigit(char)) {
				const end = consumeWhile(line, cursor + 1, isNumberPart);
				parts.push(wrapToken('syn-number', line.slice(cursor, end)));
				cursor = end;
				continue;
			}

			if (isIdentifierStart(char)) {
				const end = consumeWhile(line, cursor + 1, isIdentifierPart);
				const token = line.slice(cursor, end);
				const nextChar = nextNonWhitespaceChar(line, end);
				const className = classifyIdentifierToken(token, previousIdentifier, nextChar);
				parts.push(className ? wrapToken(className, token) : escapeHtml(token));
				previousIdentifier = token;
				cursor = end;
				continue;
			}

			parts.push(escapeHtml(char));
			cursor += 1;
		}

		return parts.join('');
	}

	function classifyIdentifierToken(token, previousIdentifier, nextChar) {
		if (javaKeywords.has(token)) {
			return 'syn-keyword';
		}
		if (javaLiterals.has(token)) {
			return 'syn-literal';
		}
		if (nextChar === '(') {
			return 'syn-method';
		}
		if (javaContextKeywords.has(previousIdentifier) || /^[A-Z]/.test(token)) {
			return 'syn-type';
		}
		return '';
	}

	function wrapToken(className, token) {
		return `<span class="${className}">${escapeHtml(token)}</span>`;
	}

	function consumeWhile(text, start, predicate) {
		let index = start;
		while (index < text.length && predicate(text[index])) {
			index += 1;
		}
		return index;
	}

	function consumeQuotedLiteral(text, start, quote) {
		let index = start + 1;
		while (index < text.length) {
			if (text[index] === '\\') {
				index += 2;
				continue;
			}
			if (text[index] === quote) {
				return index + 1;
			}
			index += 1;
		}
		return text.length;
	}

	function nextNonWhitespaceChar(text, start) {
		for (let index = start; index < text.length; index += 1) {
			if (!isWhitespace(text[index])) {
				return text[index];
			}
		}
		return '';
	}

	function isWhitespace(char) {
		return char === ' ' || char === '\t';
	}

	function isDigit(char) {
		return char >= '0' && char <= '9';
	}

	function isIdentifierStart(char) {
		return /[A-Za-z_$]/.test(char);
	}

	function isIdentifierPart(char) {
		return /[A-Za-z0-9_$]/.test(char);
	}

	function isNumberPart(char) {
		return /[0-9A-Fa-f_xXpP.+-]/.test(char);
	}

	// ── Diff rendering ──────────────────────────────────

	function buildSimpleDiff(oldLines, newLines) {
		const lcs = computeLcs(oldLines, newLines);
		const indentGuideUnit = detectIndentGuideUnit(oldLines.concat(newLines));
		const parts = [];
		let oldIdx = 0;
		let newIdx = 0;

		for (const entry of lcs) {
			while (oldIdx < entry.oldIdx) {
				parts.push(diffLine('−', oldIdx + 1, oldLines[oldIdx], 'diff-removed', indentGuideUnit));
				oldIdx++;
			}
			while (newIdx < entry.newIdx) {
				parts.push(diffLine('+', newIdx + 1, newLines[newIdx], 'diff-added', indentGuideUnit));
				newIdx++;
			}
			parts.push(diffLine(' ', newIdx + 1, newLines[newIdx], '', indentGuideUnit));
			oldIdx++;
			newIdx++;
		}
		while (oldIdx < oldLines.length) {
			parts.push(diffLine('−', oldIdx + 1, oldLines[oldIdx], 'diff-removed', indentGuideUnit));
			oldIdx++;
		}
		while (newIdx < newLines.length) {
			parts.push(diffLine('+', newIdx + 1, newLines[newIdx], 'diff-added', indentGuideUnit));
			newIdx++;
		}

		return parts.join('');
	}

	function diffLine(prefix, lineNum, text, className, indentGuideUnit) {
		const highlighted = highlightJavaLine(text);
		return renderPreviewLine(text, highlighted, lineNum, prefix, className, indentGuideUnit);
	}

	function escapeHtml(text) {
		return text
			.replaceAll('&', '&amp;')
			.replaceAll('<', '&lt;')
			.replaceAll('>', '&gt;');
	}

	function computeLcs(oldLines, newLines) {
		const oldLen = oldLines.length;
		const newLen = newLines.length;
		const max = oldLen + newLen;
		const v = new Int32Array(2 * max + 1);
		const trace = [];
		v.fill(-1);
		v[max + 1] = 0;

		for (let d = 0; d <= max; d++) {
			const snap = new Int32Array(v);
			trace.push(snap);
			for (let k = -d; k <= d; k += 2) {
				let x;
				if (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) {
					x = v[max + k + 1];
				} else {
					x = v[max + k - 1] + 1;
				}
				let y = x - k;
				while (x < oldLen && y < newLen && oldLines[x] === newLines[y]) {
					x++;
					y++;
				}
				v[max + k] = x;
				if (x >= oldLen && y >= newLen) {
					return backtrack(trace, max, oldLen, newLen);
				}
			}
		}
		return [];
	}

	function backtrack(trace, max, oldLen, newLen) {
		const result = [];
		let x = oldLen;
		let y = newLen;
		for (let d = trace.length - 1; d > 0; d--) {
			const v = trace[d - 1];
			const k = x - y;
			let prevK;
			if (k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])) {
				prevK = k + 1;
			} else {
				prevK = k - 1;
			}
			let prevX = v[max + prevK];
			let prevY = prevX - prevK;
			while (x > prevX && y > prevY) {
				x--;
				y--;
				result.push({ oldIdx: x, newIdx: y });
			}
			x = prevX;
			y = prevY;
		}
		while (x > 0 && y > 0) {
			x--;
			y--;
			result.push({ oldIdx: x, newIdx: y });
		}
		result.reverse();
		return result;
	}
}());
