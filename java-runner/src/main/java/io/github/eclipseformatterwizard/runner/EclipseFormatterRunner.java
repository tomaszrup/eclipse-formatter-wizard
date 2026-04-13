package io.github.eclipseformatterwizard.runner;

import java.io.StringReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.Map;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;

import org.eclipse.jdt.core.JavaCore;
import org.eclipse.jdt.core.ToolFactory;
import org.eclipse.jdt.core.formatter.CodeFormatter;
import org.eclipse.jface.text.Document;
import org.eclipse.text.edits.TextEdit;
import org.w3c.dom.Element;
import org.w3c.dom.NodeList;
import org.xml.sax.InputSource;

public final class EclipseFormatterRunner {

	private EclipseFormatterRunner() {
	}

	public static void main(String[] args) throws Exception {
		if (args.length < 2) {
			System.err.println("Usage: EclipseFormatterRunner <formatterXmlPath> <sourcePath> [sourceLevel]");
			System.exit(2);
		}

		Path formatterXmlPath = Path.of(args[0]);
		Path sourcePath = Path.of(args[1]);
		String sourceLevel = args.length >= 3 ? args[2] : JavaCore.VERSION_21;

		Map<String, String> formatterOptions = readFormatterOptions(Files.readString(formatterXmlPath, StandardCharsets.UTF_8));
		formatterOptions.put(JavaCore.COMPILER_SOURCE, sourceLevel);
		formatterOptions.put(JavaCore.COMPILER_COMPLIANCE, sourceLevel);
		formatterOptions.put(JavaCore.COMPILER_CODEGEN_TARGET_PLATFORM, sourceLevel);

		String source = Files.readString(sourcePath, StandardCharsets.UTF_8);
		String lineSeparator = detectLineSeparator(source);
		CodeFormatter formatter = ToolFactory.createCodeFormatter(formatterOptions, ToolFactory.M_FORMAT_EXISTING);
		int formatKind = detectKind(sourcePath) | CodeFormatter.F_INCLUDE_COMMENTS;
		TextEdit edit = formatter.format(formatKind, source, 0, source.length(), 0, lineSeparator);

		if (edit == null) {
			throw new IllegalStateException("Eclipse JDT formatter returned no edits for the provided source.");
		}

		Document document = new Document(source);
		edit.apply(document);
		System.out.print(document.get());
	}

	private static Map<String, String> readFormatterOptions(String xml) throws Exception {
		DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
		factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
		factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
		factory.setExpandEntityReferences(false);
		factory.setXIncludeAware(false);
		factory.setNamespaceAware(false);

		org.w3c.dom.Document document = factory
			.newDocumentBuilder()
			.parse(new InputSource(new StringReader(xml)));
		NodeList profileNodes = document.getElementsByTagName("profile");
		if (profileNodes.getLength() == 0) {
			throw new IllegalArgumentException("Formatter XML does not contain a <profile> element.");
		}

		Element profile = (Element) profileNodes.item(0);
		NodeList settings = profile.getElementsByTagName("setting");
		Map<String, String> options = new HashMap<>();

		for (int index = 0; index < settings.getLength(); index += 1) {
			Element setting = (Element) settings.item(index);
			String id = setting.getAttribute("id");
			String value = setting.getAttribute("value");
			if (!id.isBlank()) {
				options.put(id, value);
			}
		}

		return options;
	}

	private static int detectKind(Path sourcePath) {
		return sourcePath.getFileName().toString().equals("module-info.java")
			? CodeFormatter.K_MODULE_INFO
			: CodeFormatter.K_COMPILATION_UNIT;
	}

	private static String detectLineSeparator(String source) {
		if (source.contains("\r\n")) {
			return "\r\n";
		}

		if (source.contains("\n")) {
			return "\n";
		}

		return System.lineSeparator();
	}
}