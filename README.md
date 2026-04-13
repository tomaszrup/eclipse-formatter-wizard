# Eclipse Formatter Wizard

A VS Code extension that lets you visually author Eclipse JDT formatter XML profiles with a live before/after Java preview.

## Features

- **Guided Webview Wizard** — browse and edit every Eclipse JDT formatter rule through a categorised, searchable UI instead of hand-editing XML.
- **Live Diff Preview** — pick any Java file from your workspace and instantly see an original ↔ formatted side-by-side diff that updates as you change rules.
- **Full Rule Coverage** — supports booleans, enums, numeric values, brace positions, insert options, alignment bit-fields, and more.
- **Create or Edit** — generate a new `eclipse-formatter.xml` from defaults or open an existing one; the wizard auto-detects formatter documents.
- **Persistence** — preview-file associations are stored per formatter document in workspace state and survive restarts.

## Requirements

- **Java 17+** on `PATH` (used to run the embedded Eclipse JDT formatter engine).
- No additional VS Code extensions are required.

## Getting Started

1. Install the extension (or load the `.vsix` with **Extensions → Install from VSIX…**).
2. Open the Command Palette (`Ctrl+Shift+P`) and run **Eclipse Formatter: Create Formatter XML** to scaffold a new profile, or open an existing `*formatter*.xml` file.
3. The Formatter Wizard panel opens automatically. Adjust rules in the webview — the underlying XML updates in real time.
4. Run **Eclipse Formatter: Select Preview Java File** to choose a `.java` file, then **Eclipse Formatter: Show Formatter Preview** to see a live diff.

## Commands

| Command | Description |
|---|---|
| `Eclipse Formatter: Open Formatter Wizard` | Open the wizard panel for the active formatter XML |
| `Eclipse Formatter: Create Formatter XML` | Create a new `eclipse-formatter.xml` in the workspace root |
| `Eclipse Formatter: Select Preview Java File` | Pick a Java file to use for before/after preview |
| `Eclipse Formatter: Show Formatter Preview` | Show a diff editor comparing original and formatted output |

## How It Works

1. The canonical source of truth is a standard Eclipse JDT formatter XML file (`<profiles>` / `<profile>` / `<setting>`).
2. The webview reads the XML through `FormatterXmlService`, presents rules grouped by family, and writes changes back into the XML document.
3. On each change, `JavaFormatterBridge` invokes the bundled Eclipse JDT formatter (compiled from `java-runner/`) in a child process to produce formatted output.
4. A virtual-document content provider serves the formatted text so VS Code's built-in diff editor can display the result.

## Development

```bash
# Install dependencies
npm install

# Build the Java formatter runner (requires JDK 17+)
npm run build:java-runner

# Watch & compile
npm run watch

# Lint
npm run lint

# Run tests
npm test

# Package as .vsix
npm run package:vsix
```

Press **F5** in VS Code to launch the Extension Development Host with the extension loaded.

## License

This project is licensed under the Eclipse Public License 2.0.

See the LICENSE file in the project root for the full license text.
